/**
 * DimensionCheckpoint — 维度执行断点存储与恢复
 *
 * 在维度级粒度保存/加载/清理执行进度，支持意外中断后恢复。
 *
 * 调用方:
 *   - BootstrapConsumers (内部 Agent) — 每个维度完成后保存
 *   - ExternalDimensionCompletionWorkflow (外部 Agent) — 维度完成时保存
 *   - WorkflowResultPersistence — clearDimensionCheckpoints() 全量重建前清理
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import Logger from '#infra/logging/Logger.js';
import pathGuard from '#shared/PathGuard.js';
const logger = Logger.getInstance();
const CHECKPOINT_TTL_MS = 3600_000; // 1小时内有效
// ─── Checkpoint Store ────────────────────────────────────────────────
/**
 * 保存维度级 checkpoint
 * @param result 维度执行结果
 * @param [digest] DimensionDigest
 */
export async function saveDimensionCheckpoint(dataRoot, sessionId, dimId, result, digest = null) {
    try {
        const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
        await fs.mkdir(checkpointDir, { recursive: true });
        await fs.writeFile(path.join(checkpointDir, `${dimId}.json`), JSON.stringify({ dimId, sessionId, ...result, digest, completedAt: Date.now() }));
    }
    catch (err) {
        logger.warn(`[Bootstrap-v3] checkpoint save failed for "${dimId}": ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * 加载有效的 checkpoints
 * @returns dimId → checkpoint data
 */
export async function loadDimensionCheckpoints(dataRoot) {
    const checkpoints = new Map();
    try {
        const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
        const files = await fs.readdir(checkpointDir).catch(() => []);
        const now = Date.now();
        for (const file of files) {
            if (!file.endsWith('.json')) {
                continue;
            }
            try {
                const content = await fs.readFile(path.join(checkpointDir, file), 'utf-8');
                const data = JSON.parse(content);
                if (data.completedAt && now - data.completedAt < CHECKPOINT_TTL_MS) {
                    checkpoints.set(data.dimId, data);
                }
            }
            catch {
                /* skip corrupt checkpoint */
            }
        }
    }
    catch {
        /* checkpoint dir doesn't exist */
    }
    return checkpoints;
}
/** 清理 checkpoint 目录 */
export async function clearDimensionCheckpoints(dataRoot) {
    try {
        const checkpointDir = path.join(dataRoot, '.asd', 'bootstrap-checkpoint');
        pathGuard.assertSafe(checkpointDir);
        await fs.rm(checkpointDir, { recursive: true, force: true });
    }
    catch (err) {
        if (err?.name === 'PathGuardError') {
            throw err;
        }
        /* ignore other errors */
    }
}
export const loadCheckpoints = loadDimensionCheckpoints;
export const clearCheckpoints = clearDimensionCheckpoints;
export function syncRestoredSessionStoreDigests({ sessionStore, dimContext, }) {
    const restoredDims = sessionStore.getCompletedDimensions();
    logger.info(`[Insight-v3] Restored SessionStore: ${restoredDims.length} dims [${restoredDims.join(', ')}]`);
    for (const dimId of restoredDims) {
        const report = sessionStore.getDimensionReport(dimId);
        if (report?.digest) {
            dimContext.addDimensionDigest(dimId, report.digest);
        }
    }
    return restoredDims;
}
export function resolveIncrementalSkippedDimensions({ isIncremental, incrementalPlan, activeDimIds, forceExecuteDimIds = [], emitter, }) {
    const incrementalSkippedDims = [];
    if (!isIncremental || !incrementalPlan) {
        return incrementalSkippedDims;
    }
    const affected = new Set(incrementalPlan.affectedDimensions);
    const forceExecute = new Set(forceExecuteDimIds);
    for (const dimId of activeDimIds) {
        if (forceExecute.has(dimId)) {
            continue;
        }
        if (!affected.has(dimId) && incrementalPlan.skippedDimensions.includes(dimId)) {
            incrementalSkippedDims.push(dimId);
            emitter.emitDimensionComplete(dimId, {
                type: 'incremental-restored',
                reason: 'no-change-detected',
            });
        }
    }
    if (incrementalSkippedDims.length > 0) {
        logger.info(`[Insight-v3] ⏩ Incremental skip: [${incrementalSkippedDims.join(', ')}] ` +
            `(using historical results)`);
    }
    return incrementalSkippedDims;
}
export async function restoreCheckpointDimensions({ dataRoot, activeDimIds, dimContext, sessionStore, emitter, }) {
    const completedCheckpoints = (await loadDimensionCheckpoints(dataRoot));
    const skippedDims = [];
    for (const [dimId, checkpoint] of completedCheckpoints) {
        if (!activeDimIds.includes(dimId)) {
            continue;
        }
        if (checkpoint.digest) {
            dimContext.addDimensionDigest(dimId, checkpoint.digest);
            sessionStore.addDimensionDigest(dimId, checkpoint.digest);
        }
        emitter.emitDimensionComplete(dimId, {
            type: 'checkpoint-restored',
            ...checkpoint,
        });
        skippedDims.push(dimId);
        logger.info(`[Insight-v3] ⏩ 跳过已完成维度 (checkpoint): "${dimId}"`);
    }
    return { completedCheckpoints, skippedDims };
}
export function applyRestoredDimensionState({ incrementalSkippedDims, checkpointSkippedDims, completedCheckpoints, sessionStore, dimensionStats, candidateResults, dimensionCandidates, }) {
    for (const dimId of incrementalSkippedDims) {
        restoreIncrementalSkippedDimension({ dimId, sessionStore, dimensionStats });
    }
    for (const dimId of checkpointSkippedDims) {
        if (!incrementalSkippedDims.includes(dimId)) {
            restoreCheckpointDimension({
                dimId,
                completedCheckpoints,
                sessionStore,
                dimensionStats,
                candidateResults,
                dimensionCandidates,
            });
        }
    }
}
function restoreIncrementalSkippedDimension({ dimId, sessionStore, dimensionStats, }) {
    const report = sessionStore.getDimensionReport(dimId);
    const dimResult = {
        candidateCount: report?.candidatesSummary?.length || 0,
        rejectedCount: 0,
        analysisChars: report?.analysisText?.length || 0,
        referencedFiles: report?.referencedFiles?.length || 0,
        referencedFilesList: report?.referencedFiles || [],
        durationMs: 0,
        toolCallCount: 0,
        tokenUsage: { input: 0, output: 0 },
        skipped: true,
        restoredFromIncremental: true,
    };
    dimensionStats[dimId] = dimResult;
    logger.info(`[Insight-v3] ⏩ "${dimId}" — incremental skip (historical result)`);
}
function restoreCheckpointDimension({ dimId, completedCheckpoints, sessionStore, dimensionStats, candidateResults, dimensionCandidates, }) {
    const cp = completedCheckpoints.get(dimId);
    const cpResult = {
        candidateCount: cp?.candidateCount || 0,
        rejectedCount: cp?.rejectedCount || 0,
        analysisChars: cp?.analysisChars || 0,
        referencedFiles: cp?.referencedFiles || 0,
        durationMs: cp?.durationMs || 0,
        toolCallCount: cp?.toolCallCount || 0,
        tokenUsage: cp?.tokenUsage || { input: 0, output: 0 },
        skipped: true,
        restoredFromCheckpoint: true,
    };
    dimensionStats[dimId] = cpResult;
    candidateResults.created += cpResult.candidateCount;
    if (cp?.analysisText) {
        const restoredFiles = Array.isArray(cp.referencedFilesList) ? cp.referencedFilesList : [];
        dimensionCandidates[dimId] = {
            analysisReport: {
                analysisText: cp.analysisText,
                referencedFiles: restoredFiles,
                findings: [],
                metadata: {},
            },
            producerResult: { candidateCount: cp.candidateCount || 0, toolCalls: [] },
        };
        sessionStore.storeDimensionReport(dimId, {
            analysisText: cp.analysisText,
            findings: [],
            referencedFiles: restoredFiles,
            candidatesSummary: [],
        });
        logger.info(`[Insight-v3] ✅ Checkpoint "${dimId}": analysisText restored (${cp.analysisText.length} chars) — Skill generation enabled`);
    }
}

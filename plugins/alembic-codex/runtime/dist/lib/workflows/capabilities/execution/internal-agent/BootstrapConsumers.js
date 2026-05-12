/**
 * BootstrapConsumers — 内部 Agent 维度执行结果的消费处理器
 *
 * 处理维度运行结果的各个方面：
 *   - Dimension: 单维度分析报告消费、候选提交、checkpoint 保存
 *   - Session: 整体会话结果消费、缺失维度检测
 *   - Tier: 分层反思生成（跨维度 pattern 发现）
 *   - CandidateRelation: 候选间关系写入 Code Entity Graph
 *   - Skill: skillWorthy 维度的 Project Skill 生成
 */
import Logger from '#infra/logging/Logger.js';
import { normalizeDimensionFindings, projectBootstrapSessionResult, } from '#workflows/capabilities/execution/internal-agent/BootstrapProjections.js';
import { parseDimensionDigest, } from '#workflows/capabilities/execution/internal-agent/DimensionContext.js';
import { generateSkill } from '#workflows/capabilities/execution/WorkflowSkillCompletionCapability.js';
import { saveDimensionCheckpoint } from '#workflows/capabilities/persistence/DimensionCheckpoint.js';
import { buildTierReflection } from '#workflows/capabilities/planning/dimensions/bootstrapDimensionConfigs.js';
const logger = Logger.getInstance();
export async function consumeBootstrapDimensionResult({ ctx, dimId, dimConfig, needsCandidates, projection, runResult, dimStartTime, analystScopeId, memoryCoordinator, sessionStore, dimContext, candidateResults, dimensionCandidates, dimensionStats, emitter, dataRoot, sessionId, }) {
    const { gateResult, produceResult, analysisText, artifact, runtimeToolCalls, combinedTokenUsage, analysisReport, producerResult, submitCalls, successCount, rejectedCount, } = projection;
    candidateResults.created += producerResult.candidateCount;
    dimensionCandidates[dimId] = { analysisReport, producerResult };
    if (needsCandidates) {
        const producerToolCalls = produceResult?.toolCalls || [];
        const producerToolNames = producerToolCalls.map((tc) => tc?.tool || tc?.name || 'unknown');
        const toolBreakdown = {};
        for (const name of producerToolNames) {
            toolBreakdown[name] = (toolBreakdown[name] || 0) + 1;
        }
        const breakdownStr = Object.entries(toolBreakdown)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
        logger.info(`[Producer] "${dimId}": submitted=${submitCalls.length}, accepted=${successCount}, rejected=${rejectedCount}, ` +
            `producerToolCalls=${producerToolCalls.length} (${breakdownStr || 'none'}), ` +
            `analysisInput=${analysisText.length} chars`);
        if (successCount === 0 && submitCalls.length === 0) {
            logger.warn(`[Producer] "${dimId}": ⚠ Producer 未提交任何候选。` +
                `分析文本=${analysisText.length} chars, findings=${(analysisReport.findings || []).length}, ` +
                `producerIterations=${producerToolCalls.length}, degraded=${runResult?.degraded || false}`);
        }
    }
    const ac = memoryCoordinator.getActiveContext(analystScopeId);
    const distilled = ac
        ? ac.distill()
        : { keyFindings: [], totalObservations: 0, toolCallSummary: [] };
    sessionStore.storeDimensionReport(dimId, {
        analysisText: analysisReport.analysisText,
        findings: analysisReport.findings.length > 0
            ? normalizeDimensionFindings(analysisReport.findings)
            : distilled.keyFindings,
        referencedFiles: analysisReport.referencedFiles || [],
        candidatesSummary: [],
        workingMemoryDistilled: distilled,
    });
    logger.info(`[Insight-v3] Dimension "${dimId}": analysis=${analysisReport.analysisText.length} chars, ` +
        `files=${analysisReport.referencedFiles.length}, findings=${(analysisReport.findings || distilled.keyFindings).length}, ` +
        `toolCalls=${runtimeToolCalls.length}, degraded=${runResult?.degraded || false} (${Date.now() - dimStartTime}ms)`);
    try {
        const tokenStore = ctx.container?.get?.('tokenUsageStore');
        if (tokenStore) {
            const aiProv = ctx.container?.singletons?.aiProvider;
            tokenStore.record({
                source: 'system',
                dimension: dimId,
                provider: aiProv?.name || null,
                model: aiProv?.model || null,
                inputTokens: combinedTokenUsage.input || 0,
                outputTokens: combinedTokenUsage.output || 0,
                durationMs: Date.now() - dimStartTime,
                toolCalls: runtimeToolCalls.length,
                sessionId: sessionId || null,
            });
            try {
                const realtime = ctx.container?.get?.('realtimeService');
                realtime?.broadcastTokenUsageUpdated?.();
            }
            catch {
                /* optional */
            }
        }
    }
    catch {
        /* token logging should never break execution */
    }
    if (needsCandidates && analysisReport.analysisText.length < 100) {
        const findings = analysisReport.findings || [];
        if (findings.length >= 3) {
            const dimLabel = dimConfig.label || dimId;
            const synthesized = [
                `## ${dimLabel}`,
                '',
                analysisReport.analysisText.trim(),
                '',
                '### 关键发现',
                '',
                ...findings.slice(0, 10).map((f, i) => {
                    const text = typeof f === 'string' ? f : f.finding;
                    return `${i + 1}. ${text}`;
                }),
            ];
            const memDistilled = distilled;
            if (memDistilled?.toolCallSummary?.length > 0) {
                synthesized.push('', '### 探索记录', '');
                for (const s of memDistilled.toolCallSummary.slice(0, 10)) {
                    synthesized.push(`- ${s}`);
                }
            }
            const originalLen = analysisReport.analysisText.length;
            analysisReport.analysisText = synthesized.join('\n');
            logger.info(`[Insight-v3] analysisText 补强 "${dimId}": ${originalLen} → ${analysisReport.analysisText.length} chars ` +
                `(from ${findings.length} findings)`);
        }
    }
    const digest = parseDimensionDigest(producerResult.reply) || {
        summary: `v3 分析: ${analysisReport.analysisText.substring(0, 200)}...`,
        candidateCount: producerResult.candidateCount,
        keyFindings: [],
        crossRefs: {},
        gaps: [],
    };
    dimContext.addDimensionDigest(dimId, digest);
    sessionStore.addDimensionDigest(dimId, digest);
    for (const tc of submitCalls) {
        if (!isSuccessfulToolCall(tc)) {
            continue;
        }
        const params = extractSubmitParams(tc);
        const result = isRecord(tc.result) ? tc.result : {};
        const candidateSummary = {
            title: pickString(params.title) || pickString(result.title),
            subTopic: pickString(params.category) || pickString(params.knowledgeType) || dimId,
            summary: pickString(params.summary) || pickString(params.description),
        };
        dimContext.addSubmittedCandidate(dimId, candidateSummary);
        sessionStore.addSubmittedCandidate(dimId, candidateSummary);
    }
    emitter.emitDimensionComplete(dimId, {
        type: needsCandidates ? 'candidate' : 'skill',
        extracted: producerResult.candidateCount,
        created: producerResult.candidateCount,
        status: 'v3-pipeline-complete',
        degraded: runResult?.degraded || false,
        durationMs: Date.now() - dimStartTime,
        toolCallCount: runtimeToolCalls.length,
        source: 'enhanced-pipeline-strategy',
    });
    const qualityScores = artifact.qualityReport;
    const dimResult = {
        candidateCount: producerResult.candidateCount,
        rejectedCount: producerResult.rejectedCount || 0,
        analysisChars: analysisReport.analysisText.length,
        referencedFiles: analysisReport.referencedFiles.length,
        durationMs: Date.now() - dimStartTime,
        toolCallCount: runtimeToolCalls.length,
        tokenUsage: combinedTokenUsage,
        diagnostics: runResult.diagnostics || null,
        stages: summarizeDimensionStages(runResult),
        analysisText: analysisReport.analysisText,
        referencedFilesList: analysisReport.referencedFiles || [],
        qualityGate: qualityScores
            ? {
                totalScore: qualityScores.totalScore,
                scores: qualityScores.scores,
                action: gateResult?.action || (runResult?.degraded ? 'degrade' : 'pass'),
            }
            : null,
    };
    dimensionStats[dimId] = dimResult;
    if (analysisReport.analysisText.length >= 50) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- digest shape compatible at runtime
        await saveDimensionCheckpoint(dataRoot, sessionId, dimId, dimResult, digest);
    }
    else {
        logger.warn(`[Insight-v3] ⚠ 跳过 checkpoint 保存: "${dimId}" analysisText 过短 (${analysisReport.analysisText.length} chars)`);
    }
    return dimResult;
}
function extractSubmitParams(tc) {
    const rawArgs = tc.params || tc.args || {};
    const nestedParams = rawArgs.params;
    return isRecord(nestedParams) ? nestedParams : rawArgs;
}
function isSuccessfulToolCall(tc) {
    const res = tc.result;
    if (!res) {
        return true;
    }
    if (typeof res === 'string') {
        return !res.includes('rejected') && !res.includes('error');
    }
    if (!isRecord(res)) {
        return true;
    }
    if (res.error || res.submitted === false) {
        return false;
    }
    return res.status !== 'rejected' && res.status !== 'error';
}
function pickString(value) {
    return typeof value === 'string' ? value : '';
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function summarizeDimensionStages(runResult) {
    const phases = runResult.phases || {};
    return Object.fromEntries(Object.entries(phases)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([stage, value]) => {
        const phase = value;
        return [
            stage,
            {
                toolCallCount: phase.toolCalls?.length || 0,
                tokenUsage: phase.tokenUsage || { input: 0, output: 0 },
                iterations: phase.iterations || 0,
                timedOut: phase.timedOut === true,
            },
        ];
    }));
}
export function consumeBootstrapDimensionError({ dimId, err, candidateResults, dimensionStats, emitter, }) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[Insight-v3] Dimension "${dimId}" failed: ${errMsg}`);
    candidateResults.errors.push({ dimId, error: errMsg });
    emitter.emitDimensionComplete(dimId, { type: 'error', reason: errMsg });
    const dimResult = { candidateCount: 0, durationMs: 0, error: errMsg };
    dimensionStats[dimId] = dimResult;
    return dimResult;
}
export function consumeBootstrapSessionResult({ parentRunResult, activeDimIds, skippedDimIds, durationMs, sessionStore, dimensionStats, consumeMissingDimension, }) {
    const projection = projectBootstrapSessionResult({
        parentRunResult,
        activeDimIds,
        skippedDimIds,
    });
    consumeMissingBootstrapDimensions({
        missingDimensionIds: projection.missingDimensionIds,
        dimensionStats,
        consumeMissingDimension,
    });
    logger.info(`[Insight-v3] All tiers complete: ${projection.completedDimensions} dimensions in ${durationMs}ms`);
    if (projection.parentStatus !== 'success' ||
        projection.failedDimensionIds.length > 0 ||
        projection.abortedDimensionIds.length > 0) {
        logger.warn(`[Insight-v3] Bootstrap session completed with ${projection.failedDimensionIds.length} failed, ${projection.abortedDimensionIds.length} aborted dimensions (status=${projection.parentStatus})`);
    }
    if (projection.missingDimensionIds.length > 0) {
        logger.warn(`[Insight-v3] Bootstrap session missing dimension results: [${projection.missingDimensionIds.join(', ')}]`);
    }
    const emStats = sessionStore.getStats();
    logger.info(`[Insight-v3] Memory stats: ${emStats.completedDimensions} dims, ` +
        `${emStats.totalFindings} findings, ${emStats.referencedFiles} files, ` +
        `${emStats.crossReferences} cross-refs, ${emStats.tierReflections} reflections`);
    if (emStats.cache) {
        logger.info(`[Insight-v3] Cache stats: ${emStats.cache.hitRate} hit rate, ` +
            `${emStats.cache.searchCacheSize} searches, ${emStats.cache.fileCacheSize} files`);
    }
    return projection;
}
export function consumeMissingBootstrapDimensions({ missingDimensionIds, dimensionStats, consumeMissingDimension, }) {
    for (const dimId of missingDimensionIds) {
        if (dimensionStats[dimId]) {
            continue;
        }
        consumeMissingDimension(dimId);
    }
}
export async function consumeBootstrapCandidateRelations({ ctx, projectRoot, dimensionCandidates, getCodeEntityGraphClass = defaultGetCodeEntityGraphClass, }) {
    try {
        const entityRepo = ctx.container.get('codeEntityRepository');
        const edgeRepo = ctx.container.get('knowledgeEdgeRepository');
        if (!entityRepo || !edgeRepo) {
            return null;
        }
        const allCandidates = extractBootstrapCandidateRelations(dimensionCandidates);
        if (allCandidates.length === 0) {
            return null;
        }
        const CodeEntityGraph = await getCodeEntityGraphClass();
        const graph = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot, logger });
        const relResult = await graph.populateFromCandidateRelations(allCandidates);
        logger.info(`[Insight-v3] Code Entity Graph relations: ${relResult.edgesCreated} edges from ${allCandidates.length} candidates (${relResult.durationMs}ms)`);
        return {
            ...relResult,
            candidates: allCandidates.length,
        };
    }
    catch (cegErr) {
        logger.warn(`[Insight-v3] Code Entity Graph relations failed (non-blocking): ${cegErr instanceof Error ? cegErr.message : String(cegErr)}`);
        return null;
    }
}
export function extractBootstrapCandidateRelations(dimensionCandidates) {
    const allCandidates = [];
    for (const dimData of Object.values(dimensionCandidates)) {
        const toolCalls = dimData?.producerResult?.toolCalls || [];
        for (const toolCall of toolCalls) {
            const toolName = toolCall.tool || toolCall.name;
            if (toolName !== 'knowledge') {
                continue;
            }
            const params = toolCall.params || toolCall.args || {};
            if (params.title) {
                allCandidates.push({
                    title: params.title,
                    relations: params.relations || null,
                });
            }
        }
    }
    return allCandidates;
}
async function defaultGetCodeEntityGraphClass() {
    const { CodeEntityGraph } = await import('#service/knowledge/CodeEntityGraph.js');
    return CodeEntityGraph;
}
export async function consumeBootstrapSkills({ ctx, dimensions, dimensionCandidates, sessionStore, emitter, shouldAbort, generateSkillFn = generateSkill, }) {
    const skillResults = { created: 0, failed: 0, skills: [], errors: [] };
    try {
        for (const dim of dimensions) {
            if (!dim.skillWorthy) {
                continue;
            }
            const dimData = dimensionCandidates[dim.id];
            if (!dimData?.analysisReport?.analysisText) {
                continue;
            }
            if (shouldAbort?.()) {
                break;
            }
            await consumeSingleBootstrapSkill({
                ctx,
                dim,
                dimData,
                sessionStore,
                emitter,
                skillResults,
                generateSkillFn,
            });
        }
    }
    catch (e) {
        logger.warn(`[Insight-v3] Skill generation module import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return skillResults;
}
async function consumeSingleBootstrapSkill({ ctx, dim, dimData, sessionStore, emitter, skillResults, generateSkillFn, }) {
    try {
        const analysisText = dimData.analysisReport.analysisText;
        const referencedFiles = dimData.analysisReport.referencedFiles || [];
        const dimReport = sessionStore.getDimensionReport(dim.id);
        const keyFindings = extractSkillKeyFindings(dimReport);
        const effectiveText = buildEffectiveSkillAnalysisText({
            dim,
            analysisText,
            keyFindings,
            distilled: dimReport?.workingMemoryDistilled,
        });
        const result = await generateSkillFn(ctx, dim, effectiveText, referencedFiles, keyFindings, 'bootstrap-v3');
        if (result.success) {
            skillResults.created++;
            skillResults.skills.push(result.skillName);
            emitter.emitDimensionComplete(dim.id, {
                type: 'skill',
                skillName: result.skillName,
                sourceCount: referencedFiles.length,
            });
        }
        else {
            skillResults.failed++;
            skillResults.errors.push({ dimId: dim.id, error: result.error ?? 'unknown' });
            emitter.emitDimensionFailed(dim.id, new Error(result.error));
        }
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[Insight-v3] Skill generation failed for "${dim.id}": ${errMsg}`);
        skillResults.failed++;
        skillResults.errors.push({ dimId: dim.id, error: errMsg });
        emitter.emitDimensionFailed(dim.id, err instanceof Error ? err : new Error(errMsg));
    }
}
export function extractSkillKeyFindings(dimReport) {
    const report = dimReport;
    return (report?.findings || [])
        .sort((a, b) => (Number(b.importance) || 5) - (Number(a.importance) || 5))
        .slice(0, 10)
        .map((f) => String(f.finding || ''));
}
export function buildEffectiveSkillAnalysisText({ dim, analysisText, keyFindings, distilled, }) {
    if (analysisText.trim().length >= 100 || keyFindings.length === 0) {
        return analysisText;
    }
    const synthesized = [
        `## ${dim.label || dim.id}`,
        '',
        analysisText.trim(),
        '',
        '## 关键发现',
        '',
        ...keyFindings.map((f, i) => `${i + 1}. ${f}`),
    ];
    if ((distilled?.toolCallSummary?.length ?? 0) > 0) {
        synthesized.push('', '## 探索记录', '');
        for (const s of (distilled?.toolCallSummary ?? []).slice(0, 10)) {
            synthesized.push(`- ${formatToolCallSummary(s)}`);
        }
    }
    const effectiveText = synthesized.join('\n');
    logger.info(`[Insight-v3] Skill "${dim.id}": analysisText too short (${analysisText.trim().length} chars), ` +
        `synthesized from ${keyFindings.length} findings → ${effectiveText.length} chars`);
    return effectiveText;
}
function formatToolCallSummary(summary) {
    if (typeof summary === 'string') {
        return summary;
    }
    return [summary.tool, summary.summary].filter(Boolean).join(': ') || 'unknown tool call';
}
export function consumeBootstrapTierReflection({ tierIndex, tierResults, sessionStore, }) {
    const tierStats = [...tierResults.values()];
    const totalCandidates = tierStats.reduce((s, r) => s + (r.candidateCount || 0), 0);
    logger.info(`[Insight-v3] Tier ${tierIndex + 1} complete: ${tierResults.size} dimensions, ${totalCandidates} candidates`);
    try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- SessionStore structurally compatible
        const reflection = buildTierReflection(tierIndex, tierResults, sessionStore);
        sessionStore.addTierReflection(tierIndex, reflection);
        logger.info(`[Insight-v3] Tier ${tierIndex + 1} reflection: ` +
            `${reflection.topFindings.length} top findings, ` +
            `${reflection.crossDimensionPatterns.length} patterns`);
        return reflection;
    }
    catch (refErr) {
        logger.warn(`[Insight-v3] Tier ${tierIndex + 1} reflection failed: ${refErr instanceof Error ? refErr.message : String(refErr)}`);
        return null;
    }
}

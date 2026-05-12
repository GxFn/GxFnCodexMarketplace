import fs from 'node:fs/promises';
import path from 'node:path';
import Logger from '#infra/logging/Logger.js';
import { writeWorkflowReportHistory, writeWorkflowReportHistoryWithWriteZone, } from '#workflows/capabilities/persistence/WorkflowReportHistoryStore.js';
const logger = Logger.getInstance();
export async function writeWorkflowReport({ ctx, dataRoot, sessionId, projectRoot, projectInfo, dimensionStats, candidateResults, skillResults, consolidationResult, completionSummary, snapshotSummary, skippedDims, incrementalSkippedDims, isIncremental, incrementalPlan, totalTimeMs, totalTokenUsage, totalToolCalls, }) {
    try {
        const report = buildWorkflowReport({
            sessionId,
            projectInfo,
            dimensionStats,
            candidateResults,
            skillResults,
            consolidationResult,
            completionSummary,
            snapshotSummary,
            skippedDims,
            incrementalSkippedDims,
            isIncremental,
            incrementalPlan,
            totalTimeMs,
            totalTokenUsage,
            totalToolCalls,
        });
        await attachCodeEntityGraphTopology({ ctx, projectRoot, report });
        await writeWorkflowReportFile({ ctx, dataRoot, report });
        logger.info(`[Insight-v3] 📊 Workflow report saved to .asd/bootstrap-report.json`);
        return report;
    }
    catch (reportErr) {
        logger.warn(`[Insight-v3] Bootstrap report generation failed: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
        return null;
    }
}
export function buildWorkflowReport({ sessionId, projectInfo, dimensionStats, candidateResults, skillResults, consolidationResult, completionSummary, snapshotSummary, skippedDims, incrementalSkippedDims, isIncremental, incrementalPlan, totalTimeMs, totalTokenUsage, totalToolCalls, }) {
    const toolUsage = summarizeReportToolUsage(dimensionStats);
    const terminal = summarizeReportTerminalUsage(dimensionStats);
    const stageToolsets = summarizeReportStageToolsets(dimensionStats);
    const terminalCapability = inferTerminalCapability(stageToolsets);
    const terminalEnabled = terminalCapability !== 'baseline' || terminal.enabled;
    const report = {
        version: '2.7.0',
        timestamp: new Date().toISOString(),
        session: {
            id: sessionId || null,
            mode: isIncremental && incrementalPlan ? 'incremental' : 'full',
            startedAt: new Date(Date.now() - totalTimeMs).toISOString(),
            completedAt: new Date().toISOString(),
            terminalEnabled: terminalCapability !== 'baseline',
            terminalCapability,
        },
        project: {
            name: projectInfo.name,
            files: projectInfo.fileCount,
            lang: projectInfo.lang,
        },
        duration: {
            totalMs: totalTimeMs,
            totalSec: Math.round(totalTimeMs / 1000),
        },
        dimensions: {},
        totals: {
            candidates: candidateResults.created,
            skills: skillResults.created,
            toolCalls: totalToolCalls,
            tokenUsage: totalTokenUsage,
            errors: candidateResults.errors.length,
        },
        stageToolsets,
        toolUsage,
        terminal: { ...terminal, enabled: terminalEnabled },
        comparisonHints: {
            durationMs: totalTimeMs,
            candidates: candidateResults.created,
            toolCalls: totalToolCalls,
            terminalEnabled,
            terminalSuccessRate: terminal.successRate,
        },
        checkpoints: {
            restored: skippedDims,
        },
        incremental: isIncremental && incrementalPlan
            ? {
                mode: 'incremental',
                affectedDimensions: incrementalPlan.affectedDimensions,
                skippedDimensions: incrementalSkippedDims,
                diff: incrementalPlan.diff
                    ? {
                        added: incrementalPlan.diff.added.length,
                        modified: incrementalPlan.diff.modified.length,
                        deleted: incrementalPlan.diff.deleted.length,
                        unchanged: incrementalPlan.diff.unchanged.length,
                    }
                    : null,
                reason: incrementalPlan.reason,
            }
            : null,
        semanticMemory: consolidationResult
            ? {
                added: consolidationResult.total.added,
                updated: consolidationResult.total.updated,
                merged: consolidationResult.total.merged,
                skipped: consolidationResult.total.skipped,
                durationMs: consolidationResult.durationMs,
            }
            : null,
        completion: completionSummary ?? null,
        snapshot: snapshotSummary ?? null,
    };
    for (const [dimId, stat] of Object.entries(dimensionStats)) {
        report.dimensions[dimId] = {
            candidatesSubmitted: stat.candidateCount || 0,
            candidatesRejected: stat.rejectedCount || 0,
            analysisChars: stat.analysisChars || 0,
            referencedFiles: stat.referencedFiles || 0,
            durationMs: stat.durationMs || 0,
            toolCallCount: stat.toolCallCount || 0,
            tokenUsage: stat.tokenUsage || { input: 0, output: 0 },
            qualityGate: stat.qualityGate || null,
            stages: stat.stages || {},
        };
    }
    return report;
}
function summarizeReportStageToolsets(dimensionStats) {
    const seen = new Set();
    const result = [];
    for (const [dimensionId, stat] of Object.entries(dimensionStats)) {
        const diagnostics = stat.diagnostics;
        for (const toolset of diagnostics?.stageToolsets || []) {
            const key = JSON.stringify([
                dimensionId,
                toolset.stage,
                toolset.source,
                toolset.allowedToolIds,
            ]);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            result.push({ dimensionId, ...toolset });
        }
    }
    return result;
}
function summarizeReportToolUsage(dimensionStats) {
    const byTool = {};
    const byStage = {};
    let blocked = 0;
    let needsConfirmation = 0;
    let timeouts = 0;
    let durationTotal = 0;
    let durationCount = 0;
    for (const stat of Object.values(dimensionStats)) {
        const diagnostics = stat.diagnostics;
        for (const call of diagnostics?.toolCalls || []) {
            byTool[call.tool] = (byTool[call.tool] || 0) + 1;
            const stage = call.source || 'unknown';
            byStage[stage] = (byStage[stage] || 0) + 1;
            if (call.status === 'blocked') {
                blocked++;
            }
            if (call.status === 'needs-confirmation') {
                needsConfirmation++;
            }
            if (call.status === 'timeout') {
                timeouts++;
            }
            if (typeof call.durationMs === 'number') {
                durationTotal += call.durationMs;
                durationCount++;
            }
        }
    }
    const total = Object.values(byTool).reduce((sum, count) => sum + count, 0);
    return {
        total,
        byTool,
        byStage,
        blocked,
        needsConfirmation,
        timeouts,
        avgDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : 0,
    };
}
function summarizeReportTerminalUsage(dimensionStats) {
    const commands = [];
    let blocked = 0;
    let ptyRuns = 0;
    let success = 0;
    let total = 0;
    for (const [dimensionId, stat] of Object.entries(dimensionStats)) {
        const diagnostics = stat.diagnostics;
        for (const call of diagnostics?.toolCalls || []) {
            if (call.tool !== 'terminal' && !call.tool.startsWith('terminal_')) {
                continue;
            }
            total++;
            if (call.ok) {
                success++;
            }
            if (call.status === 'blocked' || call.status === 'needs-confirmation') {
                blocked++;
            }
            if (call.tool === 'terminal_pty') {
                ptyRuns++;
            }
            commands.push({
                dimensionId,
                tool: call.tool,
                status: call.status,
                ok: call.ok,
                durationMs: call.durationMs,
            });
        }
    }
    return {
        enabled: total > 0,
        commands,
        ptyRuns,
        blocked,
        transcriptRefs: [],
        successRate: total > 0 ? success / total : 0,
    };
}
function inferTerminalCapability(stageToolsets) {
    const tools = new Set(stageToolsets.flatMap((toolset) => Array.isArray(toolset.allowedToolIds)
        ? toolset.allowedToolIds.filter((tool) => typeof tool === 'string')
        : []));
    if (tools.has('terminal_pty')) {
        return 'terminal-pty';
    }
    if (tools.has('terminal_shell')) {
        return 'terminal-shell';
    }
    if (tools.has('terminal')) {
        return 'terminal-run';
    }
    return 'baseline';
}
async function attachCodeEntityGraphTopology({ ctx, projectRoot, report, }) {
    try {
        const { CodeEntityGraph } = await import('#service/knowledge/CodeEntityGraph.js');
        const entityRepo = ctx.container.get('codeEntityRepository');
        const edgeRepo = ctx.container.get('knowledgeEdgeRepository');
        if (entityRepo && edgeRepo) {
            const ceg = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot, logger });
            const topo = await ceg.getTopology();
            report.codeEntityGraph = {
                entities: topo.entities,
                edges: topo.edges,
                totalEntities: topo.totalEntities,
                totalEdges: topo.totalEdges,
                hotNodes: topo.hotNodes?.slice(0, 5),
            };
        }
    }
    catch {
        /* non-blocking */
    }
}
async function writeWorkflowReportFile({ ctx, dataRoot, report, }) {
    const writeZone = ctx.container.singletons?.writeZone;
    if (writeZone) {
        await writeZone.writeFileAsync(writeZone.runtime('bootstrap-report.json'), JSON.stringify(report, null, 2));
        await writeWorkflowReportHistoryWithWriteZone(writeZone, report);
        return;
    }
    const reportDir = path.join(dataRoot, '.asd');
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, 'bootstrap-report.json'), JSON.stringify(report, null, 2));
    await writeWorkflowReportHistory(reportDir, report);
}

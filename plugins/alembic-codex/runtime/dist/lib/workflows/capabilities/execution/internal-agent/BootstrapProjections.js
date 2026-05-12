/**
 * BootstrapProjections — AgentRunResult 到领域结构的投影层
 *
 * 将 AgentRuntime 返回的原始 AgentRunResult 投影为 Bootstrap 领域所需的
 * 结构化数据（维度分析报告、候选提取、会话统计等），供 BootstrapConsumers 消费。
 */
export function projectAgentRunResult(result) {
    return {
        reply: result.reply,
        toolCalls: result.toolCalls,
        tokenUsage: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
        },
        phases: result.phases,
        degraded: result.diagnostics?.degraded || false,
        diagnostics: result.diagnostics,
        iterations: result.usage.iterations,
        durationMs: result.usage.durationMs,
    };
}
export function projectBootstrapDimensionAgentOutput({ dimId, needsCandidates, runResult, }) {
    const analyzeResult = runResult?.phases?.analyze;
    const gateResult = runResult?.phases?.quality_gate;
    const produceResult = runResult?.phases?.produce;
    const analysisText = (analyzeResult?.reply || runResult?.reply || '').trim();
    const artifact = gateResult?.artifact || {
        analysisText,
        referencedFiles: [],
        findings: [],
        metadata: { toolCallCount: 0 },
    };
    const runtimeToolCalls = runResult?.toolCalls || [];
    const combinedTokenUsage = runResult?.tokenUsage || { input: 0, output: 0 };
    const referencedFiles = artifact.referencedFiles?.length > 0
        ? artifact.referencedFiles
        : [
            ...new Set(runtimeToolCalls.flatMap((tc) => {
                const a = tc?.args || tc?.params || {};
                const files = [];
                if (typeof a.filePath === 'string' && a.filePath.trim()) {
                    files.push(a.filePath.trim());
                }
                if (Array.isArray(a.filePaths)) {
                    for (const f of a.filePaths) {
                        if (typeof f === 'string' && f.trim()) {
                            files.push(f.trim());
                        }
                    }
                }
                return files;
            })),
        ];
    const analysisReport = {
        dimensionId: dimId,
        analysisText: artifact.analysisText || analysisText,
        findings: artifact.findings || [],
        referencedFiles,
        evidenceMap: artifact.evidenceMap || null,
        negativeSignals: artifact.negativeSignals || [],
        metadata: {
            toolCallCount: runtimeToolCalls.length,
            tokenUsage: combinedTokenUsage,
            artifactVersion: artifact.metadata?.artifactVersion || 1,
        },
    };
    const submitCalls = runtimeToolCalls.filter((tc) => {
        const tool = tc?.tool || tc?.name;
        if (tool !== 'knowledge') {
            return false;
        }
        const args = (tc?.args || tc?.params);
        return args?.action === 'submit';
    });
    const successCount = submitCalls.filter((tc) => {
        const res = tc?.result;
        if (!res) {
            return true;
        }
        if (typeof res === 'string') {
            return !res.includes('rejected') && !res.includes('error');
        }
        const resObj = res;
        if (resObj.error) {
            return false;
        }
        if (resObj.submitted === false) {
            return false;
        }
        return resObj.status !== 'rejected' && resObj.status !== 'error';
    }).length;
    const rejectedCount = submitCalls.length - successCount;
    return {
        analyzeResult,
        gateResult,
        produceResult,
        analysisText,
        artifact,
        runtimeToolCalls,
        combinedTokenUsage,
        analysisReport,
        producerResult: {
            candidateCount: needsCandidates ? successCount : 0,
            rejectedCount: needsCandidates ? rejectedCount : 0,
            toolCalls: runtimeToolCalls,
            reply: produceResult?.reply || analysisText,
            tokenUsage: combinedTokenUsage,
        },
        submitCalls,
        successCount,
        rejectedCount,
    };
}
export function normalizeDimensionFindings(findings) {
    return (findings || [])
        .map((finding) => {
        if (typeof finding === 'string') {
            const normalizedFinding = finding.trim();
            return normalizedFinding ? { finding: normalizedFinding } : null;
        }
        return finding;
    })
        .filter((finding) => !!finding);
}
export function projectBootstrapSessionResult({ parentRunResult, activeDimIds, skippedDimIds, }) {
    const dimensionResults = toBootstrapSessionDimensionResults(parentRunResult);
    const skipped = new Set(skippedDimIds);
    const runnableDimIds = activeDimIds.filter((dimId) => !skipped.has(dimId));
    const failedStatuses = new Set(['error', 'blocked', 'timeout']);
    const failedDimensionIds = Object.entries(dimensionResults)
        .filter(([, result]) => failedStatuses.has(result.status))
        .map(([dimId]) => dimId);
    const abortedDimensionIds = Object.entries(dimensionResults)
        .filter(([, result]) => result.status === 'aborted')
        .map(([dimId]) => dimId);
    const missingDimensionIds = runnableDimIds.filter((dimId) => !dimensionResults[dimId]);
    return {
        dimensionResults,
        completedDimensions: Object.keys(dimensionResults).length,
        failedDimensionIds,
        abortedDimensionIds,
        missingDimensionIds,
        parentStatus: parentRunResult.status,
    };
}
export function toBootstrapSessionDimensionResults(parentRunResult) {
    const dimensionResults = parentRunResult.phases?.dimensionResults;
    if (!dimensionResults ||
        typeof dimensionResults !== 'object' ||
        Array.isArray(dimensionResults)) {
        return {};
    }
    return dimensionResults;
}

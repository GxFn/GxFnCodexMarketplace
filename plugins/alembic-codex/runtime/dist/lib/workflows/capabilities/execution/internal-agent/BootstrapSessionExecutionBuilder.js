import Logger from '#infra/logging/Logger.js';
import { buildBootstrapSessionRunInput, } from '#workflows/capabilities/execution/internal-agent/BootstrapInputBuilders.js';
const logger = Logger.getInstance();
export function buildBootstrapSessionExecutionInput({ sessionId, activeDimIds, skippedDimIds, concurrency, primaryLang, projectLang, sessionAbortSignal, taskManager, scheduler, dimensionStats, resolvePlan, createDimensionRunInput, emitDimensionStart, consumeDimensionResult, consumeDimensionError, consumeTierResult, }) {
    const childExecutionState = new Map();
    const children = activeDimIds
        .filter((dimId) => !skippedDimIds.includes(dimId))
        .map((dimId) => buildBootstrapDimensionChildPlan({
        dimId,
        sessionId,
        primaryLang,
        projectLang,
        sessionAbortSignal,
        scheduler,
        resolvePlan,
        createDimensionRunInput,
        emitDimensionStart,
        childExecutionState,
    }))
        .filter((plan) => !!plan);
    const input = buildBootstrapSessionRunInput({
        sessionId,
        children,
        params: {
            concurrency,
        },
        message: {
            content: 'Bootstrap session',
            metadata: { sessionId },
        },
        context: {
            lang: primaryLang || projectLang || null,
            coordination: {
                onChildResult: async ({ childInput, result, }) => {
                    const dimId = getBootstrapChildDimensionId(childInput);
                    if (!dimId) {
                        return;
                    }
                    if (result.status === 'error' || result.status === 'aborted') {
                        consumeDimensionError({ dimId, err: result.reply || 'child-run-error' });
                        return;
                    }
                    const plan = resolvePlan(dimId);
                    const state = childExecutionState.get(dimId);
                    if (!plan || !state) {
                        return;
                    }
                    await consumeDimensionResult({
                        dimId,
                        plan,
                        agentRunResult: result,
                        dimStartTime: state.dimStartTime,
                        analystScopeId: state.analystScopeId,
                    });
                },
                onTierComplete: ({ tierIndex, childInputs, }) => {
                    const tierResults = new Map();
                    for (const childInput of childInputs) {
                        const dimId = getBootstrapChildDimensionId(childInput);
                        if (!dimId || !dimensionStats[dimId]) {
                            continue;
                        }
                        tierResults.set(dimId, dimensionStats[dimId]);
                    }
                    consumeTierResult(tierIndex, tierResults);
                },
            },
        },
        execution: {
            abortSignal: sessionAbortSignal || undefined,
            shouldAbort: () => !!(taskManager &&
                (!taskManager.isSessionValid(sessionId) || taskManager.isUserCancelled?.(sessionId))),
        },
        presentation: { responseShape: 'system-task-result' },
    });
    logger.debug?.(`[Insight-v3] Prepared bootstrap-session parent input: ${input.params?.dimensions?.length || 0} child runs`);
    return { input, childExecutionState };
}
function buildBootstrapDimensionChildPlan({ dimId, sessionId, primaryLang, projectLang, sessionAbortSignal, scheduler, resolvePlan, createDimensionRunInput, emitDimensionStart, childExecutionState, }) {
    const plan = resolvePlan(dimId);
    if (!plan) {
        return null;
    }
    return {
        id: dimId,
        label: plan.dimConfig.label || plan.dim.label || dimId,
        tier: resolveBootstrapDimensionTier(dimId, plan.dim, scheduler),
        input: buildBootstrapDimensionPlannedInput({
            dimId,
            plan,
            sessionId,
            primaryLang,
            projectLang,
            sessionAbortSignal,
        }),
        lazyInputFactory: () => {
            const dimStartTime = beginBootstrapDimensionExecution({
                dimId,
                dimConfig: plan.dimConfig,
                emitDimensionStart,
            });
            const { analystScopeId, runInput } = createDimensionRunInput(dimId, plan);
            childExecutionState.set(dimId, { dimStartTime, analystScopeId });
            return runInput;
        },
    };
}
function buildBootstrapDimensionPlannedInput({ dimId, plan, sessionId, primaryLang, projectLang, sessionAbortSignal, }) {
    return {
        profile: { id: 'bootstrap-dimension' },
        params: {
            dimId,
            needsCandidates: plan.needsCandidates,
            hasExistingRecipes: plan.hasExistingRecipes,
            prescreenDone: plan.prescreenDone,
        },
        message: {
            role: 'internal',
            content: `Bootstrap dimension: ${plan.dimConfig.label || dimId}`,
            sessionId,
            metadata: {
                sessionId,
                dimension: dimId,
                phase: 'bootstrap',
            },
        },
        context: {
            source: 'bootstrap',
            runtimeSource: 'system',
            lang: primaryLang || projectLang || null,
            promptContext: {
                dimId,
                dimensionId: dimId,
            },
        },
        execution: {
            abortSignal: sessionAbortSignal || undefined,
        },
        presentation: { responseShape: 'system-task-result' },
    };
}
export function resolveBootstrapDimensionTier(dimId, dim, scheduler) {
    if (typeof dim.tierHint === 'number') {
        return Math.max(0, dim.tierHint - 1);
    }
    const tierIndex = scheduler.getTierIndex(dimId);
    return tierIndex >= 0 ? tierIndex : 0;
}
function beginBootstrapDimensionExecution({ dimId, dimConfig, emitDimensionStart, }) {
    emitDimensionStart(dimId);
    logger.info(`[Insight-v3] ── Dimension "${dimId}" (${dimConfig.label}) ──`);
    return Date.now();
}
export function getBootstrapChildDimensionId(childInput) {
    return typeof childInput.params?.dimId === 'string' ? childInput.params.dimId : null;
}

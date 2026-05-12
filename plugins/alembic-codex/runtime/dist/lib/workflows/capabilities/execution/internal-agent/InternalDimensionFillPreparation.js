import Logger from '#infra/logging/Logger.js';
import { BootstrapEventEmitter } from '#service/bootstrap/BootstrapEventEmitter.js';
import { resolveDataRoot } from '#shared/resolveProjectRoot.js';
const logger = Logger.getInstance();
export function prepareInternalDimensionFillRun(view, dimensions) {
    const { snapshot, projectRoot } = view;
    const ctx = view.ctx;
    const dataRoot = resolveDataRoot(ctx.container) || projectRoot;
    const incrementalPlan = snapshot.incrementalPlan;
    const isIncremental = incrementalPlan?.canIncremental === true && incrementalPlan.mode === 'incremental';
    const emitter = new BootstrapEventEmitter(ctx.container);
    let taskManager = null;
    try {
        taskManager = ctx.container.get('bootstrapTaskManager');
    }
    catch {
        /* not available */
    }
    let agentService = null;
    let systemRunContextFactory = null;
    let isMockMode = false;
    try {
        const manager = ctx.container.singletons?._aiProviderManager;
        isMockMode = manager?.isMock ?? false;
        if (!isMockMode) {
            agentService = ctx.container.get('agentService');
            systemRunContextFactory = ctx.container.get('systemRunContextFactory');
        }
    }
    catch {
        /* not available */
    }
    logger.info(`[InternalDimensionExecution] ═══ entered — ${isIncremental ? 'INCREMENTAL' : 'FULL'} pipeline`);
    return {
        view,
        dimensions,
        ctx,
        projectRoot,
        dataRoot,
        depGraphData: snapshot.dependencyGraph,
        guardAudit: snapshot.guardAudit,
        primaryLang: snapshot.language.primaryLang ?? 'unknown',
        astProjectSummary: snapshot.ast,
        incrementalPlan,
        panoramaResult: snapshot.panorama,
        callGraphResult: snapshot.callGraph,
        existingRecipes: view.existingRecipes ?? null,
        evolutionPrescreen: view.evolutionPrescreen ?? null,
        rescanExecutionDecisions: view.rescanExecutionDecisions,
        targetFileMap: view.targetFileMap,
        taskManager,
        sessionId: view.bootstrapSession?.id ?? '',
        sessionAbortSignal: taskManager?.getSessionAbortSignal?.() ?? null,
        isIncremental,
        emitter,
        allFiles: snapshot.allFiles,
        agentService,
        systemRunContextFactory,
        isMockMode,
        skipTargetDelivery: view.skipTargetDelivery === true,
    };
}
export function emitInternalDimensionFillAiUnavailable(preparation) {
    logger.error('[Insight-v3] AI Provider not available — bootstrap requires AI');
    preparation.emitter.emitProgress('bootstrap:ai-unavailable', {
        message: 'AI Provider 不可用，Bootstrap 需要 AI 才能运行。请先配置 AI Provider（如 OpenAI、Anthropic 等）后重试。',
    });
    for (const dim of preparation.dimensions) {
        preparation.emitter.emitDimensionComplete(dim.id, {
            type: 'skipped',
            reason: 'ai-unavailable',
        });
    }
}

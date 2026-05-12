export function buildTaskDefs(dimensions) {
    return dimensions.map((dim) => ({
        id: dim.id,
        meta: {
            type: dim.skillWorthy ? 'skill' : 'candidate',
            dimId: dim.id,
            label: dim.label,
            skillWorthy: !!dim.skillWorthy,
            skillMeta: dim.skillMeta || null,
        },
    }));
}
export function startTaskManagerSession(container, taskDefs, logger, logPrefix) {
    try {
        const taskManager = container.get('bootstrapTaskManager');
        return taskManager.startSession(taskDefs);
    }
    catch (err) {
        logger.warn(`[${logPrefix}] BootstrapTaskManager init failed (graceful degradation): ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
export function dispatchPipelineFill(view, dimensions, fillDimensions, logPrefix) {
    const ctxLogger = view.ctx.logger;
    setImmediate(() => {
        ctxLogger?.info(`[${logPrefix}] Dispatching v3 AI-First pipeline`);
        fillDimensions(view, dimensions).catch((err) => {
            ctxLogger?.error(`[${logPrefix}] Async fill failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    });
}

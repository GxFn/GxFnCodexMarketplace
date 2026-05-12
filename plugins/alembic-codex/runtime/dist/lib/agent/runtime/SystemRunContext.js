function isRecord(value) {
    return !!value && typeof value === 'object';
}
function stripUndefined(input) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
export function createSystemRunContext(options) {
    const activeContext = options.activeContext ?? options.memoryCoordinator.getActiveContext(options.scopeId);
    if (!activeContext) {
        throw new Error(`SystemRunContext requires an ActiveContext for scope "${options.scopeId}"`);
    }
    const trace = options.trace ?? activeContext;
    if (trace !== activeContext && !options.allowDistinctActiveContext) {
        throw new Error('SystemRunContext trace and activeContext must refer to the same scope');
    }
    const sharedState = {
        ...(options.sharedState || {}),
        ...(options.projectLanguage !== undefined ? { _projectLanguage: options.projectLanguage } : {}),
        ...(options.dimensionMeta ? { _dimensionMeta: options.dimensionMeta } : {}),
        _dimensionScopeId: options.scopeId,
    };
    return stripUndefined({
        ...(options.extraFields || {}),
        scopeId: options.scopeId,
        contextWindow: options.contextWindow || null,
        tracker: options.tracker || null,
        trace,
        activeContext,
        memoryCoordinator: options.memoryCoordinator,
        sharedState,
        source: options.source || 'system',
        outputType: options.outputType,
        dimId: options.dimId,
        dimensionId: options.dimensionId,
        dimensionLabel: options.dimensionLabel,
        projectLanguage: options.projectLanguage,
        submitToolName: options.submitToolName,
        pipelineType: options.pipelineType,
    });
}
export function isSystemRunContext(value) {
    return (isRecord(value) &&
        typeof value.scopeId === 'string' &&
        isRecord(value.sharedState) &&
        !!value.memoryCoordinator);
}
export function projectSystemRunContext(context) {
    return stripUndefined({
        ...context,
        systemRunContext: context,
        contextWindow: context.contextWindow || null,
        tracker: context.tracker || null,
        trace: context.trace,
        activeContext: context.activeContext,
        memoryCoordinator: context.memoryCoordinator,
        sharedState: context.sharedState,
        source: context.source,
        outputType: context.outputType,
        dimId: context.dimId,
        dimensionId: context.dimensionId,
        dimensionLabel: context.dimensionLabel,
        scopeId: context.scopeId,
        submitToolName: context.submitToolName,
        pipelineType: context.pipelineType,
    });
}
export function expandSystemRunContext(input) {
    const systemRunContext = input.systemRunContext;
    if (!isSystemRunContext(systemRunContext)) {
        return input;
    }
    const sharedState = isRecord(input.sharedState)
        ? { ...systemRunContext.sharedState, ...input.sharedState }
        : systemRunContext.sharedState;
    return {
        ...projectSystemRunContext(systemRunContext),
        ...input,
        systemRunContext,
        sharedState,
    };
}

export function contextFromToolCall(requestContext) {
    const runtime = requestContext.runtime;
    return {
        container: toServiceLocator(requestContext.services),
        serviceContracts: requestContext.serviceContracts,
        projectRoot: requestContext.projectRoot || process.cwd(),
        dataRoot: requestContext.dataRoot || requestContext.projectRoot || process.cwd(),
        ...(runtime && isLogger(runtime.logger) ? { logger: runtime.logger } : {}),
        ...(requestContext.abortSignal ? { abortSignal: requestContext.abortSignal } : {}),
        ...(requestContext.source?.name ? { source: requestContext.source.name } : {}),
        toolCallContext: requestContext,
        ...(runtime?.aiProvider ? { aiProvider: runtime.aiProvider } : {}),
        ...(runtime?.safetyPolicy ? { safetyPolicy: runtime.safetyPolicy } : {}),
        ...(runtime?.fileCache ? { fileCache: runtime.fileCache } : {}),
        ...(typeof runtime?.dataRoot === 'string' ? { dataRoot: runtime.dataRoot } : {}),
        ...(isSharedState(runtime?.sharedState) ? { _sharedState: runtime.sharedState } : {}),
        ...(runtime?.dimensionMeta ? { _dimensionMeta: runtime.dimensionMeta } : {}),
        ...(typeof runtime?.projectLanguage === 'string'
            ? { _projectLanguage: runtime.projectLanguage }
            : {}),
        ...(runtime?.validator ? { _validator: runtime.validator } : {}),
        ...(runtime?.submittedTitles instanceof Set
            ? { _submittedTitles: runtime.submittedTitles }
            : {}),
        ...(runtime?.submittedPatterns instanceof Set
            ? { _submittedPatterns: runtime.submittedPatterns }
            : {}),
        ...(Array.isArray(runtime?.sessionToolCalls)
            ? { _sessionToolCalls: runtime.sessionToolCalls }
            : {}),
        ...(runtime?.bootstrapDedup ? { _bootstrapDedup: runtime.bootstrapDedup } : {}),
        ...(runtime?.memoryCoordinator ? { _memoryCoordinator: runtime.memoryCoordinator } : {}),
        ...(typeof runtime?.currentRound === 'number' ? { _currentRound: runtime.currentRound } : {}),
        ...(typeof runtime?.dimensionScopeId === 'string'
            ? { _dimensionScopeId: runtime.dimensionScopeId }
            : {}),
    };
}
function toServiceLocator(container) {
    if (container &&
        typeof container === 'object' &&
        typeof container.get === 'function') {
        return container;
    }
    return {
        get(name) {
            throw new Error(`Service '${name}' is not available in internal tool context`);
        },
    };
}
function isLogger(value) {
    return (!!value &&
        typeof value === 'object' &&
        typeof value.info === 'function' &&
        typeof value.debug === 'function' &&
        typeof value.warn === 'function');
}
function isSharedState(value) {
    return !!value && typeof value === 'object';
}

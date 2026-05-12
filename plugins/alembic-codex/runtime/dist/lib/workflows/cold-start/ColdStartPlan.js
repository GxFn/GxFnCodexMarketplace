export function buildColdStartWorkflowPlan({ intent, projectRoot, dataRoot, }) {
    const prepare = {
        clearOldData: true,
        ...(intent.executor === 'external-agent' ? { dataRoot } : {}),
    };
    const scan = {
        maxFiles: intent.projectAnalysis.maxFiles,
        contentMaxLines: intent.projectAnalysis.contentMaxLines,
        skipGuard: intent.projectAnalysis.skipGuard,
        sourceTag: intent.projectAnalysis.sourceTag,
        summaryPrefix: intent.projectAnalysis.summaryPrefix,
        generateReport: true,
        generateAstContext: intent.projectAnalysis.generateAstContext,
        incremental: false,
        logPrefix: 'Bootstrap',
    };
    const materialize = {
        codeEntityGraph: true,
        callGraph: true,
        dependencyEdges: true,
        moduleEntities: true,
        guardViolations: true,
        panorama: true,
    };
    return {
        intent,
        cleanup: {
            policy: 'full-reset',
            projectRoot: intent.executor === 'external-agent' ? dataRoot : projectRoot,
            dataRoot,
        },
        projectAnalysis: {
            projectRoot,
            prepare,
            scan,
            materialize,
        },
        response: { tool: 'alembic_bootstrap' },
    };
}
export function selectColdStartDimensions(snapshot, intent) {
    const dimensions = [...snapshot.activeDimensions];
    if (!intent.dimensionIds?.length) {
        return dimensions;
    }
    const requestedIds = new Set(intent.dimensionIds);
    return dimensions.filter((dimension) => requestedIds.has(dimension.id));
}

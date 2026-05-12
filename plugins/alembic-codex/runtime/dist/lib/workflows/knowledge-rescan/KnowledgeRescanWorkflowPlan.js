export function buildKnowledgeRescanWorkflowPlan({ intent, projectRoot, dataRoot, }) {
    const prepare = {};
    const scan = {
        maxFiles: intent.projectAnalysis.maxFiles,
        contentMaxLines: intent.projectAnalysis.contentMaxLines,
        sourceTag: intent.projectAnalysis.sourceTag,
        summaryPrefix: intent.projectAnalysis.summaryPrefix,
        generateReport: true,
        generateAstContext: intent.projectAnalysis.generateAstContext,
        incremental: intent.analysisMode === 'incremental',
        logPrefix: 'Rescan',
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
            policy: intent.cleanupPolicy,
            projectRoot: dataRoot,
        },
        projectAnalysis: {
            projectRoot,
            prepare,
            scan,
            materialize,
        },
        response: { tool: 'alembic_rescan' },
    };
}
export function selectKnowledgeRescanDimensions(dimensions, intent) {
    const allDimensions = [...dimensions];
    if (!intent.dimensionIds?.length) {
        return allDimensions;
    }
    const requestedIds = new Set(intent.dimensionIds);
    return allDimensions.filter((dimension) => requestedIds.has(dimension.id));
}

import { normalizeDimensionIds } from '#workflows/shared/WorkflowTypes.js';
export function createInternalKnowledgeRescanIntent(args) {
    const forceMode = args.force ?? false;
    const cleanupPolicy = forceMode ? 'force-rescan' : 'rescan-clean';
    return {
        kind: 'knowledge-rescan',
        executor: 'internal-agent',
        analysisMode: forceMode ? 'full' : 'incremental',
        cleanupPolicy,
        completionPolicy: 'auto-fill',
        projectAnalysis: {
            maxFiles: 500,
            contentMaxLines: 120,
            sourceTag: 'rescan-internal',
            summaryPrefix: 'Rescan-Internal scan',
            generateAstContext: true,
        },
        dimensionIds: normalizeDimensionIds(args.dimensions),
        reason: args.reason || null,
        internalExecution: {
            skipAsyncFill: args.skipAsyncFill ?? false,
        },
    };
}
export function createExternalKnowledgeRescanIntent(args) {
    const forceMode = args.force ?? false;
    const cleanupPolicy = forceMode ? 'force-rescan' : 'rescan-clean';
    return {
        kind: 'knowledge-rescan',
        executor: 'external-agent',
        analysisMode: forceMode ? 'full' : 'incremental',
        cleanupPolicy,
        completionPolicy: 'external-dimension-complete',
        projectAnalysis: {
            maxFiles: 500,
            contentMaxLines: 120,
            sourceTag: 'rescan-external',
            summaryPrefix: 'Rescan scan',
            generateAstContext: false,
        },
        dimensionIds: normalizeDimensionIds(args.dimensions),
        reason: args.reason || null,
    };
}
// normalizeDimensionIds → imported from WorkflowTypes

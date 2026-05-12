import { normalizeDimensionIds } from '#workflows/shared/WorkflowTypes.js';
export function createInternalColdStartIntent(args = {}) {
    return {
        kind: 'cold-start',
        executor: 'internal-agent',
        analysisMode: 'full',
        cleanupPolicy: 'full-reset',
        completionPolicy: 'auto-fill',
        projectAnalysis: {
            maxFiles: args.maxFiles ?? 500,
            contentMaxLines: args.contentMaxLines ?? 120,
            skipGuard: args.skipGuard ?? false,
            sourceTag: 'bootstrap',
            generateAstContext: true,
        },
        dimensionIds: normalizeDimensionIds(args.dimensions),
        internalExecution: {
            skipAsyncFill: args.skipAsyncFill ?? false,
            skipTargetDelivery: args.skipTargetDelivery ?? false,
        },
        ignoredFileDiffIncremental: args.incremental === true,
    };
}
export function createExternalColdStartIntent() {
    return {
        kind: 'cold-start',
        executor: 'external-agent',
        analysisMode: 'full',
        cleanupPolicy: 'full-reset',
        completionPolicy: 'external-dimension-complete',
        projectAnalysis: {
            maxFiles: 500,
            contentMaxLines: 120,
            skipGuard: false,
            sourceTag: 'bootstrap-external',
            summaryPrefix: 'Bootstrap-external scan',
            generateAstContext: false,
        },
        ignoredFileDiffIncremental: false,
    };
}
// normalizeDimensionIds, normalizeStringArray → imported from WorkflowTypes

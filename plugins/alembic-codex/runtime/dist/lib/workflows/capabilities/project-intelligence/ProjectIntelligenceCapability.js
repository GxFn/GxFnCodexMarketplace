import { prepareProjectAnalysisRun } from '#workflows/capabilities/project-intelligence/ProjectIntelligencePreparation.js';
import { runAllPhases, } from '#workflows/capabilities/project-intelligence/ProjectIntelligenceRunner.js';
export const ProjectIntelligenceCapability = {
    async run({ projectRoot, ctx, prepare, scan, materialize, }) {
        const preparation = await prepareProjectAnalysisRun({
            projectRoot,
            ctx,
            options: prepare ?? {},
        });
        const result = await runAllPhases(projectRoot, ctx, {
            ...(scan ?? {}),
            materialize,
        });
        if (preparation.warnings.length === 0) {
            return result;
        }
        return { ...result, warnings: [...preparation.warnings, ...result.warnings] };
    },
};
export const ProjectAnalysisCapability = ProjectIntelligenceCapability;
export function collectProjectAnalysis(projectRoot, ctx, options = {}) {
    const { materialize, clearOldData, dataRoot, ...scan } = options;
    const prepare = clearOldData !== undefined || dataRoot !== undefined ? { clearOldData, dataRoot } : undefined;
    return ProjectIntelligenceCapability.run({ projectRoot, ctx, prepare, scan, materialize });
}

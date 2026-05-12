import pathGuard from '#shared/PathGuard.js';
export async function prepareProjectAnalysisRun({ projectRoot, ctx, options, }) {
    const warnings = [];
    await ensureProjectAnalysisPathGuard(projectRoot);
    if (options.clearOldData) {
        const clearResult = await clearPreviousProjectAnalysisState({ projectRoot, ctx, options });
        warnings.push(...clearResult.warnings);
    }
    return { warnings };
}
async function ensureProjectAnalysisPathGuard(projectRoot) {
    if (pathGuard.configured) {
        return;
    }
    const { default: Bootstrap } = await import('../../../bootstrap.js');
    Bootstrap.configurePathGuard(projectRoot);
}
async function clearPreviousProjectAnalysisState({ projectRoot, ctx, options, }) {
    const warnings = [];
    try {
        const clearRoot = options.dataRoot || projectRoot;
        const { clearCheckpoints, clearSnapshots } = await import('#workflows/capabilities/execution/internal-agent/InternalDimensionExecutionPipeline.js');
        await clearCheckpoints(clearRoot);
        await clearSnapshots(clearRoot, ctx);
        ctx.logger.info('[Bootstrap] Cleared old checkpoints and snapshots');
    }
    catch (err) {
        warnings.push(`clearOldData failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
    return { warnings };
}

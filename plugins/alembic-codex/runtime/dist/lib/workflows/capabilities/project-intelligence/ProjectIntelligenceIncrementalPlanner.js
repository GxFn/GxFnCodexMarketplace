import { baseDimensions } from '#workflows/capabilities/planning/dimensions/BaseDimensions.js';
export async function evaluateProjectAnalysisIncrementalPlan({ enabled, projectRoot, ctx, allFiles, report, }) {
    const warnings = [];
    if (!enabled) {
        return { incrementalPlan: null, warnings };
    }
    try {
        const { FileDiffPlanner } = await import('#workflows/capabilities/project-intelligence/FileDiffPlanner.js');
        const db = resolveIncrementalDatabase(ctx);
        if (!db) {
            warnings.push('incremental: db not available, falling back to full');
            return { incrementalPlan: null, warnings };
        }
        const fileDiffPlanner = new FileDiffPlanner(db, projectRoot, { logger: ctx.logger });
        const dimensionIds = baseDimensions.map((dimension) => dimension.id);
        const incrementalPlan = fileDiffPlanner.evaluate(allFiles, dimensionIds);
        if (report) {
            report.phases.incremental = { plan: incrementalPlan };
        }
        ctx.logger.info(`[Bootstrap] Incremental mode: ${incrementalPlan.mode}, affected: ${incrementalPlan.affectedDimensions?.length || 0}`);
        return { incrementalPlan, warnings };
    }
    catch (err) {
        warnings.push(`incremental evaluation failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
        return { incrementalPlan: null, warnings };
    }
}
function resolveIncrementalDatabase(ctx) {
    const container = ctx.container;
    if (container && typeof container === 'object') {
        const containerLike = container;
        return (resolveContainerService(containerLike, 'get', 'database') ??
            resolveContainerService(containerLike, 'get', 'db') ??
            resolveContainerService(containerLike, 'resolve', 'database') ??
            resolveContainerService(containerLike, 'resolve', 'db') ??
            ctx.db);
    }
    return ctx.db;
}
function resolveContainerService(container, method, name) {
    const resolver = container[method];
    if (typeof resolver !== 'function') {
        return undefined;
    }
    try {
        return resolver.call(container, name);
    }
    catch {
        return undefined;
    }
}

import { CleanupService, } from '#service/cleanup/CleanupService.js';
function createCleanupService(ctx) {
    return new CleanupService({
        projectRoot: ctx.projectRoot,
        dataRoot: ctx.dataRoot,
        db: ctx.db,
        logger: ctx.logger,
    });
}
export function createCleanupPolicyService(ctx) {
    return createCleanupService(ctx);
}
export async function runFullResetPolicy(ctx) {
    return createCleanupService(ctx).fullReset();
}
export async function runRescanCleanPolicy(ctx) {
    const cleanupService = createCleanupService(ctx);
    const recipeSnapshot = await cleanupService.snapshotRecipes();
    const cleanResult = await cleanupService.rescanClean();
    return { recipeSnapshot, cleanResult };
}
/**
 * 强制 Rescan 清理策略 — 清除会话态缓存但保留增量证据
 * (bootstrap_snapshots, bootstrap_dim_files, recipe_source_refs 不被清除)
 */
export async function runForceRescanCleanPolicy(ctx) {
    const cleanupService = createCleanupService(ctx);
    const recipeSnapshot = await cleanupService.snapshotRecipes();
    const cleanResult = await cleanupService.forceRescanClean();
    return { recipeSnapshot, cleanResult };
}

/**
 * UiStartupTasks — alembic ui 启动后异步后台刷新任务
 *
 * 在 Dashboard 启动后异步执行，不阻塞 UI:
 *   1. syncAll:               .md → DB 全量同步 + sourceRefs 对账
 *   2. staging promote:       到期 staging → active 晋升
 *   3. vector reconcile:      向量对账（best-effort）
 *   4. refreshIndex:          BM25 增量刷新
 *   5. proposalCheck:         启动时兜底清理（过期 Pending + Observing 兜底评估）
 *   6. signalSubscription:    订阅 SignalBus（信号驱动提案评估）
 */
import Logger from '../../infrastructure/logging/Logger.js';
const logger = Logger.getInstance();
/**
 * 异步执行所有启动后台任务。
 * 每个阶段独立 try/catch，一个失败不影响后续。
 */
export async function runUiStartupTasks(ctx) {
    const start = Date.now();
    const report = { durationMs: 0, errors: [] };
    logger.info('[UiStartupTasks] Starting background refresh...');
    // ── Stage 1: syncAll (.md → DB + sourceRefs reconcile) ──
    try {
        // 优先使用容器中已注入的 service（Ghost 模式下 dataRoot 已正确配置）
        let syncService = ctx.container.services.knowledgeSyncService
            ? ctx.container.get('knowledgeSyncService')
            : null;
        if (!syncService) {
            const { KnowledgeSyncService } = await import('../../cli/KnowledgeSyncService.js');
            const { resolveDataRoot } = await import('../../shared/resolveProjectRoot.js');
            const dataRoot = resolveDataRoot(ctx.container) || ctx.projectRoot;
            const sourceRefReconciler = ctx.container.singletons.sourceRefReconciler;
            syncService = new KnowledgeSyncService(dataRoot, {
                sourceRefReconciler: sourceRefReconciler || undefined,
            });
        }
        const db = ctx.container.get('database');
        const syncReport = await syncService.syncAll(db, { skipViolations: true });
        report.syncAll = {
            synced: syncReport.synced,
            created: syncReport.created,
            updated: syncReport.updated,
        };
        if (syncReport.reconcileReport) {
            report.reconcile = {
                inserted: syncReport.reconcileReport.inserted,
                active: syncReport.reconcileReport.active,
                stale: syncReport.reconcileReport.stale,
            };
        }
        logger.info('[UiStartupTasks] Stage 1 complete: syncAll', report.syncAll);
    }
    catch (err) {
        const msg = `syncAll failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    // ── Stage 2: Staging auto-promotion (Bug 2 fix) ──
    try {
        if (ctx.container.services.stagingManager) {
            const sm = ctx.container.get('stagingManager');
            const result = await sm.checkAndPromote();
            report.staging = { promoted: result.promoted.length };
            if (result.promoted.length > 0) {
                logger.info(`[UiStartupTasks] Stage 2: auto-promoted ${result.promoted.length} staging entries`);
            }
        }
    }
    catch (err) {
        const msg = `staging promote failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    // ── Stage 3: Vector reconcile (best-effort) ──
    try {
        if (ctx.container.services.vectorService) {
            const vectorService = ctx.container.get('vectorService');
            if (vectorService.syncCoordinator &&
                typeof vectorService.syncCoordinator.reconcile === 'function') {
                const result = await vectorService.syncCoordinator.reconcile();
                report.vectorReconcile = {
                    orphans: result.orphansRemoved,
                    missing: result.missingQueued,
                };
                logger.info('[UiStartupTasks] Stage 3: vector reconcile complete', report.vectorReconcile);
            }
        }
    }
    catch (err) {
        const msg = `vector reconcile failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    // ── Stage 4: BM25 index refresh ──
    try {
        if (ctx.container.services.searchEngine) {
            const searchEngine = ctx.container.get('searchEngine');
            searchEngine.refreshIndex({ force: true });
            report.indexRefresh = true;
            logger.info('[UiStartupTasks] Stage 4: BM25 index refreshed');
        }
    }
    catch (err) {
        const msg = `index refresh failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    // ── Stage 5: ProposalExecutor — 启动时兜底清理（过期 Pending + Observing 兜底评估） ──
    try {
        if (ctx.container.services.proposalExecutor) {
            const executor = ctx.container.get('proposalExecutor');
            const result = await executor.checkAndExecute();
            report.proposalCheck = {
                executed: result.executed.length,
                rejected: result.rejected.length,
                expired: result.expired.length,
            };
            const total = result.executed.length + result.rejected.length + result.expired.length;
            if (total > 0) {
                logger.info(`[UiStartupTasks] Stage 5: proposal cleanup — executed=${result.executed.length}, rejected=${result.rejected.length}, expired=${result.expired.length}`);
            }
        }
    }
    catch (err) {
        const msg = `proposal cleanup failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    // ── Stage 6: ProposalExecutor — 订阅 SignalBus（信号驱动提案评估） ──
    try {
        if (ctx.container.services.proposalExecutor && ctx.container.services.signalBus) {
            const executor = ctx.container.get('proposalExecutor');
            const signalBus = ctx.container.get('signalBus');
            executor.subscribeToSignals(signalBus);
            logger.info('[UiStartupTasks] Stage 6: ProposalExecutor subscribed to SignalBus');
        }
    }
    catch (err) {
        const msg = `signal subscription failed: ${err.message}`;
        report.errors.push(msg);
        logger.warn(`[UiStartupTasks] ${msg}`);
    }
    report.durationMs = Date.now() - start;
    logger.info(`[UiStartupTasks] All tasks completed in ${report.durationMs}ms`, {
        errors: report.errors.length,
    });
    return report;
}

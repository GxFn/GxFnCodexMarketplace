/**
 * SessionSupport — SessionManager 单例获取与项目分析 Session 缓存
 *
 * 为冷启动和增量扫描提供 BootstrapSessionManager 的单例解析，
 * 以及 Phase 1-4 分析结果的缓存，供后续维度执行复用。
 */
import path from 'node:path';
import { toSessionCache } from '#types/snapshot-views.js';
import { BootstrapSessionManager } from '#workflows/capabilities/execution/external/BootstrapSession.js';
let sessionManager = null;
export function getOrCreateSessionManager(container) {
    try {
        const manager = container.get('bootstrapSessionManager');
        if (manager) {
            return manager;
        }
    }
    catch {
        // Not registered yet.
    }
    if (!sessionManager) {
        sessionManager = new BootstrapSessionManager();
    }
    try {
        container.register?.('bootstrapSessionManager', () => sessionManager);
    }
    catch {
        // Already registered or container does not support registration.
    }
    return sessionManager;
}
export function cacheProjectAnalysisSession(opts) {
    try {
        const sessionManager = getOrCreateSessionManager(opts.container);
        const session = sessionManager.createSession({
            projectRoot: opts.projectRoot,
            dimensions: opts.dimensions.map((dimension) => ({
                ...dimension,
                skillMeta: dimension.skillMeta ?? undefined,
            })),
            projectContext: {
                projectName: path.basename(opts.projectRoot),
                primaryLang: opts.primaryLang,
                fileCount: opts.fileCount,
                modules: opts.moduleCount,
            },
        });
        session.setSnapshotCache(toSessionCache(opts.snapshot));
        return session.id;
    }
    catch (err) {
        opts.logger.warn(`[${opts.logPrefix}] BootstrapSessionManager setup failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}

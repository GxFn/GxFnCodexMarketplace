import Logger from '#infra/logging/Logger.js';
import { FileDiffPlanner } from '#workflows/capabilities/project-intelligence/FileDiffPlanner.js';
const logger = Logger.getInstance();
export function saveWorkflowSnapshot({ ctx, projectRoot, sessionId, allFiles, dimensionStats, sessionStore, totalTimeMs, candidateResults, primaryLang, isIncremental, incrementalPlan, createFileDiffPlanner, }) {
    try {
        const db = ctx.container.get('database');
        if (!db) {
            return { status: 'skipped', id: null, reason: 'database unavailable' };
        }
        if (!allFiles) {
            return { status: 'skipped', id: null, reason: 'file list unavailable' };
        }
        const fileDiffPlanner = createFileDiffPlanner(db, projectRoot);
        const snapshotId = fileDiffPlanner.saveSnapshot({
            sessionId,
            allFiles,
            dimensionStats,
            episodicMemory: sessionStore,
            meta: {
                durationMs: totalTimeMs,
                candidateCount: candidateResults.created,
                primaryLang,
            },
            plan: isIncremental ? incrementalPlan || null : null,
        });
        logger.info(`[Insight-v3] 📸 Snapshot saved: ${snapshotId}`);
        return {
            status: 'saved',
            id: snapshotId,
            fileCount: allFiles.length,
            dimensionCount: Object.keys(dimensionStats).length,
        };
    }
    catch (snapErr) {
        const reason = snapErr instanceof Error ? snapErr.message : String(snapErr);
        logger.warn(`[Insight-v3] Snapshot save failed (non-blocking): ${reason}`);
        return { status: 'failed', id: null, reason };
    }
}
export function createDefaultFileDiffPlanner(db, projectRoot) {
    return new FileDiffPlanner(db, projectRoot, { logger });
}

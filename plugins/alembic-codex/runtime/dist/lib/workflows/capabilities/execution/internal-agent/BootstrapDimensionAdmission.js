import Logger from '#infra/logging/Logger.js';
import { applyRestoredDimensionState, resolveIncrementalSkippedDimensions, restoreCheckpointDimensions, } from '#workflows/capabilities/persistence/DimensionCheckpoint.js';
const logger = Logger.getInstance();
export async function resolveBootstrapDimensionAdmissions({ dataRoot, activeDimIds, isIncremental, incrementalPlan, rescanContext, dimContext, sessionStore, emitter, }) {
    const rescanForceExecuteDimIds = activeDimIds.filter((dimId) => rescanContext?.executionDecisions?.[dimId]?.shouldExecute === true);
    const incrementalSkippedDims = resolveIncrementalSkippedDimensions({
        isIncremental,
        incrementalPlan,
        activeDimIds,
        forceExecuteDimIds: rescanForceExecuteDimIds,
        emitter,
    });
    const checkpointRestoreDimIds = rescanContext ? [] : activeDimIds;
    if (rescanContext && activeDimIds.length > 0) {
        logger.info(`[Insight-v3] Rescan mode: checkpoint restore disabled for active dimensions [${activeDimIds.join(', ')}]`);
    }
    const { completedCheckpoints, skippedDims: checkpointSkippedDims } = await restoreCheckpointDimensions({
        dataRoot,
        activeDimIds: checkpointRestoreDimIds,
        dimContext,
        sessionStore,
        emitter,
    });
    const decisions = buildBootstrapDimensionAdmissionDecisions({
        activeDimIds,
        incrementalSkippedDims,
        checkpointSkippedDims,
        rescanForceExecuteDimIds,
    });
    return {
        decisions,
        skippedDimIds: Object.values(decisions)
            .filter((decision) => decision.status !== 'run')
            .map((decision) => decision.dimId),
        incrementalSkippedDims,
        checkpointSkippedDims,
        rescanForceExecuteDimIds,
        completedCheckpoints,
    };
}
export function buildBootstrapDimensionAdmissionDecisions({ activeDimIds, incrementalSkippedDims, checkpointSkippedDims, rescanForceExecuteDimIds = [], }) {
    const incremental = new Set(incrementalSkippedDims);
    const checkpoint = new Set(checkpointSkippedDims);
    const forced = new Set(rescanForceExecuteDimIds);
    const decisions = {};
    for (const dimId of activeDimIds) {
        if (incremental.has(dimId)) {
            decisions[dimId] = {
                dimId,
                status: 'incremental-restored',
                reason: 'no-change-detected',
            };
            continue;
        }
        if (checkpoint.has(dimId)) {
            decisions[dimId] = {
                dimId,
                status: 'checkpoint-restored',
                reason: 'dimension checkpoint is still valid',
            };
            continue;
        }
        decisions[dimId] = {
            dimId,
            status: 'run',
            reason: forced.has(dimId) ? 'rescan execution decision requires run' : 'admitted',
            ...(forced.has(dimId) ? { forcedByRescan: true } : {}),
        };
    }
    return decisions;
}
export function applyBootstrapDimensionAdmissions({ admissions, sessionStore, dimensionStats, candidateResults, dimensionCandidates, }) {
    applyRestoredDimensionState({
        incrementalSkippedDims: admissions.incrementalSkippedDims,
        checkpointSkippedDims: admissions.checkpointSkippedDims,
        completedCheckpoints: admissions.completedCheckpoints,
        sessionStore,
        dimensionStats,
        candidateResults,
        dimensionCandidates,
    });
}

import { runInternalDimensionExecution } from '#workflows/capabilities/execution/internal-agent/InternalDimensionExecutionPipeline.js';
import { buildTaskDefs, dispatchPipelineFill, startTaskManagerSession, } from '#workflows/capabilities/execution/internal-agent/InternalDimensionFillDispatch.js';
export function buildInternalDimensionExecutionTaskDefs(dimensions) {
    return buildTaskDefs(dimensions);
}
export function startInternalDimensionExecutionSession(opts) {
    const taskDefs = buildInternalDimensionExecutionTaskDefs(opts.dimensions);
    const bootstrapSession = startTaskManagerSession(opts.container, taskDefs, opts.logger, opts.logPrefix);
    return { taskDefs, bootstrapSession };
}
export function dispatchInternalDimensionExecution(opts) {
    dispatchPipelineFill(opts.view, opts.dimensions, runInternalDimensionExecution, opts.logPrefix);
}
export const buildInternalDimensionFillTaskDefs = buildInternalDimensionExecutionTaskDefs;
export const startInternalDimensionFillSession = startInternalDimensionExecutionSession;
export const dispatchInternalDimensionFill = dispatchInternalDimensionExecution;

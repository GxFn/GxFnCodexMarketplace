/**
 * Compatibility adapter for the external dimension completion workflow.
 *
 * The workflow implementation lives in
 * `#workflows/capabilities/execution/external`.
 */
import { envelope } from '#external/mcp/envelope.js';
import { runExternalDimensionCompletionWorkflow, } from '#workflows/capabilities/execution/external/ExternalDimensionCompletionWorkflow.js';
export async function dimensionComplete(ctx, args) {
    return envelope(await runExternalDimensionCompletionWorkflow(ctx, args));
}

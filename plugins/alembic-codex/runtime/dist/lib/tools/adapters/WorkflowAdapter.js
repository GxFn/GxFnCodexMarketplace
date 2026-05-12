import { resolveToolRouterFromContext } from '#tools/core/ToolRoutingServices.js';
export class WorkflowAdapter {
    kind = 'workflow';
    #registry;
    constructor(registry) {
        this.#registry = registry;
    }
    async execute(request) {
        const startedAt = new Date();
        const startedMs = Date.now();
        const workflow = this.#registry.get(request.manifest.id);
        if (!workflow) {
            return envelopeForError(request, startedAt, startedMs, 'Workflow handler not found');
        }
        try {
            const result = await workflow.handler(request.args, createWorkflowHandlerContext(request));
            const errorMessage = extractErrorMessage(result);
            if (errorMessage) {
                return envelopeForError(request, startedAt, startedMs, errorMessage, result);
            }
            return {
                ok: true,
                toolId: request.manifest.id,
                callId: request.context.callId,
                parentCallId: request.context.parentCallId,
                startedAt: startedAt.toISOString(),
                durationMs: Date.now() - startedMs,
                status: 'success',
                text: summarizeResult(result),
                structuredContent: result,
                diagnostics: emptyDiagnostics(),
                trust: {
                    source: 'internal',
                    sanitized: true,
                    containsUntrustedText: false,
                    containsSecrets: false,
                },
            };
        }
        catch (err) {
            return envelopeForError(request, startedAt, startedMs, err instanceof Error ? err.message : String(err));
        }
    }
}
function createWorkflowHandlerContext(request) {
    return {
        toolCallContext: request.context,
        toolRouter: resolveToolRouterFromContext(request.context),
    };
}
function envelopeForError(request, startedAt, startedMs, message, structuredContent = { error: message }) {
    return {
        ok: false,
        toolId: request.manifest.id,
        callId: request.context.callId,
        parentCallId: request.context.parentCallId,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedMs,
        status: 'error',
        text: message,
        structuredContent,
        diagnostics: {
            ...emptyDiagnostics(),
            warnings: [{ code: 'workflow_error', message, tool: request.manifest.id }],
        },
        trust: {
            source: 'internal',
            sanitized: true,
            containsUntrustedText: false,
            containsSecrets: false,
        },
    };
}
function emptyDiagnostics() {
    return {
        degraded: false,
        fallbackUsed: false,
        warnings: [],
        timedOutStages: [],
        blockedTools: [],
        truncatedToolCalls: 0,
        emptyResponses: 0,
        aiErrorCount: 0,
        gateFailures: [],
    };
}
function extractErrorMessage(result) {
    if (result && typeof result === 'object' && 'error' in result) {
        return String(result.error || 'Workflow execution failed');
    }
    return null;
}
function summarizeResult(result) {
    if (result === undefined) {
        return 'Workflow completed with no structured result.';
    }
    if (typeof result === 'string') {
        return result;
    }
    try {
        return JSON.stringify(result);
    }
    catch {
        return 'Workflow completed.';
    }
}
export default WorkflowAdapter;

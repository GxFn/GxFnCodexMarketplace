export class DashboardOperationAdapter {
    kind = 'dashboard-operation';
    #handlers;
    constructor(handlers) {
        this.#handlers = handlers;
    }
    async execute(request) {
        const startedAt = new Date();
        const startedMs = Date.now();
        const handler = this.#handlers[request.manifest.id];
        if (!handler) {
            return envelopeForError(request, startedAt, startedMs, 'Dashboard operation handler not found');
        }
        try {
            const result = await handler(request);
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
                    source: 'user',
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
            warnings: [{ code: 'dashboard_operation_error', message, tool: request.manifest.id }],
        },
        trust: {
            source: 'user',
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
        return String(result.error || 'Dashboard operation failed');
    }
    return null;
}
function summarizeResult(result) {
    if (result === undefined) {
        return 'Dashboard operation completed with no structured result.';
    }
    if (typeof result === 'string') {
        return result;
    }
    if (result && typeof result === 'object') {
        const resultObj = result;
        if (typeof resultObj.message === 'string' && resultObj.message) {
            return resultObj.message;
        }
    }
    try {
        return JSON.stringify(result);
    }
    catch {
        return 'Dashboard operation completed.';
    }
}
export default DashboardOperationAdapter;

import { randomUUID } from 'node:crypto';
import { sendToolEnvelopeResponse } from './tool-envelope-response.js';
const EMPTY_DIAGNOSTICS = {
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
const DEFAULT_TRUST = {
    source: 'internal',
    sanitized: true,
    containsUntrustedText: false,
    containsSecrets: false,
};
/**
 * Dashboard Operations 直接分派到 DASHBOARD_OPERATION_HANDLERS，
 * 不经过 V2 ToolRouter（dashboard 操作不是 LLM 工具）。
 */
export async function executeDashboardOperation(container, req, toolId, args) {
    const callId = randomUUID();
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    try {
        const { DASHBOARD_OPERATION_HANDLERS, DASHBOARD_OPERATION_MANIFESTS } = await import('#tools/adapters/DashboardOperations.js');
        const handler = DASHBOARD_OPERATION_HANDLERS[toolId];
        if (!handler) {
            return errorEnvelope(toolId, callId, startedAt, `Unknown dashboard operation: ${toolId}`);
        }
        const manifest = DASHBOARD_OPERATION_MANIFESTS.find((m) => m.id === toolId);
        const executionRequest = {
            manifest: manifest ?? { id: toolId, kind: 'dashboard-operation' },
            args,
            context: {
                services: container,
                projectRoot: '',
                actor: {
                    role: req.resolvedRole || 'dashboard',
                    user: req.resolvedUser || undefined,
                    sessionId: req.headers['x-session-id'],
                },
                surface: 'dashboard',
            },
            decision: { allowed: true, stage: 'execute' },
        };
        const data = await handler(executionRequest);
        const durationMs = Date.now() - t0;
        return {
            ok: true,
            toolId,
            callId,
            startedAt,
            durationMs,
            status: 'success',
            text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
            structuredContent: data ?? null,
            diagnostics: EMPTY_DIAGNOSTICS,
            trust: DEFAULT_TRUST,
        };
    }
    catch (err) {
        const durationMs = Date.now() - t0;
        return errorEnvelope(toolId, callId, startedAt, err instanceof Error ? err.message : String(err), durationMs);
    }
}
export function sendDashboardOperationResponse(res, envelope) {
    if (!envelope.ok) {
        sendToolEnvelopeResponse(res, envelope);
        return;
    }
    res.json({
        success: true,
        data: envelope.structuredContent ?? envelope,
        toolResult: envelope,
    });
}
function errorEnvelope(toolId, callId, startedAt, error, durationMs = 0) {
    return {
        ok: false,
        toolId,
        callId,
        startedAt,
        durationMs,
        status: 'error',
        text: error,
        diagnostics: EMPTY_DIAGNOSTICS,
        trust: DEFAULT_TRUST,
    };
}

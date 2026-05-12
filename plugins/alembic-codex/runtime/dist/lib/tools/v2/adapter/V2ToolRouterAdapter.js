/**
 * V2ToolRouterAdapter — V2 工具路由器适配到 V1 ToolRouterContract。
 *
 * 职责单一：只处理 V2 工具系统的 6 个核心 LLM 工具 (code/terminal/knowledge/graph/memory/meta)。
 * Dashboard Operations 和 MCP 工具各有独立路由，不经过此 adapter。
 */
import { randomUUID } from 'node:crypto';
import { ToolRouterV2 } from '../router.js';
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
export class V2ToolRouterAdapter {
    router;
    #contextFactory;
    constructor(opts) {
        this.router = new ToolRouterV2({ capability: opts.capability });
        this.#contextFactory = opts.contextFactory;
    }
    async execute(request) {
        const startedAt = new Date().toISOString();
        const callId = randomUUID();
        const t0 = Date.now();
        try {
            const parsed = this.router.parseToolCall(request.toolId, request.args);
            if ('error' in parsed) {
                return this.#errorEnvelope(request.toolId, callId, startedAt, parsed.error);
            }
            const v2CacheHint = this.router.getToolSpec(parsed.tool)?.actions[parsed.action]?.cache ?? 'none';
            const cachePolicy = v2CacheHint === 'delta' ? 'session' : v2CacheHint;
            const ctx = this.#contextFactory.create(request);
            const result = await this.router.execute(parsed, ctx);
            const durationMs = Date.now() - t0;
            return this.#toEnvelope(result, request.toolId, callId, startedAt, durationMs, cachePolicy);
        }
        catch (err) {
            const durationMs = Date.now() - t0;
            return this.#errorEnvelope(request.toolId, callId, startedAt, err instanceof Error ? err.message : String(err), durationMs);
        }
    }
    async executeChildCall(request) {
        return this.execute(request);
    }
    async explain(request) {
        const parsed = this.router.parseToolCall(request.toolId, request.args);
        if ('error' in parsed) {
            return { allowed: false, stage: 'discover', reason: parsed.error };
        }
        const spec = this.router.getToolSpec(parsed.tool);
        if (!spec) {
            return { allowed: false, stage: 'discover', reason: `Unknown tool: ${parsed.tool}` };
        }
        if (!spec.actions[parsed.action]) {
            return {
                allowed: false,
                stage: 'discover',
                reason: `Unknown action: ${parsed.tool}.${parsed.action}`,
            };
        }
        return { allowed: true, stage: 'execute' };
    }
    #toEnvelope(result, toolId, callId, startedAt, durationMs, cachePolicy = 'none') {
        const text = result.ok
            ? typeof result.data === 'string'
                ? result.data
                : JSON.stringify(result.data, null, 2)
            : result.error || 'Unknown error';
        return {
            ok: result.ok,
            toolId,
            callId,
            startedAt,
            durationMs,
            status: result.ok ? 'success' : 'error',
            text,
            structuredContent: result.data,
            cache: {
                hit: result._meta?.cached ?? false,
                policy: cachePolicy,
            },
            diagnostics: EMPTY_DIAGNOSTICS,
            trust: result.ok ? DEFAULT_TRUST : { ...DEFAULT_TRUST, containsUntrustedText: true },
        };
    }
    #errorEnvelope(toolId, callId, startedAt, error, durationMs = 0) {
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
}

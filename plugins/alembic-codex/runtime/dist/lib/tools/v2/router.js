/**
 * @module tools/v2/router
 *
 * V2 ToolRouter — 工具调用的统一入口。
 *
 * 流程: 参数解析 → Schema 校验 → Capability 权限检查 → 并发控制 → Handler 分发 → 输出截断
 */
import { generateLightweightSchemas, TOOL_REGISTRY } from './registry.js';
import { estimateTokens, fail } from './types.js';
export class ToolRouterV2 {
    #config;
    #toolLocks = new Map();
    #globalLock = null;
    #globalRelease = null;
    constructor(config = {}) {
        this.#config = config;
    }
    /**
     * 执行工具调用。
     *
     * 完整流程: 参数校验 → Capability 检查 → 并发控制 → handler → 输出截断
     */
    async execute(call, ctx) {
        const startMs = Date.now();
        try {
            const spec = TOOL_REGISTRY[call.tool];
            const action = spec?.actions[call.action];
            if (!spec || !action) {
                return fail(`Invalid call: ${call.tool}.${call.action} — use parseToolCall() first to validate`);
            }
            const paramError = validateParams(call, action);
            if (paramError) {
                return fail(paramError);
            }
            const capCheck = this.#checkCapability(call.tool, call.action);
            if (!capCheck.allowed) {
                return fail(`Permission denied: ${call.tool}.${call.action} — ${capCheck.reason}`);
            }
            const mode = action.concurrency ?? 'parallel';
            if (mode === 'exclusive') {
                await this.#acquireGlobalLock();
            }
            else if (mode === 'single') {
                await this.#acquireToolLock(call.tool);
            }
            ctx.toolRegistry = TOOL_REGISTRY;
            try {
                const result = await action.handler(call.params, ctx);
                if (result._meta) {
                    result._meta.durationMs = Date.now() - startMs;
                }
                if (action.maxOutputTokens && result.ok) {
                    enforceOutputLimit(result, action.maxOutputTokens);
                }
                return result;
            }
            finally {
                if (mode === 'exclusive') {
                    this.#releaseGlobalLock();
                }
                else if (mode === 'single') {
                    this.#releaseToolLock(call.tool);
                }
            }
        }
        catch (err) {
            return fail(`Tool execution error (${call.tool}.${call.action}): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 并行执行多个工具调用，按均分策略分配 token budget。
     */
    async executeParallel(calls, ctx) {
        if (calls.length === 0) {
            return [];
        }
        const perCallBudget = Math.floor(ctx.tokenBudget / calls.length);
        return Promise.all(calls.map((call) => {
            const callCtx = { ...ctx, tokenBudget: Math.max(perCallBudget, 1000) };
            return this.execute(call, callCtx);
        }));
    }
    /**
     * 从 LLM 的原始 function call 参数解析 ToolCallV2。
     *
     * LLM 返回: { name: "code", arguments: '{"action":"search","params":{...}}' }
     * 解析为:  { tool: "code", action: "search", params: {...} }
     *
     * 验证层级: 解析 → action 存在性检查 → 返回强类型 ToolCallV2
     */
    parseToolCall(name, rawArguments) {
        try {
            const args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments;
            const action = args.action;
            const params = (args.params ?? {});
            if (!action) {
                return { error: `Missing "action" in tool call for ${name}` };
            }
            const spec = TOOL_REGISTRY[name];
            if (!spec) {
                return {
                    error: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_REGISTRY).join(', ')}`,
                };
            }
            if (!spec.actions[action]) {
                return {
                    error: `Unknown action: ${name}.${action}. Available: ${Object.keys(spec.actions).join(', ')}`,
                };
            }
            return { tool: name, action, params };
        }
        catch (err) {
            return {
                error: `Failed to parse tool arguments: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    /**
     * 生成当前 capability 允许的轻量 schema 列表。
     */
    getSchemas() {
        const allowed = this.#config.capability?.allowedTools;
        return generateLightweightSchemas(allowed);
    }
    /**
     * 获取单个工具的完整 spec（用于 meta.tools）。
     */
    getToolSpec(name) {
        return TOOL_REGISTRY[name];
    }
    /* ------------------------------------------------------------------ */
    /*  Capability 权限检查                                                */
    /* ------------------------------------------------------------------ */
    #checkCapability(tool, action) {
        const cap = this.#config.capability;
        if (!cap) {
            return { allowed: true };
        }
        const allowedActions = cap.allowedTools[tool];
        if (!allowedActions) {
            return { allowed: false, reason: `Tool "${tool}" not allowed in capability "${cap.name}"` };
        }
        if (!allowedActions.includes(action)) {
            return {
                allowed: false,
                reason: `Action "${action}" not allowed for "${tool}" in capability "${cap.name}". Allowed: ${allowedActions.join(', ')}`,
            };
        }
        return { allowed: true };
    }
    /* ------------------------------------------------------------------ */
    /*  并发控制 — single (同工具互斥) / exclusive (全局独占)               */
    /* ------------------------------------------------------------------ */
    async #acquireToolLock(tool) {
        while (this.#toolLocks.has(tool)) {
            await this.#toolLocks.get(tool);
        }
        let release;
        const promise = new Promise((r) => {
            release = r;
        });
        promise._release = release;
        this.#toolLocks.set(tool, promise);
    }
    #releaseToolLock(tool) {
        const p = this.#toolLocks.get(tool);
        this.#toolLocks.delete(tool);
        if (p) {
            p._release();
        }
    }
    async #acquireGlobalLock() {
        while (this.#globalLock) {
            await this.#globalLock;
        }
        let release;
        this.#globalLock = new Promise((r) => {
            release = r;
        });
        this.#globalRelease = release;
    }
    #releaseGlobalLock() {
        const release = this.#globalRelease;
        this.#globalLock = null;
        this.#globalRelease = null;
        release?.();
    }
}
/* ------------------------------------------------------------------ */
/*  参数 Schema 校验 — 轻量内联，不依赖 ajv                             */
/* ------------------------------------------------------------------ */
function validateParams(call, action) {
    const schema = action.params;
    if (schema.required) {
        for (const field of schema.required) {
            if (call.params[field] === undefined || call.params[field] === null) {
                return `Missing required param "${field}" for ${call.tool}.${call.action}`;
            }
        }
    }
    if (schema.properties) {
        for (const [key, val] of Object.entries(call.params)) {
            const prop = schema.properties[key];
            if (!prop) {
                continue;
            }
            if (prop.enum && !prop.enum.includes(val)) {
                return (`Invalid value "${String(val)}" for ${call.tool}.${call.action}.${key}. ` +
                    `Expected: ${prop.enum.join(', ')}`);
            }
        }
    }
    return null;
}
/* ------------------------------------------------------------------ */
/*  输出 token 截断 — 按 action.maxOutputTokens 强制执行                */
/* ------------------------------------------------------------------ */
function enforceOutputLimit(result, maxTokens) {
    if (typeof result.data !== 'string') {
        return;
    }
    const tokens = estimateTokens(result.data);
    if (tokens <= maxTokens) {
        return;
    }
    const maxChars = maxTokens * 4;
    const headChars = Math.floor(maxChars * 0.8);
    const tailChars = Math.floor(maxChars * 0.15);
    const head = result.data.slice(0, headChars);
    const tail = result.data.slice(-tailChars);
    const omitted = result.data.length - headChars - tailChars;
    result.data = `${head}\n\n... [${omitted} chars truncated, exceeded ${maxTokens} token limit] ...\n\n${tail}`;
    if (result._meta) {
        result._meta.tokensEstimate = estimateTokens(result.data);
    }
}

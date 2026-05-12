/**
 * DynamicComposer — 运行时动态工具组合
 *
 * 将已有的原子工具按 sequential / parallel / conditional 策略组合成复合工具。
 * 组合结果注册为临时工具（通过 TemporaryToolRegistry）。
 *
 * 与 PipelineStrategy 的区别：
 *   - PipelineStrategy 是 Agent 执行策略（Agent 层）
 *   - DynamicComposer 是工具组合（Tool 层），产出物是单个工具
 */
import Logger from '#infra/logging/Logger.js';
import { resolveToolRouterFromContext } from '#tools/core/ToolRoutingServices.js';
/* ────────────────────── Class ────────────────────── */
export class DynamicComposer {
    #registry;
    #logger = Logger.getInstance();
    constructor(registry) {
        this.#registry = registry;
    }
    /**
     * 验证组合 spec 的可行性。
     *
     * P5 起 composer 只做发现层校验；side-effect / non-composable / risk
     * 交由 child ToolCallRequest 的 GovernanceEngine 决策。
     */
    validate(spec) {
        const missing = [];
        for (const step of spec.steps) {
            if (!this.#registry.has(step.tool)) {
                missing.push(step.tool);
            }
        }
        return {
            valid: missing.length === 0,
            missingTools: missing,
            blockedTools: [],
        };
    }
    /**
     * 构建组合工具
     */
    compose(spec) {
        // 验证
        const { valid, missingTools } = this.validate(spec);
        if (!valid) {
            return {
                success: false,
                error: `Missing tools: ${missingTools.join(', ')}`,
            };
        }
        if (spec.steps.length === 0) {
            return {
                success: false,
                error: 'Composition must have at least one step',
            };
        }
        const logger = this.#logger;
        // 根据策略构建 handler
        const handler = spec.mergeStrategy === 'parallel'
            ? this.#buildParallelHandler(spec, logger)
            : this.#buildSequentialHandler(spec, logger);
        return { success: true, handler };
    }
    /* ── Internal ── */
    #buildSequentialHandler(spec, logger) {
        return async (params, context) => {
            let prevResult = params;
            for (const step of spec.steps) {
                const args = typeof step.args === 'function' ? step.args(prevResult) : { ...step.args, ...params };
                logger.debug(`DynamicComposer [${spec.name}]: executing step "${step.tool}"`);
                const result = await executeCompositionStep(step.tool, args, context);
                if (step.extractKey && typeof result === 'object' && result !== null) {
                    prevResult = result[step.extractKey];
                }
                else {
                    prevResult = result;
                }
            }
            return prevResult;
        };
    }
    #buildParallelHandler(spec, logger) {
        return async (params, context) => {
            logger.debug(`DynamicComposer [${spec.name}]: executing ${spec.steps.length} steps in parallel`);
            const promises = spec.steps.map(async (step) => {
                const args = typeof step.args === 'function' ? step.args(params) : { ...step.args, ...params };
                const result = await executeCompositionStep(step.tool, args, context);
                if (step.extractKey && typeof result === 'object' && result !== null) {
                    return { tool: step.tool, result: result[step.extractKey] };
                }
                return { tool: step.tool, result };
            });
            const results = await Promise.allSettled(promises);
            const merged = {};
            for (const r of results) {
                if (r.status === 'fulfilled') {
                    merged[r.value.tool] = r.value.result;
                }
                else {
                    merged[`error_${Object.keys(merged).length}`] = r.reason?.message ?? 'Unknown error';
                }
            }
            return merged;
        };
    }
}
async function executeCompositionStep(tool, args, context) {
    const parentContext = context.toolCallContext;
    const router = resolveToolRouter(context);
    if (!router || !parentContext) {
        return {
            error: 'DynamicComposer child execution requires ToolRouter context',
            status: 'error',
            tool,
        };
    }
    const envelope = await router.executeChildCall({
        toolId: tool,
        args,
        surface: 'composer',
        actor: parentContext.actor,
        source: {
            kind: 'composer',
            name: parentContext.toolId,
        },
        parentCallId: parentContext.callId,
        abortSignal: parentContext.abortSignal || null,
        runtime: parentContext.runtime,
    });
    if (envelope.ok) {
        return envelope.structuredContent !== undefined
            ? envelope.structuredContent
            : { success: true, message: envelope.text };
    }
    return {
        error: envelope.text,
        status: envelope.status,
        tool,
        envelope,
    };
}
function resolveToolRouter(context) {
    if (context.toolRouter) {
        return context.toolRouter;
    }
    return resolveToolRouterFromContext(context.toolCallContext);
}

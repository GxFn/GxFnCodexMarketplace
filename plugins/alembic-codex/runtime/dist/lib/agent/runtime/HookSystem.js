/**
 * HookSystem — 统一事件与可扩展切点
 *
 * 替代碎片化的 4 个事件通道（AgentEventBus / EventBus / SignalBus / Pipeline Middleware），
 * 提供统一的 hook 注册和分发机制。
 *
 * 设计原则：
 *   - 类型安全：每个 HookEvent 有明确的 payload 类型
 *   - 可组合：支持 sync 和 async hook
 *   - 可拦截：tool:execute:before 支持 block（返回 false 阻止执行）
 *   - 兼容：通过 bridge 连接 AgentEventBus / SignalBus
 *
 * @module core/HookSystem
 */
import Logger from '#infra/logging/Logger.js';
// ── HookSystem Class ──
let _hookCounter = 0;
export class HookSystem {
    #hooks = new Map();
    #logger = Logger;
    /**
     * Register a hook handler.
     *
     * @param event - The event to listen for
     * @param handler - Handler function. For 'tool:execute:before', return false to block.
     * @param opts - Options: priority (lower = earlier, default 100), once (auto-remove after first call)
     * @returns Unsubscribe function
     */
    on(event, handler, opts = {}) {
        const id = `hook_${++_hookCounter}`;
        const entry = {
            event,
            handler,
            priority: opts.priority ?? 100,
            once: opts.once ?? false,
            id,
        };
        if (!this.#hooks.has(event)) {
            this.#hooks.set(event, []);
        }
        const list = this.#hooks.get(event);
        list.push(entry);
        list.sort((a, b) => a.priority - b.priority);
        return () => {
            const idx = list.findIndex((e) => e.id === id);
            if (idx >= 0) {
                list.splice(idx, 1);
            }
        };
    }
    /** Register a one-shot hook. */
    once(event, handler, priority) {
        return this.on(event, handler, { priority, once: true });
    }
    /**
     * Emit an event to all registered hooks.
     *
     * For 'tool:execute:before': if any handler returns false, the tool execution is blocked.
     * All other events are fire-and-forget.
     *
     * @returns For blocking events, returns false if any handler blocked. Otherwise true.
     */
    async emit(event, payload) {
        const list = this.#hooks.get(event);
        if (!list || list.length === 0) {
            return true;
        }
        const toRemove = [];
        let blocked = false;
        for (const entry of list) {
            try {
                const result = entry.handler(payload);
                const resolved = result instanceof Promise ? await result : result;
                if (event === 'tool:execute:before' && resolved === false) {
                    blocked = true;
                }
            }
            catch (err) {
                this.#logger.warn(`[HookSystem] hook error on ${event} (${entry.id}): ${err instanceof Error ? err.message : String(err)}`);
            }
            if (entry.once) {
                toRemove.push(entry.id);
            }
        }
        // Clean up one-shot hooks
        if (toRemove.length > 0) {
            for (const id of toRemove) {
                const idx = list.findIndex((e) => e.id === id);
                if (idx >= 0) {
                    list.splice(idx, 1);
                }
            }
        }
        return !blocked;
    }
    /**
     * Synchronous emit — for performance-critical hooks where async is unnecessary.
     * Does not support blocking (always returns true).
     */
    emitSync(event, payload) {
        const list = this.#hooks.get(event);
        if (!list || list.length === 0) {
            return;
        }
        for (const entry of list) {
            try {
                entry.handler(payload);
            }
            catch (err) {
                this.#logger.warn(`[HookSystem] hook error on ${event} (${entry.id}): ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // Clean up one-shot hooks
        const toRemove = list.filter((e) => e.once).map((e) => e.id);
        for (const id of toRemove) {
            const idx = list.findIndex((e) => e.id === id);
            if (idx >= 0) {
                list.splice(idx, 1);
            }
        }
    }
    /** Remove all hooks for a specific event or all events. */
    clear(event) {
        if (event) {
            this.#hooks.delete(event);
        }
        else {
            this.#hooks.clear();
        }
    }
    /** Get registered hook count for inspection. */
    hookCount(event) {
        if (event) {
            return this.#hooks.get(event)?.length ?? 0;
        }
        let total = 0;
        for (const list of this.#hooks.values()) {
            total += list.length;
        }
        return total;
    }
}
// ── Default hooks registration ──
/**
 * Register default hooks that bridge HookSystem events to existing subsystems.
 * Call this during AgentRuntime initialization.
 *
 * Bridges HookSystem → AgentEventBus for backward compatibility.
 * Pipeline middleware (allowlistGate, observationRecord, trackerSignal,
 * traceRecord, submitDedup) remain in ToolExecutionPipeline because they
 * need synchronous access to tool results and loop state.
 */
export function registerDefaultHooks(hookSystem, agentId, bus) {
    if (!bus) {
        return;
    }
    hookSystem.on('llm:call:before', (p) => {
        bus.publish('llm:call:start', { iteration: p.iteration, toolChoice: p.toolChoice }, { source: agentId });
    });
    hookSystem.on('llm:call:after', (p) => {
        bus.publish('llm:call:end', {
            hasToolCalls: p.hasToolCalls,
            hasText: p.hasText,
            usage: { inputTokens: p.inputTokens, outputTokens: p.outputTokens },
        }, { source: agentId });
    });
    hookSystem.on('agent:exit', (p) => {
        bus.publish('step:completed', {
            reason: p.reason,
            iteration: p.iteration,
            detail: p.detail,
        }, { source: agentId });
    });
    // tool:execute:before/after are NOT bridged to AgentEventBus here
    // because AgentRuntime.#processToolCalls already publishes
    // TOOL_CALL_START/END directly. Bridging would cause duplicates.
}

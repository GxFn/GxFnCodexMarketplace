/**
 * BudgetController — 预算决策 + 压缩触发 + 遥测
 *
 * 从 AgentRuntime 抽离的独立模块，职责:
 *   1. Session token 预算预检 (checkBeforeLLMCall)
 *   2. 压缩触发 (runCompactionCycle / executeL4IfPending)
 *   3. Token 追踪 (recordLLMUsage / cumulativeUsage)
 *   4. 工具预算分摊 (getToolBudget / recordToolCharsUsed)
 *   5. TurnTelemetry 遥测 (emitTurnTelemetry)
 *
 * 生命周期: 每次 reactLoop 创建一个，绑定到 LoopContext。
 * 跨 stage 共享: cumulativeUsage 使用 AgentRuntime.tokenUsage 引用。
 *
 * @module BudgetController
 */
/* ── Constants ─────────────────────────────────────────── */
const COMPRESS_THRESHOLD = 0.75;
const AGGRESSIVE_COMPRESS_THRESHOLD = 0.9;
const DEFAULT_ESTIMATE = 8000;
const MIN_TOOL_CHARS = 400;
/* ── BudgetController ──────────────────────────────────── */
export class BudgetController {
    #maxSessionInputTokens;
    #cumulativeUsage;
    #contextWindow;
    #tracker;
    #baseSystemPromptLength;
    #toolSchemaCount;
    #logger;
    #lastRoundInputTokens = 0;
    #pendingL4 = false;
    #consecutiveZeroCacheHits = 0;
    // telemetry accumulators
    #iterationCount = 0;
    #peakSessionUsageRatio = 0;
    #maxCompactionLevel = 0;
    #totalCompactedItems = 0;
    #forcedSummarize = false;
    // per-round tool budget state
    #roundMaxChars = 0;
    #roundCharsUsed = 0;
    #roundPerToolMaxMatches = 0;
    constructor(config) {
        this.#maxSessionInputTokens = config.maxSessionInputTokens;
        this.#cumulativeUsage = config.cumulativeUsage;
        this.#contextWindow = config.contextWindow;
        this.#tracker = config.tracker;
        this.#baseSystemPromptLength = config.baseSystemPromptLength;
        this.#toolSchemaCount = config.toolSchemaCount;
        this.#logger = config.logger;
    }
    /* ═══════════════════════════════════════════════════════
     *  预算决策
     * ═══════════════════════════════════════════════════════ */
    get hasSessionBudget() {
        return this.#maxSessionInputTokens > 0;
    }
    get sessionUsageRatio() {
        if (!this.hasSessionBudget) {
            return 0;
        }
        return this.#cumulativeUsage.input / this.#maxSessionInputTokens;
    }
    /**
     * LLM 调用前的预算预检。
     *
     * 职责链:
     *   1. 估算下一轮 input token
     *   2. 计算 projected session 使用率
     *   3. 同步 sessionPressure 到 ContextWindow
     *   4. 按阈值决定动作 (normal/compress/summarize)
     *   5. 如果 compress: 触发 compaction cycle + 可选 L4 标记
     *   6. 如果 summarize: 触发 forceTerminal
     */
    checkBeforeLLMCall(iteration) {
        const noopResult = {
            action: 'normal',
            estimatedNextCallTokens: 0,
            sessionUsageRatio: 0,
            compaction: { level: 0, removed: 0 },
        };
        if (!this.hasSessionBudget) {
            return noopResult;
        }
        const usedInputTokens = this.#cumulativeUsage.input;
        const estimated = this.#estimateNextCallTokens(iteration);
        const projected = usedInputTokens + estimated;
        const ratio = projected / this.#maxSessionInputTokens;
        if (this.#contextWindow) {
            this.#contextWindow.setSessionPressure(usedInputTokens / this.#maxSessionInputTokens);
        }
        if (ratio <= COMPRESS_THRESHOLD) {
            return {
                action: 'normal',
                estimatedNextCallTokens: estimated,
                sessionUsageRatio: ratio,
                compaction: { level: 0, removed: 0 },
            };
        }
        // 75%+: 触发压缩 — session budget 只做压缩触发，不做终止决策
        // 终止由 maxIterations / timeout / ExitController 负责
        const isAggressive = ratio > AGGRESSIVE_COMPRESS_THRESHOLD;
        const label = isAggressive ? '激进压缩' : '压缩';
        this.#logger.info(`[BudgetController] ⚠ session 预检: ${usedInputTokens} used + ~${estimated} est = ${projected}/${this.#maxSessionInputTokens} (${(ratio * 100).toFixed(1)}%) → ${label}`);
        const compaction = this.#runExtraCompaction();
        // >90%: 标记 L4 pending 以触发 LLM-based 摘要压缩，释放更多空间
        if (isAggressive && this.#contextWindow && !this.#pendingL4) {
            this.#pendingL4 = true;
        }
        return {
            action: 'compress',
            estimatedNextCallTokens: estimated,
            sessionUsageRatio: ratio,
            compaction,
        };
    }
    /* ═══════════════════════════════════════════════════════
     *  压缩触发
     * ═══════════════════════════════════════════════════════ */
    /**
     * 常规压缩周期 — 委托 ContextWindow.compactIfNeeded()。
     * 由 AgentRuntime 在 #prepareIteration 中调用。
     */
    runCompactionCycle() {
        if (!this.#contextWindow) {
            return { level: 0, removed: 0 };
        }
        const result = this.#contextWindow.compactIfNeeded();
        this.#trackCompaction(result);
        return result;
    }
    /** 标记需要 L4 compaction (异步 LLM 摘要) */
    requestL4Compaction() {
        this.#pendingL4 = true;
    }
    get pendingL4() {
        return this.#pendingL4;
    }
    /**
     * 执行挂起的 L4 compaction (在 LLM 调用前)。
     * L4 token 消耗直接回写 cumulativeUsage。
     */
    async executeL4IfPending(aiProvider, addLoopTokenUsage) {
        if (!this.#pendingL4 || !this.#contextWindow) {
            return { level: 0, removed: 0 };
        }
        this.#pendingL4 = false;
        try {
            const l4Result = await this.#contextWindow.compactL4(aiProvider);
            if (l4Result.removed > 0) {
                this.#logger.info(`[BudgetController] L4 compaction executed: removed ${l4Result.removed} messages`);
            }
            if (l4Result.usage) {
                const usage = l4Result.usage;
                const inputTokens = usage.inputTokens || 0;
                const outputTokens = usage.outputTokens || 0;
                this.#cumulativeUsage.input += inputTokens;
                this.#cumulativeUsage.output += outputTokens;
                addLoopTokenUsage?.({ inputTokens, outputTokens });
            }
            const result = { level: 4, removed: l4Result.removed };
            this.#trackCompaction(result);
            return result;
        }
        catch (err) {
            this.#logger.warn(`[BudgetController] L4 compaction failed: ${err}`);
            return { level: 0, removed: 0 };
        }
    }
    /* ═══════════════════════════════════════════════════════
     *  Token 追踪
     * ═══════════════════════════════════════════════════════ */
    /**
     * 记录本轮 LLM 返回的 token 使用情况。
     * 同时更新 cumulativeUsage（共享引用）和内部 lastRoundInputTokens。
     */
    recordLLMUsage(usage) {
        const inp = usage.inputTokens || 0;
        const out = usage.outputTokens || 0;
        const reasoning = usage.reasoningTokens || 0;
        const cache = usage.cacheHitTokens || 0;
        this.#cumulativeUsage.input += inp;
        this.#cumulativeUsage.output += out;
        this.#cumulativeUsage.reasoning += reasoning;
        this.#cumulativeUsage.cacheHit += cache;
        this.#lastRoundInputTokens = inp;
        this.#iterationCount++;
        const ratio = this.sessionUsageRatio;
        if (ratio > this.#peakSessionUsageRatio) {
            this.#peakSessionUsageRatio = ratio;
        }
    }
    get cumulativeUsage() {
        return this.#cumulativeUsage;
    }
    /* ═══════════════════════════════════════════════════════
     *  工具预算
     * ═══════════════════════════════════════════════════════ */
    /**
     * 获取本轮工具调用的 token 预算。
     *
     * 并行工具共享 roundMaxChars 预算:
     *   roundMaxChars = baseQuota.maxChars × ceil(parallelCount / 2)
     *   perToolMaxChars = roundMaxChars / parallelCount
     */
    getToolBudget(parallelCount) {
        if (!this.#contextWindow) {
            return {
                roundMaxChars: 6000,
                perToolMaxChars: 6000,
                perToolMaxMatches: 15,
            };
        }
        const baseQuota = this.#contextWindow.getToolResultQuota();
        const scaleFactor = Math.ceil(parallelCount / 2);
        const roundMaxChars = baseQuota.maxChars * scaleFactor;
        const perToolMaxChars = Math.max(MIN_TOOL_CHARS, Math.floor(roundMaxChars / parallelCount));
        const perToolMaxMatches = Math.max(2, Math.floor((baseQuota.maxMatches * scaleFactor) / parallelCount));
        this.#roundMaxChars = roundMaxChars;
        this.#roundCharsUsed = 0;
        this.#roundPerToolMaxMatches = perToolMaxMatches;
        return { roundMaxChars, perToolMaxChars, perToolMaxMatches };
    }
    recordToolCharsUsed(chars) {
        this.#roundCharsUsed += chars;
    }
    getRemainingToolBudget() {
        return {
            maxChars: Math.max(MIN_TOOL_CHARS, this.#roundMaxChars - this.#roundCharsUsed),
            maxMatches: this.#roundPerToolMaxMatches,
        };
    }
    /* ═══════════════════════════════════════════════════════
     *  遥测
     * ═══════════════════════════════════════════════════════ */
    /**
     * 输出 TurnTelemetry — 结构化日志。
     * 仅 system 场景输出（由调用方控制）。
     */
    emitTurnTelemetry(params) {
        const { iteration, currentUsage, compaction } = params;
        const u = currentUsage;
        const inTok = u.inputTokens || 0;
        const cacheRate = inTok > 0 ? ((u.cacheHitTokens || 0) / inTok) * 100 : 0;
        const sessionBudget = this.#maxSessionInputTokens;
        const sessionPart = sessionBudget > 0
            ? `session=${this.#cumulativeUsage.input}/${sessionBudget} (${((this.#cumulativeUsage.input / sessionBudget) * 100).toFixed(1)}%)`
            : `session=${this.#cumulativeUsage.input} (unlimited)`;
        this.#logger.info(`[TurnTelemetry] iter=${iteration} | ` +
            `in=${inTok} out=${u.outputTokens || 0} reasoning=${u.reasoningTokens || 0} ` +
            `cache=${u.cacheHitTokens || 0} (${cacheRate.toFixed(0)}% hit) | ` +
            `compact=L${compaction.level} | ` +
            sessionPart);
        if ((u.cacheHitTokens || 0) === 0 && inTok > 1024) {
            this.#consecutiveZeroCacheHits++;
            if (this.#consecutiveZeroCacheHits >= 3) {
                this.#logger.warn(`[TurnTelemetry] ⚠ ${this.#consecutiveZeroCacheHits} consecutive turns with 0 cache hits — check if system prompt is being modified`);
            }
        }
        else {
            this.#consecutiveZeroCacheHits = 0;
        }
    }
    getSessionSummary() {
        const totalInput = this.#cumulativeUsage.input;
        const totalCache = this.#cumulativeUsage.cacheHit;
        return {
            totalIterations: this.#iterationCount,
            totalInputTokens: totalInput,
            totalOutputTokens: this.#cumulativeUsage.output,
            totalReasoningTokens: this.#cumulativeUsage.reasoning,
            avgCacheHitRate: totalInput > 0 ? totalCache / totalInput : 0,
            peakSessionUsageRatio: this.#peakSessionUsageRatio,
            maxCompactionLevel: this.#maxCompactionLevel,
            totalCompactedItems: this.#totalCompactedItems,
            forcedSummarize: this.#forcedSummarize,
        };
    }
    /* ═══════════════════════════════════════════════════════
     *  内部方法
     * ═══════════════════════════════════════════════════════ */
    #estimateNextCallTokens(iteration) {
        if (this.#lastRoundInputTokens > 0) {
            return this.#lastRoundInputTokens;
        }
        if (this.#contextWindow) {
            return this.#contextWindow.estimateFullContextTokens(this.#baseSystemPromptLength, this.#toolSchemaCount);
        }
        if (iteration > 1 && this.#cumulativeUsage.input > 0) {
            return Math.ceil(this.#cumulativeUsage.input / (iteration - 1));
        }
        return DEFAULT_ESTIMATE;
    }
    /** Session budget 压力下的额外压缩 */
    #runExtraCompaction() {
        if (!this.#contextWindow) {
            return { level: 0, removed: 0 };
        }
        const cw = this.#contextWindow;
        const extraCompact = cw.compactIfNeeded();
        if (extraCompact.level > 0) {
            this.#logger.info(`[BudgetController] session budget pressure → extra compact L${extraCompact.level}, removed ${extraCompact.removed}`);
        }
        if (cw.needsL4Compaction()) {
            this.#pendingL4 = true;
        }
        this.#trackCompaction(extraCompact);
        return extraCompact;
    }
    #trackCompaction(result) {
        if (result.level > this.#maxCompactionLevel) {
            this.#maxCompactionLevel = result.level;
        }
        this.#totalCompactedItems += result.removed;
    }
}

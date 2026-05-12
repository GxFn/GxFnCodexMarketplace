/**
 * LoopContext — reactLoop 单次执行的完整状态
 *
 * 封装原 reactLoop 内散落的 10+ 局部变量:
 *   - 注入依赖 (messages, tracker, trace, memoryCoordinator, sharedState)
 *   - 循环状态 (iteration, lastReply, toolCalls, tokenUsage)
 *   - 错误恢复 (consecutiveAiErrors, consecutiveEmptyResponses)
 *   - 配置 (source, budget, capabilities, baseSystemPrompt, toolSchemas, prompt)
 *
 * 使 reactLoop 的提取方法只需接收一个 ctx 参数。
 *
 * @module core/LoopContext
 */
export class LoopContext {
    // ─── 注入依赖 ───
    /** 统一消息适配器 */
    messages;
    /** ExplorationTracker 实例 */
    tracker;
    /** ActiveContext 实例 */
    trace;
    /** MemoryCoordinator 实例 */
    memoryCoordinator;
    /** 共享状态 */
    sharedState;
    // ─── 循环状态 ───
    /** 当前迭代次数 */
    iteration = 0;
    /** 最终回复文本 */
    lastReply = '';
    /** 本轮工具调用记录 */
    // biome-ignore lint/suspicious/noExplicitAny: tool call entries have varying shapes across callers; no common structural type satisfies all consumers.
    toolCalls = [];
    /** 本轮 token 用量 */
    tokenUsage = { input: 0, output: 0, reasoning: 0, cacheHit: 0 };
    /** 循环开始时间戳 */
    loopStartTime = 0;
    // ─── 错误恢复 ───
    /** 连续 AI 错误计数 (2-strike 策略) */
    consecutiveAiErrors = 0;
    /** 连续空响应计数 */
    consecutiveEmptyResponses = 0;
    // ─── 配置 (只读) ───
    /** 来源 'user' | 'system' */
    source;
    /** 预算配置 */
    budget;
    capabilities;
    /** 基础系统提示词 */
    baseSystemPrompt;
    /** 工具 schemas */
    toolSchemas;
    /** 当前 loop 明确允许调用的工具 ID */
    allowedToolIds;
    /** 原始用户提示 */
    prompt;
    /** 工具调用钩子 */
    onToolCall;
    /** 额外上下文 */
    context;
    /** 原始 ContextWindow 引用 */
    contextWindow;
    /** 首轮 toolChoice 覆盖 ('required'/'auto'/'none') */
    toolChoiceOverride;
    /** 外部中止信号 — hard timeout 时取消进行中的 LLM 调用 */
    abortSignal;
    /** 统一诊断收集器 */
    diagnostics;
    /** ExitController — 统一退出决策 */
    exitController;
    /** BudgetController — 预算决策 + 压缩触发 + 遥测 */
    budgetController = null;
    constructor(config) {
        this.messages = config.messages;
        this.tracker = (config.tracker || null);
        this.trace = (config.trace || null);
        this.memoryCoordinator = (config.memoryCoordinator || null);
        this.sharedState = (config.sharedState || null);
        this.source = config.source || 'user';
        this.budget = config.budget;
        this.capabilities = config.capabilities;
        this.baseSystemPrompt = config.baseSystemPrompt;
        this.allowedToolIds = config.allowedToolIds;
        this.toolSchemas = config.toolSchemas;
        this.prompt = config.prompt;
        this.onToolCall = (config.onToolCall || null);
        this.context = config.context || {};
        this.contextWindow = config.contextWindow || null;
        this.toolChoiceOverride = config.toolChoiceOverride || null;
        this.abortSignal = (config.abortSignal || null);
        this.diagnostics = config.diagnostics || null;
        this.exitController = config.exitController || null;
        this.loopStartTime = Date.now();
    }
    // ─── 计算属性 ───
    /** 是否为 system 场景 */
    get isSystem() {
        return this.source === 'system';
    }
    /** 最大迭代数 */
    get maxIterations() {
        return this.budget.maxIterations || 20;
    }
    // ─── Token 累计辅助 ───
    /**
     * 累加 token 用量到循环级统计
     * @param usage { inputTokens, outputTokens }
     */
    addTokenUsage(usage) {
        if (!usage) {
            return;
        }
        this.tokenUsage.input += usage.inputTokens || 0;
        this.tokenUsage.output += usage.outputTokens || 0;
        this.tokenUsage.reasoning += usage.reasoningTokens || 0;
        this.tokenUsage.cacheHit += usage.cacheHitTokens || 0;
    }
    // ─── 结果构建 ───
    /**
     * 构建循环返回值
     * @returns }
     */
    buildResult() {
        return {
            reply: this.lastReply,
            toolCalls: [...this.toolCalls],
            tokenUsage: { ...this.tokenUsage },
            iterations: this.iteration,
            ...(this.diagnostics ? { diagnostics: this.diagnostics.toJSON() } : {}),
        };
    }
}

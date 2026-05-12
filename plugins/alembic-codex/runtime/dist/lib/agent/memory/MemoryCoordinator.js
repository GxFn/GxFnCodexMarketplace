/**
 * MemoryCoordinator — 记忆系统统一协调器
 *
 * 设计原则 (CoALA / MemGPT / Generative Agents / Mem0):
 *   - Single Coordinator: 所有记忆操作通过此模块路由
 *   - Budget-Aware Injection: 记忆注入受统一 token 预算管控
 *   - Extract-Update Write Path: 写入经去重/合并/冲突解决
 *   - Graceful Degradation: 任意子系统故障不影响核心执行
 *
 * 生命周期:
 *   - Bootstrap 模式: 会话级 (orchestrator 创建, 贯穿所有维度)
 *   - User Chat 模式: 实例级 (AgentRuntime 创建)
 *
 * @module MemoryCoordinator
 */
import Logger from '#infra/logging/Logger.js';
import { ActiveContext } from './ActiveContext.js';
// ── 预算分配策略 (§4.1) ──
const BUDGET_PROFILES = Object.freeze({
    user: {
        activeContext: 0.2,
        sessionStore: 0.0,
        persistentMemory: 0.6,
        conversationLog: 0.2,
    },
    analyst: {
        activeContext: 0.45,
        sessionStore: 0.35,
        persistentMemory: 0.15,
        conversationLog: 0.05,
    },
    producer: {
        activeContext: 0.25,
        sessionStore: 0.55,
        persistentMemory: 0.15,
        conversationLog: 0.05,
    },
});
/** 默认记忆 token 总预算 */
const DEFAULT_MEMORY_BUDGET = 4000;
/** 副作用工具 — 不缓存结果 (B3 fix) */
const NON_CACHEABLE_TOOLS = new Set([
    'knowledge',
    'memory',
    'note_finding',
    'get_previous_analysis',
    'get_previous_evidence',
]);
// ── 写入路由: 规则匹配模式 ──
const PREFERENCE_PATTERNS = [
    /我们(项目|团队)?(不用|不使用|禁止|避免|偏好|习惯|规范是)/,
    /以后(都|请|要)/,
    /记住/,
    /we\s+(don'?t|never|always|prefer|avoid)\s+use/i,
    /remember\s+(to|that)/i,
    /our\s+(convention|standard|rule)\s+is/i,
];
const DECISION_PATTERNS = [
    /决定(了|用|采用|使用)/,
    /(确认|同意|通过)(了|这个方案|审核)/,
    /就(这样|这么)(做|定|办)/,
    /let'?s\s+(go\s+with|use|adopt)/i,
    /approved|confirmed|decided/i,
];
const MEMORY_TAG_REGEX = /\[MEMORY:(\w+)\]\s*([\s\S]*?)\s*\[\/MEMORY\]/g;
export class MemoryCoordinator {
    _lastSurplus = 0;
    // ── Config ──
    #mode;
    #totalBudget;
    #budgetAllocation;
    // ── Tier 3: Persistent (跨会话) ──
    #persistentMemory;
    #conversationLog;
    // ── Tier 2: Session (会话级) ──
    #sessionStore;
    // ── Tier 1: Dimension (维度级) ──
    #activeContexts;
    #currentScopeId;
    #logger;
    #completedScopes;
    /**
     * @param [config.persistentMemory] PersistentMemory 实例
     * @param [config.sessionStore] SessionStore 实例 (bootstrap 模式)
     * @param [config.conversationLog] ConversationStore 实例
     * @param [config.totalMemoryBudget=4000] 记忆 section 的 token 总预算
     */
    constructor(config = {}) {
        this.#persistentMemory = config.persistentMemory || null;
        this.#sessionStore = config.sessionStore || null;
        this.#conversationLog = config.conversationLog || null;
        this.#mode = config.mode || 'bootstrap';
        this.#totalBudget = config.totalMemoryBudget || DEFAULT_MEMORY_BUDGET;
        this.#activeContexts = new Map();
        this.#currentScopeId = null;
        this.#completedScopes = new Set();
        this.#budgetAllocation = {
            activeContext: 0,
            sessionStore: 0,
            persistentMemory: 0,
            conversationLog: 0,
        };
        this.#logger = Logger.getInstance();
        // 应用默认预算
        this.allocateBudget(this.#mode === 'user' ? 'user' : 'analyst');
    }
    // ═══════════════════════════════════════════════════════════
    // 预算管理
    // ═══════════════════════════════════════════════════════════
    /**
     * 配置总预算 (由 AgentRuntime.execute 入口调用)
     * @param options.totalContextBudget 模型总上下文 token 数
     */
    configure({ totalContextBudget, model } = {}) {
        if (totalContextBudget) {
            // 记忆 section 约占总上下文的 12.5%
            this.#totalBudget = Math.round(totalContextBudget * 0.125);
        }
    }
    /**
     * 按模式分配预算
     * @param [totalTokens] 覆盖总预算
     */
    allocateBudget(mode, totalTokens) {
        if (totalTokens) {
            this.#totalBudget = totalTokens;
        }
        const profile = BUDGET_PROFILES[mode] || BUDGET_PROFILES.analyst;
        this.#budgetAllocation = {
            activeContext: Math.round(this.#totalBudget * profile.activeContext),
            sessionStore: Math.round(this.#totalBudget * profile.sessionStore),
            persistentMemory: Math.round(this.#totalBudget * profile.persistentMemory),
            conversationLog: Math.round(this.#totalBudget * profile.conversationLog),
        };
    }
    getTotalBudget() {
        return this.#totalBudget;
    }
    getBudgetAllocation() {
        return { ...this.#budgetAllocation };
    }
    /**
     * 获取消息缓冲区可用预算 (F2)
     * @param totalContextBudget 模型总上下文 token
     */
    getMessageBudget(totalContextBudget, systemPromptEstimate = 2000, toolSchemaEstimate = 3000, safetyMargin = 3000) {
        return (totalContextBudget -
            this.#totalBudget -
            systemPromptEstimate -
            toolSchemaEstimate -
            safetyMargin);
    }
    // ═══════════════════════════════════════════════════════════
    // 读取 (Prompt 构建)
    // ═══════════════════════════════════════════════════════════
    /**
     * 构建静态记忆 prompt (execute 入口调用一次)
     * 包含: PersistentMemory + ConversationLog + SessionStore 上下文
     *
     * @param [options.mode] 'user' | 'analyst' | 'producer'
     * @param [options.taskContext] 当前任务描述 (用于 relevance 打分)
     * @param [options.currentDimId] 当前维度 (用于 SessionStore 过滤)
     * @param [options.focusKeywords] 聚焦关键词
     */
    async buildStaticMemoryPrompt(options = {}) {
        const parts = [];
        let surplus = 0;
        try {
            // ── 1. PersistentMemory / Memory ──
            const pmBudget = this.#budgetAllocation.persistentMemory || 0;
            if (pmBudget > 0) {
                const pmSection = await this.#buildPersistentMemorySection(options);
                if (pmSection) {
                    const used = this.#estimateTokens(pmSection);
                    surplus += Math.max(0, pmBudget - used);
                    parts.push(pmSection);
                }
                else {
                    surplus += pmBudget;
                }
            }
            // ── 2. SessionStore (legacy: EpisodicMemory) ──
            const ssBudget = this.#budgetAllocation.sessionStore || 0;
            if (ssBudget > 0) {
                const ssSection = this.#buildSessionStoreSection(options);
                if (ssSection) {
                    const used = this.#estimateTokens(ssSection);
                    surplus += Math.max(0, ssBudget - used);
                    parts.push(ssSection);
                }
                else {
                    surplus += ssBudget;
                }
            }
            // ── 3. ConversationLog ──
            const clBudget = this.#budgetAllocation.conversationLog || 0;
            if (clBudget > 0 && this.#conversationLog) {
                // ConversationLog 通常通过 history 传入，此处预留
                surplus += clBudget;
            }
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] buildStaticMemoryPrompt error: ${err.message}`);
        }
        // 静态 prompt 不做二次重分配 (动态 prompt 使用 surplus)
        this._lastSurplus = surplus;
        return parts.filter(Boolean).join('\n');
    }
    /**
     * 构建动态记忆 prompt (每轮调用)
     * 包含: ActiveContext / WorkingMemory 上下文
     */
    buildDynamicMemoryPrompt(options = {}) {
        try {
            const acBudget = (this.#budgetAllocation.activeContext || 0) + (this._lastSurplus || 0);
            if (acBudget <= 0) {
                return '';
            }
            const ac = options.scopeId
                ? this.getActiveContext(options.scopeId)
                : this.#getCurrentActiveContext();
            if (!ac) {
                return '';
            }
            return ac.buildContext(acBudget) || '';
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] buildDynamicMemoryPrompt error: ${err.message}`);
            return '';
        }
    }
    /** 合并构建完整记忆 prompt (便捷方法) */
    async buildMemoryPrompt(options = {}) {
        const staticPart = await this.buildStaticMemoryPrompt(options);
        const dynamicPart = this.buildDynamicMemoryPrompt(options);
        return [staticPart, dynamicPart].filter(Boolean).join('\n');
    }
    // ═══════════════════════════════════════════════════════════
    // 写入
    // ═══════════════════════════════════════════════════════════
    /**
     * 记录工具调用观察 (合并 WM.observe + TRC.set)
     * @param round 当前迭代轮次
     * @param [cacheHit=false] 本次是否缓存命中
     */
    recordObservation(toolName, args, result, round, cacheHit = false) {
        try {
            // ActiveContext 的数据记录由 trace.recordToolCall() 处理，
            // 此处只处理缓存写入。
            // 委托给 SessionStore 缓存
            if (!cacheHit && this.#sessionStore) {
                if (!NON_CACHEABLE_TOOLS.has(toolName)) {
                    this.#sessionStore.cacheToolResult(toolName, args, result);
                }
            }
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] recordObservation error: ${err.message}`);
        }
    }
    /**
     * 记录关键发现 (从 note_finding handler 调用)
     * @param importance 1-10
     * @param [scopeId] 显式指定 scope (并行安全)
     * @returns 响应消息
     */
    noteFinding(finding, evidence, importance, round, scopeId) {
        try {
            const ac = scopeId ? this.getActiveContext(scopeId) : this.#getCurrentActiveContext();
            if (ac) {
                ac.noteKeyFinding(finding, evidence, importance, round);
                return `📌 已记录发现 [${importance}/10]: "${finding.substring(0, 80)}" — 当前共 ${ac.scratchpadSize} 条关键发现`;
            }
            return '⚠ 工作记忆未初始化 (仅在 bootstrap 分析期间可用)';
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] noteFinding error: ${err.message}`);
            return `⚠ 记录发现失败: ${err.message}`;
        }
    }
    /**
     * 从对话中提取记忆
     *
     * 写入路由 (WriteRouter):
     *   - 规则 1: 只在 user 源触发规则匹配 (B4 fix)
     *   - 规则 2: [MEMORY] 标签提取 (所有源)
     *
     * @param prompt 用户输入
     * @param reply AI 回复
     */
    extractFromConversation(prompt, reply, source) {
        // §7.6 step 4: 只写 PersistentMemory (不再双写 Memory.js)
        if (!this.#persistentMemory) {
            return;
        }
        try {
            // ── 层 1: 规则快速匹配 (仅 user 源) ──
            if (source === 'user') {
                if (PREFERENCE_PATTERNS.some((p) => p.test(prompt))) {
                    this.#persistentMemory.append({
                        type: 'preference',
                        content: prompt.substring(0, 200),
                        source,
                        importance: 5,
                    });
                }
                if (DECISION_PATTERNS.some((p) => p.test(prompt))) {
                    this.#persistentMemory.append({
                        type: 'fact',
                        content: prompt.substring(0, 200),
                        source,
                        importance: 7,
                    });
                }
            }
            // ── 层 2: [MEMORY] 标签提取 (所有源) ──
            if (reply) {
                const regex = new RegExp(MEMORY_TAG_REGEX.source, MEMORY_TAG_REGEX.flags);
                let match;
                while ((match = regex.exec(reply)) !== null) {
                    const type = match[1];
                    const content = match[2].trim();
                    if (content && ['preference', 'decision', 'context'].includes(type)) {
                        this.#persistentMemory.append({
                            type: type === 'decision' ? 'fact' : type === 'context' ? 'fact' : type,
                            content: content.substring(0, 200),
                            source,
                            importance: type === 'decision' ? 7 : 5,
                        });
                    }
                }
            }
        }
        catch {
            /* memory write failure is non-critical */
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 缓存代理 (委托到 SessionStore / legacy ToolResultCache)
    // ═══════════════════════════════════════════════════════════
    /** 获取缓存的工具结果 */
    getCachedResult(toolName, args) {
        try {
            if (NON_CACHEABLE_TOOLS.has(toolName)) {
                return null;
            }
            return this.#sessionStore?.getCachedResult(toolName, args) ?? null;
        }
        catch {
            return null;
        }
    }
    /** 缓存工具结果 */
    cacheToolResult(toolName, args, result) {
        try {
            if (NON_CACHEABLE_TOOLS.has(toolName)) {
                return;
            }
            this.#sessionStore?.cacheToolResult(toolName, args, result);
        }
        catch {
            /* non-critical */
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 维度生命周期
    // ═══════════════════════════════════════════════════════════
    /**
     * 创建维度作用域 (D2/D3: 多 scope 支持)
     *
     * @param scopeId 如 'api-patterns:analyst', 'api-patterns:producer'
     * @param [config.lightweight=false] 轻量模式 (User Chat)
     * @returns WorkingMemory (Phase 2) / ActiveContext (Phase 3)
     */
    createDimensionScope(scopeId, config = {}) {
        this.#currentScopeId = scopeId;
        // Phase 3: 创建 ActiveContext 实例
        const ac = new ActiveContext({
            lightweight: config.lightweight || false,
            maxRecentRounds: config.maxRecentRounds || 3,
        });
        this.#activeContexts.set(scopeId, ac);
        this.#logger.debug(`[MemoryCoordinator] scope created: ${scopeId} (ActiveContext)`);
        return ac;
    }
    /**
     * 完成维度: 蒸馏 + 存储到 SessionStore
     * @param [report] 附加报告数据
     */
    completeDimension(scopeId, report) {
        try {
            const ac = this.#activeContexts.get(scopeId);
            const distilled = ac ? ac.distill() : null;
            if (distilled && this.#sessionStore && report) {
                this.#sessionStore.storeDimensionReport(scopeId.replace(/:.*$/, ''), {
                    ...report,
                    workingMemoryDistilled: distilled,
                });
            }
            // 清理 ActiveContext
            if (ac) {
                ac.clear();
                this.#activeContexts.delete(scopeId);
            }
            this.#completedScopes.add(scopeId);
            // 切换当前 scope 到下一个或清空
            if (this.#currentScopeId === scopeId) {
                this.#currentScopeId = null;
            }
            this.#logger.debug(`[MemoryCoordinator] scope completed: ${scopeId}`);
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] completeDimension error: ${err.message}`);
        }
    }
    /**
     * 完成会话: 触发 Consolidator
     * @returns |null>}
     */
    async completeSession() {
        try {
            this.#currentScopeId = null;
            this.#logger.info('[MemoryCoordinator] session completed');
            return { consolidated: 0 };
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] completeSession error: ${err.message}`);
            return null;
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 状态查询
    // ═══════════════════════════════════════════════════════════
    /** 获取当前或指定 scope 的 ActiveContext / WorkingMemory */
    getActiveContext(scopeId) {
        const id = scopeId || this.#currentScopeId;
        if (!id) {
            return null;
        }
        return this.#activeContexts.get(id) || null;
    }
    /** 获取 SessionStore */
    getSessionStore() {
        return this.#sessionStore || null;
    }
    /** 检索前序维度的代码证据 — V2 memory.get_previous_evidence 桥接 */
    searchEvidence(query, dimId) {
        if (!this.#sessionStore) {
            return [];
        }
        try {
            return this.#sessionStore.searchEvidence(query, dimId);
        }
        catch {
            return [];
        }
    }
    /** 获取 PersistentMemory */
    getPersistentMemory() {
        return this.#persistentMemory || null;
    }
    /** 获取 ConversationLog / ConversationStore */
    getConversationLog() {
        return this.#conversationLog || null;
    }
    // ═══════════════════════════════════════════════════════════
    // 自动摘要 (F23)
    // ═══════════════════════════════════════════════════════════
    /** 对话更新后触发自动摘要 */
    async onConversationUpdated(conversationId, aiProvider) {
        if (!this.#conversationLog || !aiProvider) {
            return;
        }
        try {
            const messages = this.#conversationLog.load(conversationId, { tokenBudget: Infinity });
            if (messages.length >= 12) {
                await this.#conversationLog.summarize(conversationId, { aiProvider });
            }
        }
        catch {
            // 摘要失败不影响主流程
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 断点续传
    // ═══════════════════════════════════════════════════════════
    /** 保存 checkpoint */
    async checkpoint(projectRoot) {
        try {
            if (this.#sessionStore?.saveCheckpoint) {
                await this.#sessionStore.saveCheckpoint(projectRoot);
            }
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] checkpoint error: ${err.message}`);
        }
    }
    /** 恢复 checkpoint */
    async restore(projectRoot) {
        try {
            if (this.#sessionStore?.loadCheckpoint) {
                return await this.#sessionStore.loadCheckpoint(projectRoot);
            }
            return false;
        }
        catch (err) {
            this.#logger.warn(`[MemoryCoordinator] restore error: ${err.message}`);
            return false;
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 清理
    // ═══════════════════════════════════════════════════════════
    dispose() {
        for (const ac of this.#activeContexts.values()) {
            try {
                ac.clear();
            }
            catch {
                /* non-critical */
            }
        }
        this.#activeContexts.clear();
        this.#sessionStore = null;
        this.#currentScopeId = null;
        this.#completedScopes.clear();
    }
    // ═══════════════════════════════════════════════════════════
    // 私有方法
    // ═══════════════════════════════════════════════════════════
    /** 获取当前 scope 的 ActiveContext */
    #getCurrentActiveContext() {
        if (!this.#currentScopeId) {
            return null;
        }
        return this.#activeContexts.get(this.#currentScopeId) || null;
    }
    /** 构建 PersistentMemory section */
    async #buildPersistentMemorySection(options = {}) {
        if (this.#persistentMemory?.toPromptSection) {
            return (await this.#persistentMemory.toPromptSection({ source: 'user' })) || '';
        }
        return '';
    }
    /** 构建 SessionStore section (legacy: EpisodicMemory) */
    #buildSessionStoreSection(options = {}) {
        const ss = this.#sessionStore;
        if (!ss?.buildContextForDimension) {
            return '';
        }
        const dimId = options.currentDimId;
        if (!dimId) {
            return '';
        }
        try {
            return ss.buildContextForDimension(dimId, options.focusKeywords || []) || '';
        }
        catch {
            return '';
        }
    }
    /** 粗略估算 token 数 (CJK 感知) */
    #estimateTokens(text) {
        if (!text) {
            return 0;
        }
        // 粗略: 英文 ~4 chars/token, 中文 ~2 chars/token
        const cjkCount = (text.match(/[\u4e00-\u9fff\u3000-\u303f]/g) || []).length;
        const restCount = text.length - cjkCount;
        return Math.ceil(cjkCount / 2 + restCount / 4);
    }
}
export default MemoryCoordinator;

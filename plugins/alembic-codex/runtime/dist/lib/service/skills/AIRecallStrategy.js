/**
 * AIRecallStrategy — 将 SignalCollector 的 AI 分析结果包装为 RecallStrategy 接口
 *
 * 读取 SignalCollector 的缓存快照中的 pendingSuggestions，
 * 转换为标准 RecommendationCandidate。
 *
 * 依赖 AI Provider，不可用时返回空数组。
 */
export class AIRecallStrategy {
    name = 'ai';
    type = 'ai';
    #signalCollector;
    constructor(signalCollector) {
        this.#signalCollector = signalCollector;
    }
    async recall(context) {
        if (!this.#signalCollector) {
            return [];
        }
        const snapshot = this.#signalCollector.getSnapshot();
        const pending = snapshot.pendingSuggestions ?? [];
        const existingSet = context.existingSkills ?? new Set();
        return pending
            .filter((s) => !existingSet.has(s.name))
            .map((s) => ({
            name: s.name || 'unknown',
            description: s.description || '',
            rationale: s.rationale || '',
            source: 'ai:signal_collector',
            priority: s.priority || 'medium',
            signals: s,
            body: s.body,
        }));
    }
    isAvailable(context) {
        if (!this.#signalCollector) {
            return false;
        }
        const mode = this.#signalCollector.getMode();
        // AI 策略只在 suggest/auto 模式下可用
        return mode === 'suggest' || mode === 'auto';
    }
    /** 更新 SignalCollector 引用 (用于延迟注入) */
    setSignalCollector(sc) {
        this.#signalCollector = sc;
    }
}
export default AIRecallStrategy;

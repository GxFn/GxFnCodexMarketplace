/**
 * ExplorationStrategies — 探索策略定义
 *
 * 从 ExplorationTracker.js 提取的内置策略配置。
 * 每种策略定义了阶段序列、转换规则、toolChoice 逻辑和反思/规划开关。
 *
 * @module ExplorationStrategies
 */
// ─── 常量 ──────────────────────────────────────────────
/** 反思间隔（每 N 轮触发一次） */
export const DEFAULT_REFLECTION_INTERVAL = 5;
/** 默认重规划间隔 */
export const DEFAULT_REPLAN_INTERVAL = 8;
// ─── 内置策略 ────────────────────────────────────────────
/**
 * Bootstrap 策略（有 submit 阶段）
 * @param isSkillOnly skill-only 维度跳过 PRODUCE 阶段
 * @returns 策略配置
 */
export function createBootstrapStrategy(isSkillOnly = false) {
    return {
        name: 'bootstrap',
        phases: isSkillOnly ? ['EXPLORE', 'SUMMARIZE'] : ['EXPLORE', 'PRODUCE', 'SUMMARIZE'],
        transitions: {
            ...(isSkillOnly
                ? {
                    'EXPLORE→SUMMARIZE': {
                        onMetrics: (m, b) => m.submitCount > 0 || m.searchRoundsInPhase >= b.searchBudget,
                        onTextResponse: true,
                    },
                }
                : {
                    'EXPLORE→PRODUCE': {
                        onMetrics: (m, b) => m.submitCount > 0 || m.searchRoundsInPhase >= b.searchBudget,
                        onTextResponse: true,
                    },
                    'PRODUCE→SUMMARIZE': {
                        onMetrics: (m, b) => m.submitCount >= b.maxSubmits ||
                            (m.submitCount > 0 && m.roundsSinceSubmit >= b.idleRoundsToExit) ||
                            (m.consecutiveIdleRounds >= b.searchBudgetGrace && m.submitCount === 0),
                        onTextResponse: (m, b) => m.submitCount >= b.softSubmitLimit,
                    },
                }),
        },
        getToolChoice: (phase, m, b) => {
            if (phase === 'SUMMARIZE') {
                return 'none';
            }
            if (phase === 'EXPLORE') {
                return m.searchRoundsInPhase >= b.searchBudget - 1 ? 'auto' : 'required';
            }
            return 'auto'; // PRODUCE
        },
        enableReflection: true,
        reflectionInterval: DEFAULT_REFLECTION_INTERVAL,
        enablePlanning: true,
        replanInterval: DEFAULT_REPLAN_INTERVAL,
    };
}
/**
 * Analyst 策略（纯探索，无 submit 阶段）
 * 5 阶段: SCAN → EXPLORE → VERIFY → RECORD → SUMMARIZE
 *
 * v2 改进: 支持探索饱和后的自然退出，避免耗尽全部轮次才进入总结：
 *   - EXPLORE 阶段在 40% 预算后从 required 降级为 auto，允许 LLM 自然输出文本
 *   - EXPLORE→VERIFY 新增 onTextResponse=true，文本回复即可触发转换
 *   - EXPLORE→VERIFY 新增 consecutiveIdleRounds 检测（LLM 连续无工具调用=分析完成）
 *   - VERIFY→RECORD 阈值从 80% 降至 75%
 *   - RECORD 是 required memory-only 补记录阶段，至少 3 条 note_finding 后进入 SUMMARIZE
 */
export const STRATEGY_ANALYST = {
    name: 'analyst',
    phases: ['SCAN', 'EXPLORE', 'VERIFY', 'RECORD', 'SUMMARIZE'],
    transitions: {
        'SCAN→EXPLORE': {
            onMetrics: (m) => m.iteration >= 2,
            onTextResponse: false,
        },
        'EXPLORE→VERIFY': {
            onMetrics: (m, b) => m.searchRoundsInPhase >= Math.floor(b.maxIterations * 0.6) ||
                m.roundsSinceNewInfo >= 3 ||
                (m.iteration >= Math.floor(b.maxIterations * 0.4) && m.roundsSinceNewInfo >= 2) ||
                m.consecutiveIdleRounds >= 2,
            onTextResponse: (m, b) => m.iteration >= Math.floor(b.maxIterations * 0.4),
        },
        'VERIFY→RECORD': {
            onMetrics: (m, b) => m.iteration >= Math.floor(b.maxIterations * 0.75) ||
                m.roundsSinceNewInfo >= 2 ||
                m.consecutiveIdleRounds >= 1,
            onTextResponse: true,
        },
        'RECORD→SUMMARIZE': {
            onMetrics: (m) => m.memoryFindingCount >= 3,
            onTextResponse: (m) => m.memoryFindingCount >= 3,
        },
    },
    getToolChoice: (phase, m, b) => {
        if (phase === 'SUMMARIZE') {
            return 'none';
        }
        if (phase === 'RECORD') {
            return 'required';
        }
        if (phase === 'SCAN') {
            return 'required';
        }
        if (phase === 'EXPLORE') {
            return m.iteration >= Math.floor(b.maxIterations * 0.4) ? 'auto' : 'required';
        }
        return 'auto'; // VERIFY
    },
    enableReflection: true,
    reflectionInterval: DEFAULT_REFLECTION_INTERVAL,
    enablePlanning: true,
    replanInterval: DEFAULT_REPLAN_INTERVAL,
};
/**
 * Producer 策略（格式化+提交，不搜索）
 * 2 阶段: PRODUCE → SUMMARIZE
 */
export const STRATEGY_PRODUCER = {
    name: 'producer',
    phases: ['PRODUCE', 'SUMMARIZE'],
    transitions: {
        'PRODUCE→SUMMARIZE': {
            onMetrics: (m, b) => m.submitCount >= b.maxSubmits ||
                (m.submitCount > 0 && m.roundsSinceSubmit >= b.idleRoundsToExit) ||
                (m.consecutiveIdleRounds >= b.searchBudgetGrace && m.submitCount === 0),
            onTextResponse: (m, b) => m.submitCount >= b.softSubmitLimit,
        },
    },
    getToolChoice: (phase) => (phase === 'SUMMARIZE' ? 'none' : 'auto'),
    enableReflection: false,
    reflectionInterval: 0,
    enablePlanning: false,
    replanInterval: 0,
};

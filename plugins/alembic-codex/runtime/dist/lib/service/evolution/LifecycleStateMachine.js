/**
 * LifecycleStateMachine — 唯一生命周期权威
 *
 * 所有 Recipe lifecycle 变更必须且只能通过本类的 transition() 方法执行。
 * 替代旧的 RecipeLifecycleSupervisor（可选增强层 → 必需权威）。
 *
 * 核心职责:
 *   1. Guard 前置检查（合法状态转移验证）
 *   2. Exit Action（离开旧状态的副作用）
 *   3. DB 更新（lifecycle 字段）
 *   4. Entry Action（进入新状态的副作用）
 *   5. 记录 TransitionEvent（不可变审计日志）
 *   6. 发射 lifecycle Signal（集中信号源）
 *
 * 设计原则:
 *   - 所有依赖必需（non-nullable），消除 `?? null` 分支
 *   - Guard 拒绝 = 操作失败，调用者不应 fallback 到 updateLifecycle()
 *   - lifecycle signal 仅从此处发射，服务层不直接操作 SignalBus
 *
 * @module service/evolution/LifecycleStateMachine
 */
import { randomUUID } from 'node:crypto';
import { isValidTransition } from '../../domain/knowledge/Lifecycle.js';
import Logger from '../../infrastructure/logging/Logger.js';
/* ────────────────────── Constants ────────────────────── */
/** 中间态超时配置（毫秒） */
const TIMEOUT_MS = {
    evolving: 7 * 24 * 60 * 60 * 1000, // 7 天
    decaying: 30 * 24 * 60 * 60 * 1000, // 30 天
    staging: 7 * 24 * 60 * 60 * 1000, // 7 天
    pending: 30 * 24 * 60 * 60 * 1000, // 30 天
};
/** 超时后的目标状态 */
const TIMEOUT_TARGET = {
    evolving: 'active',
    decaying: 'deprecated',
    pending: 'deprecated',
};
/** 卡死告警阈值（毫秒） */
const STUCK_THRESHOLD_MS = {
    evolving: 3 * 24 * 60 * 60 * 1000,
    decaying: 15 * 24 * 60 * 60 * 1000,
    staging: 3 * 24 * 60 * 60 * 1000,
    pending: 7 * 24 * 60 * 60 * 1000,
};
/** 进入状态时写入 stats 的元数据键 */
const ENTRY_META_KEYS = {
    staging: 'stagingEnteredAt',
    evolving: 'evolvingStartedAt',
    decaying: 'decayStartedAt',
    active: 'activeSince',
};
/* ────────────────────── Class ────────────────────── */
export class LifecycleStateMachine {
    #knowledgeRepo;
    #eventRepo;
    #signalBus;
    #proposalRepo;
    #logger = Logger.getInstance();
    constructor(knowledgeRepo, eventRepo, signalBus, proposalRepo) {
        this.#knowledgeRepo = knowledgeRepo;
        this.#eventRepo = eventRepo;
        this.#signalBus = signalBus;
        this.#proposalRepo = proposalRepo;
    }
    /* ═══════════════════ Core Transition ═══════════════════ */
    /**
     * 执行状态转移 — THE ONLY WAY
     *
     * 流程:
     *   1. 读取当前 lifecycle
     *   2. Guard: isValidTransition(from, to)
     *   3. Exit Action
     *   4. DB 更新
     *   5. Entry Action
     *   6. 记录 TransitionEvent
     *   7. 发射 lifecycle signal
     *
     * Guard 拒绝 → 返回 { success: false }
     * 调用者不应 fallback 到 updateLifecycle()
     */
    async transition(request) {
        const { recipeId, targetState, trigger, evidence, proposalId, operatorId } = request;
        const opId = operatorId ?? 'system';
        // 1. 获取当前状态
        const current = await this.#getRecipeState(recipeId);
        if (!current) {
            return {
                success: false,
                fromState: 'unknown',
                toState: targetState,
                error: 'Recipe not found',
            };
        }
        const fromState = current.lifecycle;
        // 2. Guard 检查
        if (!isValidTransition(fromState, targetState)) {
            this.#logger.warn(`[LifecycleStateMachine] Invalid transition: ${recipeId} ${fromState} → ${targetState} (trigger: ${trigger})`);
            return {
                success: false,
                fromState,
                toState: targetState,
                error: `Invalid transition: ${fromState} → ${targetState}`,
            };
        }
        // 3. Exit Action
        await this.#executeExitAction(recipeId, fromState);
        // 4. 更新 lifecycle
        const now = Date.now();
        await this.#knowledgeRepo.updateLifecycle(recipeId, targetState);
        // 5. Entry Action
        await this.#executeEntryAction(recipeId, targetState, now, proposalId);
        // 6. 记录 TransitionEvent
        const event = this.#recordEvent({
            recipeId,
            fromState,
            toState: targetState,
            trigger,
            evidence: evidence ?? null,
            proposalId: proposalId ?? null,
            operatorId: opId,
            createdAt: now,
        });
        // 7. 发射 lifecycle signal
        this.#emitSignal(recipeId, fromState, targetState, trigger);
        this.#logger.info(`[LifecycleStateMachine] ${recipeId}: ${fromState} → ${targetState} (trigger: ${trigger})`);
        return { success: true, fromState, toState: targetState, event };
    }
    /* ═══════════════════ Timeout Check ═══════════════════ */
    async checkTimeouts() {
        const result = { timedOut: [], checked: 0 };
        const now = Date.now();
        for (const [state, timeoutMs] of Object.entries(TIMEOUT_MS)) {
            if (!(state in TIMEOUT_TARGET)) {
                continue;
            }
            const targetState = TIMEOUT_TARGET[state];
            const entries = await this.#knowledgeRepo.findAllByLifecycles([state]);
            result.checked += entries.length;
            for (const entry of entries) {
                const stats = (entry.stats ?? {});
                const entryKey = ENTRY_META_KEYS[state];
                const enteredAt = (entryKey ? stats[entryKey] : null);
                const stateAge = enteredAt ? now - enteredAt : await this.#getRecipeAge(entry.id, now);
                if (stateAge > timeoutMs) {
                    const transitionResult = await this.transition({
                        recipeId: entry.id,
                        targetState,
                        trigger: 'timeout-recovery',
                        evidence: {
                            reason: `${state} timeout after ${Math.round(stateAge / (24 * 60 * 60 * 1000))}d`,
                        },
                    });
                    if (transitionResult.success) {
                        result.timedOut.push({
                            recipeId: entry.id,
                            fromState: state,
                            toState: targetState,
                            age: stateAge,
                        });
                    }
                }
            }
        }
        if (result.timedOut.length > 0) {
            this.#logger.info(`[LifecycleStateMachine] Timeout check: ${result.timedOut.length} recipes timed out (checked: ${result.checked})`);
        }
        return result;
    }
    /* ═══════════════════ Query ═══════════════════ */
    getHistory(recipeId, limit = 50) {
        return this.#eventRepo.getHistory(recipeId, limit);
    }
    async getHealth() {
        const now = Date.now();
        const stateDistribution = await this.#getStateDistribution();
        const intermediateStates = {
            stuckEvolving: await this.#getStuckInfo('evolving', STUCK_THRESHOLD_MS.evolving, now),
            stuckDecaying: await this.#getStuckInfo('decaying', STUCK_THRESHOLD_MS.decaying, now),
            stuckStaging: await this.#getStuckInfo('staging', STUCK_THRESHOLD_MS.staging, now),
            stuckPending: await this.#getStuckInfo('pending', STUCK_THRESHOLD_MS.pending, now),
        };
        const recentTransitions = this.#getRecentTransitionStats(now);
        const proposalMetrics = this.#getProposalMetrics();
        return { stateDistribution, intermediateStates, recentTransitions, proposalMetrics };
    }
    /* ═══════════════════ Entry/Exit Actions ═══════════════════ */
    async #executeEntryAction(recipeId, state, now, proposalId) {
        const metaKey = ENTRY_META_KEYS[state];
        if (!metaKey) {
            return;
        }
        const entry = await this.#knowledgeRepo.findById(recipeId);
        const stats = (entry?.stats ?? {});
        stats[metaKey] = now;
        if (state === 'evolving' && proposalId) {
            stats.evolvingProposalId = proposalId;
        }
        if (state === 'active') {
            delete stats.evolvingStartedAt;
            delete stats.evolvingProposalId;
            delete stats.decayStartedAt;
        }
        if (state === 'deprecated') {
            stats.deprecatedAt = now;
        }
        await this.#knowledgeRepo.update(recipeId, { stats });
    }
    async #executeExitAction(recipeId, state) {
        if (state === 'active') {
            const entry = await this.#knowledgeRepo.findById(recipeId);
            const stats = (entry?.stats ?? {});
            stats.lastActiveAt = Date.now();
            await this.#knowledgeRepo.update(recipeId, { stats });
        }
    }
    /* ═══════════════════ Event Recording ═══════════════════ */
    #recordEvent(params) {
        const id = randomUUID();
        const event = {
            id,
            recipeId: params.recipeId,
            fromState: params.fromState,
            toState: params.toState,
            trigger: params.trigger,
            evidence: params.evidence,
            proposalId: params.proposalId,
            operatorId: params.operatorId,
            createdAt: params.createdAt,
        };
        try {
            this.#eventRepo.record({
                id,
                recipeId: params.recipeId,
                fromState: params.fromState,
                toState: params.toState,
                trigger: params.trigger,
                operatorId: params.operatorId,
                evidence: params.evidence,
                proposalId: params.proposalId,
                createdAt: params.createdAt,
            });
        }
        catch {
            this.#logger.warn(`[LifecycleStateMachine] Failed to record transition event (table may not exist)`);
        }
        return event;
    }
    /* ═══════════════════ Health Queries ═══════════════════ */
    async #getStateDistribution() {
        const dist = {
            pending: 0,
            staging: 0,
            active: 0,
            evolving: 0,
            decaying: 0,
            deprecated: 0,
        };
        try {
            const grouped = await this.#knowledgeRepo.countGroupByLifecycle();
            for (const [lifecycle, cnt] of Object.entries(grouped)) {
                dist[lifecycle] = cnt;
            }
        }
        catch {
            // fallback
        }
        return dist;
    }
    async #getStuckInfo(state, thresholdMs, now) {
        try {
            const entries = await this.#knowledgeRepo.findAllByLifecycles([state]);
            let stuckCount = 0;
            let oldestAge = 0;
            for (const entry of entries) {
                const stats = (entry.stats ?? {});
                const metaKey = ENTRY_META_KEYS[state];
                const enteredAt = (metaKey ? stats[metaKey] : null);
                const age = enteredAt ? now - enteredAt : now - (entry.updatedAt || now);
                if (age > thresholdMs) {
                    stuckCount++;
                    if (age > oldestAge) {
                        oldestAge = age;
                    }
                }
            }
            return { count: stuckCount, oldestAge };
        }
        catch {
            return { count: 0, oldestAge: 0 };
        }
    }
    #getRecentTransitionStats(now) {
        try {
            const last24hCount = this.#eventRepo.countSince(now - 24 * 60 * 60 * 1000);
            const last7dCount = this.#eventRepo.countSince(now - 7 * 24 * 60 * 60 * 1000);
            const topTriggers = this.#eventRepo.topTriggersSince(now - 7 * 24 * 60 * 60 * 1000, 5);
            return { last24h: last24hCount, last7d: last7dCount, topTriggers };
        }
        catch {
            return { last24h: 0, last7d: 0, topTriggers: [] };
        }
    }
    #getProposalMetrics() {
        try {
            const statusMap = this.#proposalRepo.stats();
            const pending = statusMap.pending ?? 0;
            const observing = statusMap.observing ?? 0;
            const executed = statusMap.executed ?? 0;
            const rejected = statusMap.rejected ?? 0;
            const expired = statusMap.expired ?? 0;
            const total = executed + rejected + expired;
            let contentPatchRate = 0;
            try {
                const patchCount = this.#eventRepo.countByTrigger('content-patch-complete');
                const execCount = this.#eventRepo.countByTriggers([
                    'proposal-execution',
                    'proposal-attach',
                ]);
                contentPatchRate = execCount > 0 ? patchCount / execCount : 0;
            }
            catch {
                // table may not exist yet
            }
            return {
                pendingCount: pending,
                observingCount: observing,
                executionRate: total > 0 ? executed / total : 0,
                avgObservationDays: 0,
                contentPatchRate,
            };
        }
        catch {
            return {
                pendingCount: 0,
                observingCount: 0,
                executionRate: 0,
                avgObservationDays: 0,
                contentPatchRate: 0,
            };
        }
    }
    /* ═══════════════════ DB Helpers ═══════════════════ */
    async #getRecipeState(recipeId) {
        const entry = await this.#knowledgeRepo.findById(recipeId);
        return entry ? { lifecycle: entry.lifecycle } : null;
    }
    async #getRecipeAge(recipeId, now) {
        const entry = await this.#knowledgeRepo.findById(recipeId);
        return entry ? now - (entry.updatedAt || now) : 0;
    }
    /* ═══════════════════ Signal ═══════════════════ */
    #emitSignal(recipeId, fromState, toState, trigger) {
        this.#signalBus.send('lifecycle', 'LifecycleStateMachine', 0.5, {
            target: recipeId,
            metadata: {
                fromState,
                toState,
                trigger,
            },
        });
    }
}

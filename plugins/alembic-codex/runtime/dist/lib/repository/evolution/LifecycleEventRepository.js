/**
 * LifecycleEventRepository — lifecycle_transition_events 表 CRUD (Drizzle ORM)
 *
 * 操作 lifecycle_transition_events 表，存储 Recipe 生命周期状态转移事件。
 *
 * Drizzle 迁移策略：
 *   - 替代 RecipeLifecycleSupervisor 中的所有 rawDb.prepare() 调用
 *   - 消除 12 个 escape-hatch 注解
 */
import { count, desc, eq, gt, sql } from 'drizzle-orm';
import { lifecycleTransitionEvents } from '../../infrastructure/database/drizzle/schema.js';
/* ────────────────────── Class ────────────────────── */
export class LifecycleEventRepository {
    #drizzle;
    constructor(drizzle) {
        this.#drizzle = drizzle;
    }
    /* ═══════════════════ Write ═══════════════════ */
    record(input) {
        this.#drizzle
            .insert(lifecycleTransitionEvents)
            .values({
            id: input.id,
            recipeId: input.recipeId,
            fromState: input.fromState,
            toState: input.toState,
            trigger: input.trigger,
            operatorId: input.operatorId,
            evidenceJson: input.evidence ? JSON.stringify(input.evidence) : null,
            proposalId: input.proposalId,
            createdAt: input.createdAt,
        })
            .run();
    }
    /* ═══════════════════ Read ═══════════════════ */
    /** 获取指定 Recipe 的转移历史（按时间倒序） */
    getHistory(recipeId, limit = 50) {
        const rows = this.#drizzle
            .select()
            .from(lifecycleTransitionEvents)
            .where(eq(lifecycleTransitionEvents.recipeId, recipeId))
            .orderBy(desc(lifecycleTransitionEvents.createdAt))
            .limit(limit)
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 统计指定时间之后的事件数量 */
    countSince(since) {
        const result = this.#drizzle
            .select({ cnt: count() })
            .from(lifecycleTransitionEvents)
            .where(gt(lifecycleTransitionEvents.createdAt, since))
            .get();
        return result?.cnt ?? 0;
    }
    /** 按 trigger 分组统计（限定时间窗口，按数量倒序前 N） */
    topTriggersSince(since, limit = 5) {
        const rows = this.#drizzle
            .select({
            trigger: lifecycleTransitionEvents.trigger,
            cnt: count(),
        })
            .from(lifecycleTransitionEvents)
            .where(gt(lifecycleTransitionEvents.createdAt, since))
            .groupBy(lifecycleTransitionEvents.trigger)
            .orderBy(sql `count(*) desc`)
            .limit(limit)
            .all();
        return rows.map((r) => ({ trigger: r.trigger, count: r.cnt }));
    }
    /** 按 trigger 值统计数量 */
    countByTrigger(trigger) {
        const result = this.#drizzle
            .select({ cnt: count() })
            .from(lifecycleTransitionEvents)
            .where(eq(lifecycleTransitionEvents.trigger, trigger))
            .get();
        return result?.cnt ?? 0;
    }
    /** 按多个 trigger 值统计数量 */
    countByTriggers(triggers) {
        if (triggers.length === 0) {
            return 0;
        }
        // Build OR condition for multiple triggers
        const result = this.#drizzle
            .select({ cnt: count() })
            .from(lifecycleTransitionEvents)
            .where(sql `${lifecycleTransitionEvents.trigger} IN (${sql.join(triggers.map((t) => sql `${t}`), sql `, `)})`)
            .get();
        return result?.cnt ?? 0;
    }
    /* ═══════════════════ Internal ═══════════════════ */
    #mapRow(row) {
        return {
            id: row.id,
            recipeId: row.recipeId,
            fromState: row.fromState,
            toState: row.toState,
            trigger: row.trigger,
            operatorId: row.operatorId,
            evidence: row.evidenceJson ? safeJsonParse(row.evidenceJson, null) : null,
            proposalId: row.proposalId ?? null,
            createdAt: row.createdAt,
        };
    }
}
/* ────────────────────── Util ────────────────────── */
function safeJsonParse(json, fallback) {
    if (!json) {
        return fallback;
    }
    try {
        return JSON.parse(json);
    }
    catch {
        return fallback;
    }
}

/**
 * ProposalRepository — evolution_proposals 表 CRUD (Drizzle ORM)
 *
 * 操作 evolution_proposals 表，存储进化提案（update/deprecate）。
 *
 * 设计要求：
 *   - 去重：同 target + 同 type 不允许多个 observing 状态的 Proposal
 *   - Rate Limit：同一 target 不允许同时存在多个相同类型的 observing Proposal
 *   - JSON 字段（evidence/related_recipe_ids）序列化/反序列化
 *   - 观察窗口按风险等级分 tier（low 24h / medium 72h / high 7d）
 *
 * Drizzle 迁移策略 (Phase 5a)：
 *   - 全部 raw SQL → Drizzle 类型安全 API
 *   - 构造器接收 DrizzleDB（不再需要 raw Database）
 */
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, inArray, lte } from 'drizzle-orm';
import { EvolutionPolicy } from '../../domain/evolution/EvolutionPolicy.js';
import { evolutionProposals } from '../../infrastructure/database/drizzle/schema.js';
/* ────────────────────── Constants ────────────────────── */
/** 默认观察窗口：72h（medium tier） */
const DEFAULT_OBSERVATION_WINDOW = 72 * 60 * 60 * 1000;
/** 观察窗口按 ProposalType 的默认值（EvolutionGateway 按 RiskTier 精确控制） */
const OBSERVATION_WINDOWS = {
    update: 72 * 60 * 60 * 1000, // 72h (medium tier default)
    deprecate: 7 * 24 * 60 * 60 * 1000, // 7d (high tier)
};
/* ────────────────────── Class ────────────────────── */
export class ProposalRepository {
    #drizzle;
    constructor(drizzle) {
        this.#drizzle = drizzle;
    }
    /* ═══════════════════ Create ═══════════════════ */
    /**
     * 创建 Proposal 并写入 DB。
     *
     * - 自动生成 ID（ep-{timestamp}-{random}）
     * - 自动设定 expiresAt（按 type 默认窗口）
     * - 自动判断 status（低风险 + 高置信度 → observing，否则 pending）
     * - 去重：同 target + 同 type 已有 pending/observing 时拒绝创建
     */
    create(input) {
        const now = Date.now();
        // 去重检查
        if (this.#hasDuplicate(input.targetRecipeId, input.type)) {
            return null;
        }
        const id = ProposalRepository.#generateId(now);
        const expiresAt = input.expiresAt ?? now + (OBSERVATION_WINDOWS[input.type] ?? DEFAULT_OBSERVATION_WINDOW);
        const status = input.status ?? EvolutionPolicy.resolveInitialStatus(input.type, input.confidence);
        const record = {
            id,
            type: input.type,
            targetRecipeId: input.targetRecipeId,
            relatedRecipeIds: input.relatedRecipeIds ?? [],
            confidence: input.confidence,
            source: input.source,
            description: input.description,
            evidence: input.evidence ?? [],
            status,
            proposedAt: now,
            expiresAt,
            resolvedAt: null,
            resolvedBy: null,
            resolution: null,
        };
        this.#drizzle
            .insert(evolutionProposals)
            .values({
            id: record.id,
            type: record.type,
            targetRecipeId: record.targetRecipeId,
            relatedRecipeIds: JSON.stringify(record.relatedRecipeIds),
            confidence: record.confidence,
            source: record.source,
            description: record.description,
            evidence: JSON.stringify(record.evidence),
            status: record.status,
            proposedAt: record.proposedAt,
            expiresAt: record.expiresAt,
        })
            .run();
        return record;
    }
    /* ═══════════════════ Read ═══════════════════ */
    /** 按 ID 查询 */
    findById(id) {
        const row = this.#drizzle
            .select()
            .from(evolutionProposals)
            .where(eq(evolutionProposals.id, id))
            .limit(1)
            .get();
        return row ? ProposalRepository.#mapRow(row) : null;
    }
    /** 按条件查询 */
    find(filter = {}) {
        const conditions = [];
        if (filter.status) {
            if (Array.isArray(filter.status)) {
                conditions.push(inArray(evolutionProposals.status, filter.status));
            }
            else {
                conditions.push(eq(evolutionProposals.status, filter.status));
            }
        }
        if (filter.type) {
            conditions.push(eq(evolutionProposals.type, filter.type));
        }
        if (filter.targetRecipeId) {
            conditions.push(eq(evolutionProposals.targetRecipeId, filter.targetRecipeId));
        }
        if (filter.source) {
            conditions.push(eq(evolutionProposals.source, filter.source));
        }
        if (filter.expiredBefore) {
            conditions.push(lte(evolutionProposals.expiresAt, filter.expiredBefore));
        }
        const condition = conditions.length > 0 ? and(...conditions) : undefined;
        const rows = this.#drizzle
            .select()
            .from(evolutionProposals)
            .where(condition)
            .orderBy(desc(evolutionProposals.proposedAt))
            .all();
        return rows.map((r) => ProposalRepository.#mapRow(r));
    }
    /** 查询已到期的 observing 状态 Proposal */
    findExpiredObserving() {
        return this.find({
            status: 'observing',
            expiredBefore: Date.now(),
        });
    }
    /** 查询所有未完成的 Proposal（pending + observing） */
    findActive() {
        return this.find({
            status: ['pending', 'observing'],
        });
    }
    /** 按 target Recipe ID 查询活跃 Proposal */
    findByTarget(targetRecipeId) {
        return this.find({
            targetRecipeId,
            status: ['pending', 'observing'],
        });
    }
    /* ═══════════════════ Update ═══════════════════ */
    /** 将 Proposal 状态转为 observing */
    startObserving(id) {
        const now = Date.now();
        const proposal = this.findById(id);
        if (!proposal || proposal.status !== 'pending') {
            return false;
        }
        const expiresAt = now + (OBSERVATION_WINDOWS[proposal.type] ?? DEFAULT_OBSERVATION_WINDOW);
        const result = this.#drizzle
            .update(evolutionProposals)
            .set({ status: 'observing', expiresAt })
            .where(and(eq(evolutionProposals.id, id), eq(evolutionProposals.status, 'pending')))
            .run();
        return result.changes > 0;
    }
    /** 标记 Proposal 为已执行 */
    markExecuted(id, resolution, resolvedBy = 'auto') {
        const result = this.#drizzle
            .update(evolutionProposals)
            .set({
            status: 'executed',
            resolvedAt: Date.now(),
            resolvedBy,
            resolution,
        })
            .where(and(eq(evolutionProposals.id, id), eq(evolutionProposals.status, 'observing')))
            .run();
        return result.changes > 0;
    }
    /** 标记 Proposal 为已拒绝 */
    markRejected(id, resolution, resolvedBy = 'auto') {
        const result = this.#drizzle
            .update(evolutionProposals)
            .set({
            status: 'rejected',
            resolvedAt: Date.now(),
            resolvedBy,
            resolution,
        })
            .where(and(eq(evolutionProposals.id, id), inArray(evolutionProposals.status, ['pending', 'observing'])))
            .run();
        return result.changes > 0;
    }
    /** 标记 Proposal 为过期 */
    markExpired(id) {
        const result = this.#drizzle
            .update(evolutionProposals)
            .set({
            status: 'expired',
            resolvedAt: Date.now(),
        })
            .where(and(eq(evolutionProposals.id, id), inArray(evolutionProposals.status, ['pending', 'observing'])))
            .run();
        return result.changes > 0;
    }
    /** 更新 evidence（用于追加观察期指标快照） */
    updateEvidence(id, evidence) {
        const result = this.#drizzle
            .update(evolutionProposals)
            .set({ evidence: JSON.stringify(evidence) })
            .where(eq(evolutionProposals.id, id))
            .run();
        return result.changes > 0;
    }
    /* ═══════════════════ Delete ═══════════════════ */
    /** 按 target Recipe ID 删除所有 Proposal（用于知识删除时清理关联提案） */
    deleteByTargetRecipeId(targetRecipeId) {
        const result = this.#drizzle
            .delete(evolutionProposals)
            .where(eq(evolutionProposals.targetRecipeId, targetRecipeId))
            .run();
        return result.changes;
    }
    /* ═══════════════════ Stats ═══════════════════ */
    /** 统计各状态的 Proposal 数量 */
    stats() {
        const rows = this.#drizzle
            .select({
            status: evolutionProposals.status,
            count: count(),
        })
            .from(evolutionProposals)
            .groupBy(evolutionProposals.status)
            .all();
        const result = {
            pending: 0,
            observing: 0,
            executed: 0,
            rejected: 0,
            expired: 0,
        };
        for (const row of rows) {
            result[row.status] = row.count;
        }
        return result;
    }
    /* ═══════════════════ Private ═══════════════════ */
    /** 去重检查：同 target + 同 type 是否已有 pending/observing Proposal */
    #hasDuplicate(targetRecipeId, type) {
        const row = this.#drizzle
            .select({ id: evolutionProposals.id })
            .from(evolutionProposals)
            .where(and(eq(evolutionProposals.targetRecipeId, targetRecipeId), eq(evolutionProposals.type, type), inArray(evolutionProposals.status, ['pending', 'observing'])))
            .limit(1)
            .get();
        return row !== undefined;
    }
    /** 生成 Proposal ID */
    static #generateId(timestamp) {
        const rand = randomBytes(4).toString('hex');
        return `ep-${timestamp}-${rand}`;
    }
    /** Drizzle Row → ProposalRecord */
    static #mapRow(row) {
        return {
            id: row.id,
            type: row.type,
            targetRecipeId: row.targetRecipeId,
            relatedRecipeIds: safeJsonParse(row.relatedRecipeIds, []),
            confidence: row.confidence,
            source: row.source,
            description: row.description ?? '',
            evidence: safeJsonParse(row.evidence, []),
            status: row.status,
            proposedAt: row.proposedAt,
            expiresAt: row.expiresAt,
            resolvedAt: row.resolvedAt ?? null,
            resolvedBy: row.resolvedBy ?? null,
            resolution: row.resolution ?? null,
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

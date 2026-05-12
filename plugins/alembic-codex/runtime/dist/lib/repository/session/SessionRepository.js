/**
 * SessionRepository — 会话管理的仓储实现
 *
 * 操作 sessions 表，负责会话的 CRUD 和过期清理。
 * 使用 Drizzle 类型安全 API。
 */
import { and, count, desc, eq, lt, sql } from 'drizzle-orm';
import { sessions } from '../../infrastructure/database/drizzle/schema.js';
import { RepositoryBase } from '../base/RepositoryBase.js';
/* ═══ 仓储实现 ═══ */
export class SessionRepositoryImpl extends RepositoryBase {
    constructor(drizzle) {
        super(drizzle, sessions);
    }
    /* ═══ CRUD ═══ */
    async findById(id) {
        const row = this.drizzle.select().from(sessions).where(eq(sessions.id, id)).get();
        return row ? SessionRepositoryImpl.#toEntity(row) : null;
    }
    async create(data) {
        this.drizzle
            .insert(sessions)
            .values({
            id: data.id,
            scope: data.scope,
            scopeId: data.scopeId ?? null,
            context: JSON.stringify(data.context ?? {}),
            metadata: JSON.stringify(data.metadata ?? {}),
            actor: data.actor ?? null,
            createdAt: data.createdAt,
            lastActiveAt: data.lastActiveAt ?? data.createdAt,
        })
            .run();
        const entity = await this.findById(data.id);
        if (!entity) {
            throw new Error(`Failed to create session: ${data.id}`);
        }
        return entity;
    }
    async delete(id) {
        const result = this.drizzle.delete(sessions).where(eq(sessions.id, id)).run();
        return (result.changes ?? 0) > 0;
    }
    /* ═══ 查询 ═══ */
    /** 按 scope 查询所有会话 */
    async findByScope(scope) {
        const rows = this.drizzle
            .select()
            .from(sessions)
            .where(eq(sessions.scope, scope))
            .orderBy(desc(sessions.createdAt))
            .all();
        return rows.map(SessionRepositoryImpl.#toEntity);
    }
    /** 按 actor 查询 */
    async findByActor(actor) {
        const rows = this.drizzle
            .select()
            .from(sessions)
            .where(eq(sessions.actor, actor))
            .orderBy(desc(sessions.lastActiveAt))
            .all();
        return rows.map(SessionRepositoryImpl.#toEntity);
    }
    /** 更新最后活跃时间 */
    async updateLastActivity(id, timestamp) {
        this.drizzle
            .update(sessions)
            .set({ lastActiveAt: timestamp ?? Math.floor(Date.now() / 1000) })
            .where(eq(sessions.id, id))
            .run();
    }
    /** 过期清理 — 删除 expiredAt < now 的会话 */
    async cleanup(now) {
        const threshold = now ?? Math.floor(Date.now() / 1000);
        const result = this.drizzle
            .delete(sessions)
            .where(and(sql `${sessions.expiredAt} IS NOT NULL`, lt(sessions.expiredAt, threshold)))
            .run();
        return result.changes ?? 0;
    }
    /** 会话总数 */
    async count(scope) {
        const condition = scope ? eq(sessions.scope, scope) : undefined;
        const [row] = this.drizzle.select({ cnt: count() }).from(sessions).where(condition).all();
        return row?.cnt ?? 0;
    }
    /* ═══ Private ═══ */
    static #toEntity(row) {
        return {
            id: row.id,
            scope: row.scope,
            scopeId: row.scopeId ?? null,
            context: SessionRepositoryImpl.#safeJson(row.context),
            metadata: SessionRepositoryImpl.#safeJson(row.metadata),
            actor: row.actor ?? null,
            createdAt: row.createdAt,
            lastActiveAt: row.lastActiveAt ?? null,
            expiredAt: row.expiredAt ?? null,
        };
    }
    static #safeJson(str) {
        try {
            return str ? JSON.parse(str) : {};
        }
        catch {
            return {};
        }
    }
}

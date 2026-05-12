/**
 * RecipeSourceRefRepository — recipe_source_refs 表 CRUD (Drizzle ORM)
 *
 * Recipe 来源引用桥接表：建立 Recipe ↔ 源码文件的映射关系。
 * 表使用复合主键 (recipe_id, source_path)，没有独立 id 列。
 *
 * 主要消费者：SourceRefReconciler
 */
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { recipeSourceRefs } from '../../infrastructure/database/drizzle/schema.js';
/* ═══ Repository 实现 ═══ */
export class RecipeSourceRefRepositoryImpl {
    #drizzle;
    constructor(drizzle) {
        this.#drizzle = drizzle;
    }
    /* ─── 查询 ─── */
    /** 按 Recipe ID 查询所有关联的源引用 */
    findByRecipeId(recipeId) {
        return this.#drizzle
            .select()
            .from(recipeSourceRefs)
            .where(eq(recipeSourceRefs.recipeId, recipeId))
            .all();
    }
    /** 按源文件路径查询所有关联的引用 */
    findBySourcePath(sourcePath) {
        return this.#drizzle
            .select()
            .from(recipeSourceRefs)
            .where(eq(recipeSourceRefs.sourcePath, sourcePath))
            .all();
    }
    /** 按状态查询 */
    findByStatus(status) {
        return this.#drizzle
            .select()
            .from(recipeSourceRefs)
            .where(eq(recipeSourceRefs.status, status))
            .all();
    }
    /** 查找指定复合键 */
    findOne(recipeId, sourcePath) {
        const row = this.#drizzle
            .select()
            .from(recipeSourceRefs)
            .where(and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath)))
            .limit(1)
            .get();
        return row ?? null;
    }
    /** 查询所有 stale 引用 */
    findStale() {
        return this.findByStatus('stale');
    }
    /** 统计条数 */
    count() {
        const row = this.#drizzle.select({ cnt: sql `count(*)` }).from(recipeSourceRefs).get();
        return row?.cnt ?? 0;
    }
    /* ─── 写入 ─── */
    /** UPSERT — 插入或更新（按复合主键） */
    upsert(data) {
        this.#drizzle
            .insert(recipeSourceRefs)
            .values({
            recipeId: data.recipeId,
            sourcePath: data.sourcePath,
            status: data.status ?? 'active',
            newPath: data.newPath ?? null,
            verifiedAt: data.verifiedAt,
        })
            .onConflictDoUpdate({
            target: [recipeSourceRefs.recipeId, recipeSourceRefs.sourcePath],
            set: {
                status: data.status ?? 'active',
                newPath: data.newPath ?? null,
                verifiedAt: data.verifiedAt,
            },
        })
            .run();
    }
    /** 更新状态 */
    updateStatus(recipeId, sourcePath, status, newPath) {
        const set = { status };
        if (newPath !== undefined) {
            set.newPath = newPath;
        }
        const result = this.#drizzle
            .update(recipeSourceRefs)
            .set(set)
            .where(and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath)))
            .run();
        return result.changes > 0;
    }
    /* ─── 删除 ─── */
    /** 按 Recipe ID 删除所有关联引用 */
    deleteByRecipeId(recipeId) {
        const result = this.#drizzle
            .delete(recipeSourceRefs)
            .where(eq(recipeSourceRefs.recipeId, recipeId))
            .run();
        return result.changes;
    }
    /** 删除指定复合键 */
    deleteOne(recipeId, sourcePath) {
        const result = this.#drizzle
            .delete(recipeSourceRefs)
            .where(and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, sourcePath)))
            .run();
        return result.changes > 0;
    }
    /** 检查表是否可访问（SourceRefReconciler 使用） */
    isAccessible() {
        try {
            this.#drizzle
                .select({ recipeId: recipeSourceRefs.recipeId })
                .from(recipeSourceRefs)
                .limit(1)
                .get();
            return true;
        }
        catch {
            return false;
        }
    }
    /** Stale counts grouped by recipe (for SourceRefReconciler signal emission) */
    getStaleCountsByRecipe() {
        const rows = this.#drizzle
            .select({
            recipeId: recipeSourceRefs.recipeId,
            staleCount: sql `count(*)`,
            totalCount: sql `(SELECT count(*) FROM recipe_source_refs r2 WHERE r2.recipe_id = ${recipeSourceRefs.recipeId})`,
        })
            .from(recipeSourceRefs)
            .where(eq(recipeSourceRefs.status, 'stale'))
            .groupBy(recipeSourceRefs.recipeId)
            .all();
        return rows.map((r) => ({
            recipeId: r.recipeId,
            staleCount: Number(r.staleCount),
            totalCount: Number(r.totalCount),
        }));
    }
    /** Find all entries with status='renamed' and non-null new_path */
    findRenamed() {
        return this.#drizzle
            .select()
            .from(recipeSourceRefs)
            .where(and(eq(recipeSourceRefs.status, 'renamed'), isNotNull(recipeSourceRefs.newPath)))
            .all();
    }
    /** Replace source path (updates composite key column) — used by SourceRefReconciler.applyRepairs */
    replaceSourcePath(recipeId, oldSourcePath, newSourcePath, verifiedAt) {
        this.#drizzle
            .update(recipeSourceRefs)
            .set({
            sourcePath: newSourcePath,
            status: 'active',
            newPath: null,
            verifiedAt,
        })
            .where(and(eq(recipeSourceRefs.recipeId, recipeId), eq(recipeSourceRefs.sourcePath, oldSourcePath)))
            .run();
    }
    /** 查询多个 Recipe 的非 stale 来源引用（SearchEngine _supplementDetails 用） */
    findActiveByRecipeIds(ids) {
        if (ids.length === 0) {
            return [];
        }
        return this.#drizzle
            .select({
            recipeId: recipeSourceRefs.recipeId,
            sourcePath: recipeSourceRefs.sourcePath,
            status: recipeSourceRefs.status,
            newPath: recipeSourceRefs.newPath,
        })
            .from(recipeSourceRefs)
            .where(and(inArray(recipeSourceRefs.recipeId, ids), ne(recipeSourceRefs.status, 'stale')))
            .all();
    }
}

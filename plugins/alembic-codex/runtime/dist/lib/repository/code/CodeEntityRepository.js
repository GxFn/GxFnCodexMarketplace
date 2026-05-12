/**
 * CodeEntityRepository — AST 代码实体的仓储实现
 *
 * 从 CodeEntityGraph 和 PanoramaScanner 提取的数据操作，
 * 使用 Drizzle 类型安全 API。
 */
import { and, count, eq, inArray, isNotNull, like, ne, sql } from 'drizzle-orm';
import { codeEntities } from '../../infrastructure/database/drizzle/schema.js';
import { unixNow } from '../../shared/utils/common.js';
import { RepositoryBase } from '../base/RepositoryBase.js';
/* ═══ Repository 实现 ═══ */
export class CodeEntityRepositoryImpl extends RepositoryBase {
    constructor(drizzle) {
        super(drizzle, codeEntities);
    }
    /* ─── CRUD ─── */
    async findById(id) {
        const rows = this.drizzle.select().from(this.table).where(eq(this.table.id, id)).limit(1).all();
        return rows.length > 0 ? this.#mapRow(rows[0]) : null;
    }
    async create(data) {
        return this.upsert(data);
    }
    async delete(id) {
        const result = this.drizzle.delete(this.table).where(eq(this.table.id, id)).run();
        return result.changes > 0;
    }
    /* ─── 核心操作 ─── */
    /** UPSERT — 按 (entityId, entityType, projectRoot) 唯一约束 */
    async upsert(entity) {
        const now = unixNow();
        const protocolsJson = JSON.stringify(entity.protocols ?? []);
        const metaJson = JSON.stringify(entity.metadata ?? {});
        this.drizzle
            .insert(this.table)
            .values({
            entityId: entity.entityId,
            entityType: entity.entityType,
            projectRoot: entity.projectRoot,
            name: entity.name,
            filePath: entity.filePath ?? null,
            lineNumber: entity.lineNumber ?? null,
            superclass: entity.superclass ?? null,
            protocols: protocolsJson,
            metadataJson: metaJson,
            createdAt: now,
            updatedAt: now,
        })
            .onConflictDoUpdate({
            target: [this.table.entityId, this.table.entityType, this.table.projectRoot],
            set: {
                name: entity.name,
                filePath: sql `${entity.filePath ?? null}`,
                lineNumber: sql `${entity.lineNumber ?? null}`,
                superclass: sql `${entity.superclass ?? null}`,
                protocols: protocolsJson,
                metadataJson: metaJson,
                updatedAt: now,
            },
        })
            .run();
        // 返回 upserted 行
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.entityId, entity.entityId), eq(this.table.entityType, entity.entityType), eq(this.table.projectRoot, entity.projectRoot)))
            .limit(1)
            .all();
        return this.#mapRow(rows[0]);
    }
    /** 批量 UPSERT */
    async batchUpsert(entities) {
        if (entities.length === 0) {
            return 0;
        }
        let upserted = 0;
        this.transaction((tx) => {
            const now = unixNow();
            for (const entity of entities) {
                tx.insert(this.table)
                    .values({
                    entityId: entity.entityId,
                    entityType: entity.entityType,
                    projectRoot: entity.projectRoot,
                    name: entity.name,
                    filePath: entity.filePath ?? null,
                    lineNumber: entity.lineNumber ?? null,
                    superclass: entity.superclass ?? null,
                    protocols: JSON.stringify(entity.protocols ?? []),
                    metadataJson: JSON.stringify(entity.metadata ?? {}),
                    createdAt: now,
                    updatedAt: now,
                })
                    .onConflictDoUpdate({
                    target: [this.table.entityId, this.table.entityType, this.table.projectRoot],
                    set: {
                        name: entity.name,
                        filePath: sql `${entity.filePath ?? null}`,
                        lineNumber: sql `${entity.lineNumber ?? null}`,
                        superclass: sql `${entity.superclass ?? null}`,
                        protocols: JSON.stringify(entity.protocols ?? []),
                        metadataJson: JSON.stringify(entity.metadata ?? {}),
                        updatedAt: now,
                    },
                })
                    .run();
                upserted++;
            }
        });
        return upserted;
    }
    /* ─── 查询 ─── */
    /** 按文件路径查询 */
    async findByFile(filePath, projectRoot) {
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.filePath, filePath), eq(this.table.projectRoot, projectRoot)))
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 按实体类型列表 */
    async listByType(entityType, projectRoot, limit = 100) {
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.entityType, entityType), eq(this.table.projectRoot, projectRoot)))
            .orderBy(this.table.name)
            .limit(limit)
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 按名称搜索 */
    async searchByName(query, projectRoot, options = {}) {
        const { entityType, limit = 50 } = options;
        const conditions = [
            eq(this.table.projectRoot, projectRoot),
            like(this.table.name, `%${query}%`),
        ];
        if (entityType) {
            conditions.push(eq(this.table.entityType, entityType));
        }
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(...conditions))
            .orderBy(this.table.name)
            .limit(limit)
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 按 entityId + entityType + projectRoot 精确查找 */
    async findByEntityId(entityId, entityType, projectRoot) {
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.entityId, entityId), eq(this.table.entityType, entityType), eq(this.table.projectRoot, projectRoot)))
            .limit(1)
            .all();
        return rows.length > 0 ? this.#mapRow(rows[0]) : null;
    }
    /** 删除指定项目的所有实体 */
    async clearProject(projectRoot) {
        const result = this.drizzle
            .delete(this.table)
            .where(eq(this.table.projectRoot, projectRoot))
            .run();
        return result.changes;
    }
    /** 删除指定文件的实体（用于增量更新调用图） */
    async deleteByFile(filePath, projectRoot) {
        const result = this.drizzle
            .delete(this.table)
            .where(and(eq(this.table.filePath, filePath), eq(this.table.projectRoot, projectRoot)))
            .run();
        return result.changes;
    }
    /** 获取实体总数 */
    async getEntityCount(projectRoot) {
        const condition = projectRoot ? eq(this.table.projectRoot, projectRoot) : undefined;
        const [row] = this.drizzle.select({ cnt: count() }).from(this.table).where(condition).all();
        return row?.cnt ?? 0;
    }
    /** 按类型统计实体数 */
    async countByType(projectRoot) {
        const rows = this.drizzle
            .select({
            entityType: this.table.entityType,
            cnt: count(),
        })
            .from(this.table)
            .where(eq(this.table.projectRoot, projectRoot))
            .groupBy(this.table.entityType)
            .all();
        const result = {};
        for (const row of rows) {
            result[row.entityType] = row.cnt;
        }
        return result;
    }
    /** 按文件路径和实体类型删除 */
    async deleteByFileAndType(filePath, entityType, projectRoot) {
        const result = this.drizzle
            .delete(this.table)
            .where(and(eq(this.table.filePath, filePath), eq(this.table.entityType, entityType), eq(this.table.projectRoot, projectRoot)))
            .run();
        return result.changes;
    }
    /** 按 entityId + projectRoot 查找（不限 entityType） */
    async findByEntityIdOnly(entityId, projectRoot) {
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.entityId, entityId), eq(this.table.projectRoot, projectRoot)))
            .limit(1)
            .all();
        return rows.length > 0 ? this.#mapRow(rows[0]) : null;
    }
    /* ─── Panorama 域查询 (Phase 5e) ─── */
    /** 查询非 module 实体的 (entityId, filePath) 去重列表 */
    async findDistinctEntityIdsWithFilePath(projectRoot) {
        const rows = this.drizzle
            .selectDistinct({
            entityId: this.table.entityId,
            filePath: this.table.filePath,
        })
            .from(this.table)
            .where(and(eq(this.table.projectRoot, projectRoot), isNotNull(this.table.filePath), ne(this.table.entityType, 'module')))
            .all();
        return rows.filter((r) => r.filePath !== null);
    }
    /** 查询本地模块 (排除 external/host nodeType) */
    async findLocalModules(projectRoot) {
        const rows = this.drizzle
            .selectDistinct({
            entityId: this.table.entityId,
            name: this.table.name,
        })
            .from(this.table)
            .where(and(eq(this.table.entityType, 'module'), eq(this.table.projectRoot, projectRoot), sql `COALESCE(json_extract(${this.table.metadataJson}, '$.nodeType'), 'local') NOT IN ('external', 'host')`))
            .all();
        return rows;
    }
    /** 查询指定 nodeType 的模块实体 */
    async findModulesByNodeTypes(projectRoot, nodeTypes) {
        if (nodeTypes.length === 0) {
            return [];
        }
        const placeholders = nodeTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.entityType, 'module'), eq(this.table.projectRoot, projectRoot), sql `json_extract(${this.table.metadataJson}, '$.nodeType') IN (${sql.raw(placeholders)})`))
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 统计指定 nodeType 的模块数量 */
    async countModulesByNodeType(projectRoot, nodeType) {
        const [row] = this.drizzle
            .select({ cnt: count() })
            .from(this.table)
            .where(and(eq(this.table.entityType, 'module'), eq(this.table.projectRoot, projectRoot), sql `json_extract(${this.table.metadataJson}, '$.nodeType') = ${nodeType}`))
            .all();
        return row?.cnt ?? 0;
    }
    /** 按 projectRoot + filePaths 批量查询实体 */
    async findByProjectAndFilePaths(projectRoot, filePaths) {
        if (filePaths.length === 0) {
            return [];
        }
        const rows = this.drizzle
            .select()
            .from(this.table)
            .where(and(eq(this.table.projectRoot, projectRoot), inArray(this.table.filePath, filePaths)))
            .all();
        return rows.map((r) => this.#mapRow(r));
    }
    /** 查询非 module 实体的去重文件路径列表 */
    async findDistinctFilePaths(projectRoot, limit = 2000) {
        const rows = this.drizzle
            .selectDistinct({ filePath: this.table.filePath })
            .from(this.table)
            .where(and(eq(this.table.projectRoot, projectRoot), isNotNull(this.table.filePath), ne(this.table.entityType, 'module')))
            .limit(limit)
            .all();
        return rows.filter((r) => r.filePath !== null).map((r) => r.filePath);
    }
    /** 批量 INSERT OR IGNORE (不更新已存在的行) */
    async batchInsertIgnore(entities) {
        if (entities.length === 0) {
            return 0;
        }
        let inserted = 0;
        const now = unixNow();
        this.transaction((tx) => {
            for (const entity of entities) {
                tx.insert(this.table)
                    .values({
                    entityId: entity.entityId,
                    entityType: entity.entityType,
                    projectRoot: entity.projectRoot,
                    name: entity.name,
                    filePath: entity.filePath ?? null,
                    lineNumber: entity.lineNumber ?? null,
                    superclass: entity.superclass ?? null,
                    protocols: JSON.stringify(entity.protocols ?? []),
                    metadataJson: JSON.stringify(entity.metadata ?? {}),
                    createdAt: now,
                    updatedAt: now,
                })
                    .onConflictDoNothing()
                    .run();
                inserted++;
            }
        });
        return inserted;
    }
    /**
     * 符号名是否存在 (ReverseGuard.#symbolExists)
     */
    existsByName(name) {
        const row = this.drizzle
            .select({ name: this.table.name })
            .from(this.table)
            .where(eq(this.table.name, name))
            .limit(1)
            .get();
        return row != null;
    }
    /* ─── 内部辅助 ─── */
    #mapRow(row) {
        let protocols = [];
        let metadata = {};
        try {
            protocols = JSON.parse(row.protocols ?? '[]');
        }
        catch {
            /* ignore */
        }
        try {
            metadata = JSON.parse(row.metadataJson ?? '{}');
        }
        catch {
            /* ignore */
        }
        return {
            id: row.id,
            entityId: row.entityId,
            entityType: row.entityType,
            projectRoot: row.projectRoot,
            name: row.name,
            filePath: row.filePath,
            lineNumber: row.lineNumber,
            superclass: row.superclass,
            protocols,
            metadata,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

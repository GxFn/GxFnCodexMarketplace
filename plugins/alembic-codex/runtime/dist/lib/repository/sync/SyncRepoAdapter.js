/**
 * SyncRepoAdapter — KnowledgeSyncService 用的仓储适配器
 *
 * 将 KnowledgeSyncService 中的 raw SQL 操作封装在 lib/repository/ 层（lint 白名单目录），
 * 使 KnowledgeSyncService 本身不再需要 escape-hatch 标记。
 */
/**
 * Raw-db 适配器：实现 SyncRepo 接口
 * 使用 raw SQL 访问 knowledge_entries 和 audit_logs 表。
 */
export class RawDbSyncAdapter {
    #db;
    constructor(db) {
        this.#db = db;
    }
    createUpsertStmt(cols) {
        const updateCols = cols.filter((c) => !['id', 'createdBy', 'createdAt'].includes(c));
        const setClauses = updateCols.map((c) => `${c} = excluded.${c}`).join(',\n      ');
        const sql = `
      INSERT INTO knowledge_entries (${cols.join(', ')})
      VALUES (${cols.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET
      ${setClauses}
    `;
        return this.#db.prepare(sql);
    }
    entryExists(id) {
        const row = this.#db.prepare('SELECT 1 FROM knowledge_entries WHERE id = ?').get(id);
        return !!row;
    }
    createAuditInsertStmt() {
        try {
            return this.#db.prepare(`
        INSERT INTO audit_logs (id, timestamp, actor, actor_context, action, resource, operation_data, result, error_message, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
        }
        catch {
            return null;
        }
    }
    findActiveEntriesWithSourceFile() {
        return this.#db
            .prepare(`SELECT id, sourceFile FROM knowledge_entries
         WHERE lifecycle NOT IN ('deprecated')
         AND sourceFile IS NOT NULL`)
            .all();
    }
    deprecateEntry(id, reason, timestamp) {
        this.#db
            .prepare(`UPDATE knowledge_entries
         SET lifecycle = 'deprecated',
             rejectionReason = ?,
             updatedAt = ?
         WHERE id = ?`)
            .run(reason, timestamp, id);
    }
}

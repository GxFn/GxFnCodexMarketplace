/**
 * RepositoryBase — Drizzle-first 仓储基类
 *
 * 与旧 BaseRepository 的区别：
 * - 构造器接收 DrizzleDB 而非 raw Database
 * - 子类应使用 Drizzle 类型安全 API 实现 CRUD
 * - 保留 rawQuery() 作为复杂查询逃生舱
 * - 无 _assertSafeColumn() —— Drizzle 自带列类型约束
 */
import Logger from '../../infrastructure/logging/Logger.js';
/**
 * 新基类：以 Drizzle typed API 为主，raw SQL 为逃生舱。
 *
 * @typeParam TTable  Drizzle 表定义（如 typeof knowledgeEdges）
 * @typeParam TEntity 领域实体类型
 */
export class RepositoryBase {
    drizzle;
    table;
    logger;
    constructor(drizzle, table) {
        this.drizzle = drizzle;
        this.table = table;
        this.logger = Logger.getInstance();
    }
    /**
     * Drizzle 事务包装 — 所有 DB 变更意图应在事务内执行
     */
    transaction(fn) {
        return this.drizzle.transaction(fn);
    }
}

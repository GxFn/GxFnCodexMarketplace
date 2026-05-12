/**
 * DeliveryRepoAdapter — CursorDeliveryPipeline 用的仓储适配器
 *
 * 将 call graph 分析中的 raw SQL 查询封装在 lib/repository/ 层。
 */
/** Raw-db 适配器：实现 CallGraphRepo 接口 */
export class RawDbCallGraphAdapter {
    #db;
    constructor(db) {
        this.#db = db;
    }
    findCallEdges() {
        return this.#db
            .prepare(`SELECT from_id, to_id, metadata_json FROM knowledge_edges
         WHERE relation = 'calls' AND metadata_json LIKE '%phase5%'`)
            .all();
    }
    findMethodEntities() {
        return this.#db
            .prepare(`SELECT entity_id, file_path FROM code_entities WHERE entity_type = 'method'`)
            .all();
    }
}

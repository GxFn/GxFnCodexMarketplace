/**
 * KnowledgeGraphService - 知识图谱服务
 *
 * 管理 Recipe 之间的关系（统一模型，包含所有知识类型）
 * 支持关系查询、路径分析、PageRank 权重计算
 */
import { RelationType } from '../../domain/index.js';
import Logger from '../../infrastructure/logging/Logger.js';
// Re-export unified RelationType for backward compatibility
export { RelationType };
export class KnowledgeGraphService {
    #edgeRepo;
    logger;
    constructor(edgeRepo) {
        this.#edgeRepo = edgeRepo;
        this.logger = Logger.getInstance();
    }
    /** 添加关系边 */
    async addEdge(fromId, fromType, toId, toType, relation, metadata = {}) {
        try {
            await this.#edgeRepo.upsertEdge({
                fromId,
                fromType,
                toId,
                toType,
                relation,
                weight: metadata.weight || 1.0,
                metadata,
            });
            return { success: true };
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            this.logger.error('Failed to add edge', { fromId, toId, relation, error: errMsg });
            return { success: false, error: errMsg };
        }
    }
    /** 删除关系边 */
    async removeEdge(fromId, fromType, toId, toType, relation) {
        await this.#edgeRepo.removeEdge(fromId, fromType, toId, toType, relation);
    }
    /** 查询某个节点的所有关系 */
    async getEdges(nodeId, nodeType, direction = 'both') {
        const outgoing = direction === 'both' || direction === 'out'
            ? await this.#edgeRepo.findOutgoing(nodeId, nodeType)
            : [];
        const incoming = direction === 'both' || direction === 'in'
            ? await this.#edgeRepo.findIncoming(nodeId, nodeType)
            : [];
        return { outgoing, incoming };
    }
    /** 查询指定关系类型的连接 */
    async getRelated(nodeId, nodeType, relation) {
        return this.#edgeRepo.findByRelation(nodeId, nodeType, relation);
    }
    /** 查找两个节点之间的路径 (BFS, 最大深度 5) */
    async findPath(fromId, fromType, toId, toType, maxDepth = 5) {
        const visited = new Set();
        const queue = [
            {
                id: fromId,
                type: fromType,
                path: [],
            },
        ];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const { id, type, path } = current;
            if (path.length >= maxDepth) {
                continue;
            }
            const key = `${type}:${id}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            const neighbors = await this.#edgeRepo.findOutgoing(id, type);
            for (const neighbor of neighbors) {
                const newPath = [
                    ...path,
                    {
                        from: { id, type },
                        to: { id: neighbor.toId, type: neighbor.toType },
                        relation: neighbor.relation,
                    },
                ];
                if (neighbor.toId === toId && neighbor.toType === toType) {
                    return { found: true, path: newPath, depth: newPath.length };
                }
                queue.push({ id: neighbor.toId, type: neighbor.toType, path: newPath });
            }
        }
        return {
            found: false,
            path: [],
            depth: -1,
        };
    }
    /** 获取节点的影响范围（下游依赖分析） */
    async getImpactAnalysis(nodeId, nodeType, maxDepth = 3) {
        const impactRelations = [
            'requires',
            'extends',
            'enforces',
            'depends_on',
            'inherits',
            'implements',
            'calls',
            'prerequisite',
        ];
        const impacted = new Map();
        const queue = [{ id: nodeId, type: nodeType, depth: 0 }];
        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) {
                break;
            }
            const { id, type, depth } = current;
            if (depth >= maxDepth) {
                continue;
            }
            const dependents = await this.#edgeRepo.findIncomingByRelations(id, type, impactRelations);
            for (const dep of dependents) {
                const key = `${dep.fromType}:${dep.fromId}`;
                if (!impacted.has(key)) {
                    impacted.set(key, {
                        id: dep.fromId,
                        type: dep.fromType,
                        relation: dep.relation,
                        depth: depth + 1,
                    });
                    queue.push({ id: dep.fromId, type: dep.fromType, depth: depth + 1 });
                }
            }
        }
        return Array.from(impacted.values());
    }
    /** 获取图谱整体统计 */
    async getStats(nodeType) {
        return this.#edgeRepo.getStats(nodeType);
    }
    /**
     * 获取全量边（供 Dashboard 图谱可视化）
     * @param [limit=500] 最大返回条数
     * @param [nodeType] 过滤节点类型（如 'recipe'），为空则返回全部
     */
    async getAllEdges(limit = 500, nodeType) {
        return this.#edgeRepo.findAll({ nodeType, limit });
    }
}
let instance = null;
export function initKnowledgeGraphService(edgeRepo) {
    instance = new KnowledgeGraphService(edgeRepo);
    return instance;
}
export function getKnowledgeGraphService() {
    return instance;
}
export default KnowledgeGraphService;

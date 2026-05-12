/**
 * KnowledgeRepository — 统一知识实体仓储接口
 *
 * 替代 CandidateRepository + RecipeRepository。
 * 实现类见 lib/repository/knowledge/KnowledgeRepository.impl.js
 */
export class KnowledgeRepository {
    async create(entry) {
        throw new Error('Not implemented');
    }
    async findById(id) {
        throw new Error('Not implemented');
    }
    async findByTitle(title) {
        throw new Error('Not implemented');
    }
    async findWithPagination(filters, options) {
        throw new Error('Not implemented');
    }
    async findByLifecycle(lifecycle, pagination) {
        throw new Error('Not implemented');
    }
    async findByKind(kind, options) {
        throw new Error('Not implemented');
    }
    async findActiveRules() {
        throw new Error('Not implemented');
    }
    async findByLanguage(language, pagination) {
        throw new Error('Not implemented');
    }
    async findByCategory(category, pagination) {
        throw new Error('Not implemented');
    }
    async search(keyword, pagination) {
        throw new Error('Not implemented');
    }
    async update(id, updates) {
        throw new Error('Not implemented');
    }
    async delete(id) {
        throw new Error('Not implemented');
    }
    async findByRelationLike(nodeId, excludeId) {
        throw new Error('Not implemented');
    }
    async getStats() {
        throw new Error('Not implemented');
    }
}
export default KnowledgeRepository;

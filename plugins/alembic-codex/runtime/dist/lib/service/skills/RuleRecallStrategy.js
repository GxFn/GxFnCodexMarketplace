/**
 * RuleRecallStrategy — 将 SkillAdvisor 包装为 RecallStrategy 接口
 *
 * 零 AI 依赖、零延迟，作为离线 fallback 和基础召回来源。
 * 复用 SkillAdvisor 的 4 维分析（Guard 违规、Memory 偏好、Recipe 分布、候选积压），
 * 将 SkillSuggestion 转换为标准 RecommendationCandidate。
 */
import { SkillAdvisor } from './SkillAdvisor.js';
export class RuleRecallStrategy {
    name = 'rule';
    type = 'rule';
    async recall(context) {
        const ct = context.container;
        const knowledgeRepo = (ct?.get?.('knowledgeRepository') ||
            null);
        const auditRepo = (ct?.get?.('auditRepository') || null);
        const advisor = new SkillAdvisor(context.projectRoot, {
            knowledgeRepo,
            auditRepo,
            dataRoot: context.dataRoot,
        });
        const result = await advisor.suggest();
        // 过滤已有 Skill
        const existingSet = context.existingSkills ?? new Set();
        return result.suggestions
            .filter((s) => !existingSet.has(s.name))
            .map((s) => ({
            name: s.name,
            description: s.description,
            rationale: s.rationale,
            source: `rule:${s.source}`,
            priority: s.priority,
            signals: s.signals,
        }));
    }
    isAvailable(_context) {
        // 规则召回始终可用
        return true;
    }
}
export default RuleRecallStrategy;

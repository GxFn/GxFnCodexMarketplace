export class EnhancementPack {
    /** 增强包 ID */
    get id() {
        throw new Error('Not implemented');
    }
    /** 适用条件 */
    get conditions() {
        throw new Error('Not implemented');
    }
    /** 人类可读名称 */
    get displayName() {
        return this.id;
    }
    /**
     * 额外的 Bootstrap 维度定义
     *
     * 维度对象支持以下字段:
     *   - id {string}            — 维度 ID（TierScheduler 使用）
     *   - label {string}         — 人类可读标签
     *   - guide {string}         — AI Agent 分析指引
     *   - tierHint {number}      — 首选 Tier（1/2/3）；未声明时默认 Tier 1
     *   - knowledgeTypes {string[]} — 产出的知识类型
     *   - skillWorthy {boolean}  — 是否生成 Skill
     *   - dualOutput {boolean}   — 是否同时产出 Skill + Candidate
     *   - skillMeta {object}     — Skill 元数据（name, description）
     */
    getExtraDimensions() {
        return [];
    }
    /** 额外的 Guard 规则 */
    getGuardRules() {
        return [];
    }
    /**
     * 额外的设计模式检测
     * @param astSummary analyzeFile/analyzeProject 的返回值
     * @returns >}
     */
    detectPatterns(astSummary) {
        return [];
    }
    /**
     * SFC 预处理器 — 将非标准文件转换为可解析的脚本内容
     * @param content 原始文件内容
     * @param ext 文件扩展名 (含 .)
     * @returns | null}
     */
    preprocessFile(content, ext) {
        return null;
    }
    /** Reference Skill 路径（Bootstrap 时自动加载，相对于 skills/ 目录） */
    getReferenceSkillPath() {
        return null;
    }
}

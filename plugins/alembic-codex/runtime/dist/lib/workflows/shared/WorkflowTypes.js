/**
 * WorkflowTypes — 冷启动 & 增量扫描管线共享类型和工具函数
 *
 * 消除 ColdStartIntent / KnowledgeRescanIntent / InternalColdStartWorkflow /
 * InternalKnowledgeRescanWorkflow 等文件中的重复定义。
 *
 * @module workflows/shared/WorkflowTypes
 */
// ── Intent 参数规范化 ──
export function normalizeDimensionIds(dimensions) {
    const values = normalizeStringArray(dimensions);
    return values && values.length > 0 ? values : undefined;
}
export function normalizeStringArray(values) {
    if (!Array.isArray(values)) {
        return undefined;
    }
    return values
        .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
        .map((value) => value.trim())
        .filter(Boolean);
}

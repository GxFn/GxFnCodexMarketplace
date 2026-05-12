/**
 * §11.3 H3: MemoryFlushContract — 层级数据流转规约
 *
 * 定义 completeDimension() 保存数据的显式检查表,
 * 确保 distill() 的结果在 ActiveContext.clear() 之前完整提取。
 */
/** 从 DistilledContext 提取高优先级 findings (importance >= threshold) */
export function extractHighPriorityFindings(distilled, threshold = 7) {
    return distilled.keyFindings
        .filter((f) => f.importance >= threshold)
        .map((f) => ({
        finding: f.finding,
        evidence: f.evidence,
        importance: f.importance,
    }));
}

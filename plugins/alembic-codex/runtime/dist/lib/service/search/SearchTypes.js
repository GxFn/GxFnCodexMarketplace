/**
 * SearchTypes — SearchEngine 共享类型定义
 *
 * 从 SearchEngine.ts 提取的所有接口和类型，
 * 供 SearchEngine、FieldWeightedScorer、BM25Scorer 及测试文件独立消费。
 *
 * @module SearchTypes
 */
/**
 * 统一投影函数 — 将 SearchResultItem 投影为 SlimSearchResult。
 *
 * 合并了 mcp/search.ts#_slimSearchItem() 和 TaskKnowledgeBridge#_projectItem() 的逻辑：
 * - 去除内部信号 (recallScore, coarseScore, rankerScore, contextScore, content, code...)
 * - description 截断 120 字符
 * - 生成 actionHint (whenClause → doClause)
 *
 * @param item 搜索结果项（来自 SearchEngine）
 * @returns 瘦身后的结果项
 */
export function slimSearchResult(item) {
    const doText = item.doClause || '';
    const whenText = item.whenClause || '';
    const actionHint = doText || whenText
        ? `${whenText ? `${whenText} → ` : ''}${doText}`.replace(/ → $/, '')
        : undefined;
    const rawRefs = item.sourceRefs;
    const sourceRefs = Array.isArray(rawRefs) && rawRefs.length > 0
        ? rawRefs.filter((s) => typeof s === 'string' && s.length > 0)
        : undefined;
    return {
        id: item.id,
        title: item.title || '',
        trigger: item.trigger || '',
        kind: item.kind || 'pattern',
        language: item.language || '',
        score: Math.round((item.score || 0) * 1000) / 1000,
        description: (item.description || '').slice(0, 120),
        actionHint,
        knowledgeType: item.knowledgeType || undefined,
        sourceRefs,
    };
}
/** items → byKind 分组（统一实现） */
export function groupByKind(items) {
    const byKind = { rule: [], pattern: [], fact: [] };
    for (const it of items) {
        const kind = it.kind || 'pattern';
        const bucket = byKind[kind] || byKind.pattern;
        bucket.push(it);
    }
    return byKind;
}

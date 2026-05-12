/**
 * SessionStore 序列化校验
 *
 * `SessionStore.fromJSON()` 的反序列化入口，对边界数据做轻量类型校验。
 *
 * @module agent/memory/session-store-schema
 */
// ── Helpers ──────────────────────────────────────────────────
function isRecord(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
}
// ── Public API ───────────────────────────────────────────────
/**
 * 校验反序列化数据的关键字段类型，返回类型安全的结构。
 */
export function validateSessionStoreShape(raw) {
    if (raw.dimensionReports !== undefined && !isRecord(raw.dimensionReports)) {
        throw new Error('SessionStore schema: dimensionReports must be a Record');
    }
    if (raw.crossReferences !== undefined && !Array.isArray(raw.crossReferences)) {
        throw new Error('SessionStore schema: crossReferences must be an array');
    }
    if (raw.tierReflections !== undefined && !Array.isArray(raw.tierReflections)) {
        throw new Error('SessionStore schema: tierReflections must be an array');
    }
    if (raw.submittedCandidates !== undefined && !isRecord(raw.submittedCandidates)) {
        throw new Error('SessionStore schema: submittedCandidates must be a Record');
    }
    return {
        dimensionReports: raw.dimensionReports ?? {},
        crossReferences: raw.crossReferences ?? [],
        tierReflections: raw.tierReflections ?? [],
        submittedCandidates: raw.submittedCandidates ?? {},
        projectContext: isRecord(raw.projectContext)
            ? raw.projectContext
            : {},
        workingMemory: isRecord(raw.workingMemory)
            ? raw.workingMemory
            : undefined,
    };
}

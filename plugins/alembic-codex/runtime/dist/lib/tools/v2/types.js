/**
 * @module tools/v2/types
 *
 * V2 工具系统核心类型定义 — 所有 handler、router、capability 的类型基础。
 */
/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
/** 快速构建成功结果 */
export function ok(data, meta) {
    return {
        ok: true,
        data,
        _meta: {
            cached: false,
            tokensEstimate: 0,
            durationMs: 0,
            ...meta,
        },
    };
}
/** 快速构建失败结果 */
export function fail(error) {
    return { ok: false, data: null, error };
}
/** 简易 token 估算（1 token ≈ 4 chars） */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

/**
 * envelope — MCP 响应标准化包装
 * 所有 MCP 工具返回的 content 均使用此格式
 */
export function envelope({ success, data = null, message = '', meta = {}, errorCode = null, }) {
    const respTime = typeof meta.responseTimeMs === 'number' ? meta.responseTimeMs : undefined;
    const tool = typeof meta.tool === 'string' ? meta.tool : undefined;
    const source = typeof meta.source === 'string' ? meta.source : undefined;
    const version = typeof meta.version === 'string' ? meta.version : '2.0.0';
    return {
        success: Boolean(success),
        errorCode: errorCode || null,
        message: message || '',
        data,
        meta: {
            ...(tool ? { tool } : {}),
            version,
            ...(respTime != null ? { responseTimeMs: respTime } : {}),
            ...(source ? { source } : {}),
        },
    };
}
export default envelope;

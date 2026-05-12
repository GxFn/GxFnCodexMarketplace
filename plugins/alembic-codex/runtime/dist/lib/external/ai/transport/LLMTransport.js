/**
 * LLMTransport — 纯协议转换层抽象
 *
 * Transport 只负责：
 *   1. 将统一的 TransportRequest 转换为厂商 API 的 HTTP 请求体
 *   2. 发送 HTTP 请求（含认证、超时、重试后中止）
 *   3. 将厂商 API 响应解析为统一的 TransportResponse
 *
 * Transport 不负责：
 *   - 参数校验/过滤 → ParameterGuard (Gateway 层)
 *   - 模型能力查询 → ModelRegistry (Gateway 层)
 *   - 业务逻辑 (上下文窗口管理、工具路由等) → AgentRuntime
 */
// ─── Abstract Transport ─────────────────────────────────
export class LLMTransport {
    providerId;
    apiKey;
    baseUrl;
    timeout;
    constructor(providerId, config) {
        this.providerId = providerId;
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || '';
        this.timeout = config.timeout ?? 120_000;
    }
    /** embed 能力，不支持的 Transport 返回空数组 */
    async embed(_texts) {
        return [];
    }
    /** 带 JSON 格式约束的 chat */
    async chatStructured(request) {
        const text = await this.chat({ ...request, responseFormat: 'json' });
        if (!text) {
            return null;
        }
        try {
            return JSON.parse(text);
        }
        catch {
            return null;
        }
    }
    // ─── Shared HTTP utilities ──────────────────────────────
    async post(url, body, headers, externalSignal) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        const onExternalAbort = () => controller.abort();
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                let detail = '';
                try {
                    const errBody = await res.text();
                    const parsed = JSON.parse(errBody);
                    detail = parsed?.error?.message || errBody.slice(0, 300);
                }
                catch {
                    /* best effort */
                }
                const err = Object.assign(new Error(`${this.providerId} API error: ${res.status}${detail ? ` — ${detail}` : ''}`), { status: res.status });
                throw err;
            }
            return (await res.json());
        }
        finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener('abort', onExternalAbort);
        }
    }
    requireApiKey(label) {
        if (!this.apiKey) {
            const err = Object.assign(new Error(`${label} API Key 未配置`), { code: 'API_KEY_MISSING' });
            throw err;
        }
    }
}

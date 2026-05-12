/**
 * LLMGateway — 统一 LLM 调用网关
 *
 * 职责链: resolve model → guard params → delegate to transport → normalize response
 *
 * 消费方只需:
 *   gateway.chatWithTools({ modelRef: 'deepseek:deepseek-v4-flash', ... })
 *
 * Gateway 内部自动完成:
 *   1. ModelRegistry.resolveOrCreate() → ModelDef
 *   2. ParameterGuard.guard() → 安全参数
 *   3. Transport.chatWithTools() → 厂商 API 调用
 *   4. 响应归一化 → ChatWithToolsResult
 */
import Logger from '#infra/logging/Logger.js';
import { ParameterGuard } from '../guard/ParameterGuard.js';
import { getModelRegistry } from '../registry/ModelRegistry.js';
import { ClaudeTransport } from '../transport/ClaudeTransport.js';
import { DeepSeekTransport } from '../transport/DeepSeekTransport.js';
import { GoogleTransport } from '../transport/GoogleTransport.js';
import { OpenAiTransport } from '../transport/OpenAiTransport.js';
const logger = Logger.getInstance();
// ─── LLMGateway ─────────────────────────────────────────
export class LLMGateway {
    #transports = new Map();
    #config;
    constructor(config = {}) {
        this.#config = config;
    }
    /**
     * 统一工具调用入口
     *
     * Gateway 自动完成: modelRef 解析 → ParameterGuard → Transport → 响应归一化
     */
    async chatWithTools(request) {
        const { modelDef, providerId, apiModelId } = this.#resolveModel(request.modelRef);
        const guarded = ParameterGuard.guard(modelDef, {
            temperature: request.temperature,
            maxTokens: request.maxTokens,
            toolChoice: request.toolChoice,
            reasoningEffort: request.reasoningEffort,
        });
        if (guarded.filtered.length > 0) {
            logger.debug(`[LLMGateway] ${modelDef.displayName} filtered params: ${guarded.filtered.map((f) => `${f.param}(${f.reason})`).join(', ')}`);
        }
        const transport = this.#getTransport(providerId);
        const wasFiltered = (param) => guarded.filtered.some((f) => f.param === param);
        const transportReq = {
            model: apiModelId,
            messages: request.messages,
            systemPrompt: request.systemPrompt,
            tools: request.tools,
            toolChoice: wasFiltered('toolChoice')
                ? undefined
                : (guarded.toolChoice ?? request.toolChoice),
            temperature: wasFiltered('temperature')
                ? undefined
                : (guarded.temperature ?? request.temperature),
            maxTokens: guarded.maxTokens ?? request.maxTokens,
            reasoningEffort: wasFiltered('reasoningEffort')
                ? undefined
                : (guarded.reasoningEffort ?? request.reasoningEffort),
            abortSignal: request.abortSignal,
        };
        const response = await transport.chatWithTools(transportReq);
        return this.#normalizeResponse(response);
    }
    /**
     * 简单 chat — 单轮对话，不含工具
     */
    async chat(request) {
        const { modelDef, providerId, apiModelId } = this.#resolveModel(request.modelRef);
        const guarded = ParameterGuard.guard(modelDef, {
            temperature: request.temperature,
            maxTokens: request.maxTokens,
        });
        const transport = this.#getTransport(providerId);
        const wasFiltered = (param) => guarded.filtered.some((f) => f.param === param);
        return transport.chat({
            model: apiModelId,
            messages: [{ role: 'user', content: request.prompt }],
            systemPrompt: request.systemPrompt,
            temperature: wasFiltered('temperature')
                ? undefined
                : (guarded.temperature ?? request.temperature),
            maxTokens: guarded.maxTokens ?? request.maxTokens,
            responseFormat: request.responseFormat,
            abortSignal: request.abortSignal,
        });
    }
    /**
     * Structured JSON output
     */
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
    /**
     * Embedding
     */
    async embed(modelRef, texts) {
        const { providerId } = this.#resolveModel(modelRef);
        const transport = this.#getTransport(providerId);
        return transport.embed(texts);
    }
    /**
     * 获取模型定义（供外部查询能力）
     */
    getModelDef(modelRef) {
        return this.#resolveModel(modelRef).modelDef;
    }
    // ─── Model Resolution ─────────────────────────────────
    #resolveModel(modelRef) {
        const registry = getModelRegistry();
        if (modelRef.includes(':')) {
            const [provider, model] = modelRef.split(':', 2);
            const modelDef = registry.resolveOrCreate(provider, model);
            return {
                modelDef,
                providerId: modelDef.provider,
                apiModelId: modelDef.apiModelId,
            };
        }
        const modelDef = registry.get(modelRef);
        if (modelDef) {
            return {
                modelDef,
                providerId: modelDef.provider,
                apiModelId: modelDef.apiModelId,
            };
        }
        const guessed = this.#guessProvider(modelRef);
        const resolved = registry.resolveOrCreate(guessed, modelRef);
        return {
            modelDef: resolved,
            providerId: resolved.provider,
            apiModelId: resolved.apiModelId,
        };
    }
    #guessProvider(model) {
        if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) {
            return 'openai';
        }
        if (model.startsWith('claude-')) {
            return 'claude';
        }
        if (model.startsWith('deepseek-')) {
            return 'deepseek';
        }
        if (model.startsWith('gemini-')) {
            return 'google';
        }
        return 'openai';
    }
    // ─── Transport Lifecycle ──────────────────────────────
    #getTransport(providerId) {
        let transport = this.#transports.get(providerId);
        if (transport) {
            return transport;
        }
        const config = this.#resolveTransportConfig(providerId);
        transport = this.#createTransport(providerId, config);
        this.#transports.set(providerId, transport);
        return transport;
    }
    #createTransport(providerId, config) {
        switch (providerId) {
            case 'openai':
                return new OpenAiTransport(config);
            case 'claude':
                return new ClaudeTransport(config);
            case 'deepseek':
                return new DeepSeekTransport(config);
            case 'google':
                return new GoogleTransport(config);
            case 'ollama':
                return new OpenAiTransport({
                    ...config,
                    apiKey: config.apiKey || 'ollama',
                    baseUrl: config.baseUrl || 'http://127.0.0.1:11434/v1',
                });
            default:
                logger.warn(`[LLMGateway] Unknown provider '${providerId}', falling back to OpenAI transport`);
                return new OpenAiTransport(config);
        }
    }
    #resolveTransportConfig(providerId) {
        const explicit = this.#config.providers?.[providerId];
        if (explicit?.apiKey) {
            return explicit;
        }
        const envMap = {
            openai: { key: 'ALEMBIC_OPENAI_API_KEY', base: 'ALEMBIC_OPENAI_BASE_URL' },
            claude: { key: 'ALEMBIC_CLAUDE_API_KEY', base: 'ALEMBIC_CLAUDE_BASE_URL' },
            deepseek: { key: 'ALEMBIC_DEEPSEEK_API_KEY', base: 'ALEMBIC_DEEPSEEK_BASE_URL' },
            google: { key: 'ALEMBIC_GOOGLE_API_KEY', base: 'ALEMBIC_GOOGLE_BASE_URL' },
            ollama: { key: '', base: 'ALEMBIC_OLLAMA_BASE_URL' },
        };
        const env = envMap[providerId] || { key: '' };
        const { apiKey: _discardedKey, ...explicitRest } = explicit || {};
        return {
            ...explicitRest,
            apiKey: (env.key ? process.env[env.key] : undefined) || '',
            baseUrl: (env.base ? process.env[env.base] : undefined) || explicit?.baseUrl,
            timeout: this.#config.timeout || explicit?.timeout,
        };
    }
    // ─── Response Normalization ───────────────────────────
    #normalizeResponse(response) {
        const functionCalls = response.functionCalls
            ? response.functionCalls.map((fc) => ({
                id: fc.id,
                name: fc.name,
                args: fc.args,
                thoughtSignature: fc.thoughtSignature,
            }))
            : null;
        const usage = response.usage;
        return {
            text: response.text,
            functionCalls,
            usage,
            reasoningContent: response.reasoningContent ?? undefined,
        };
    }
}
// ─── Singleton ──────────────────────────────────────────
let _gateway = null;
export function getLLMGateway(config) {
    if (!_gateway) {
        _gateway = new LLMGateway(config);
    }
    return _gateway;
}
export function resetLLMGateway() {
    _gateway = null;
}

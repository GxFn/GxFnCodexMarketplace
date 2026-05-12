/**
 * GoogleTransport — Google Gemini REST API 协议转换
 *
 * Gemini 特有差异：
 *   - contents 格式 (role: user/model, parts 数组)
 *   - functionDeclarations 工具声明
 *   - toolConfig.functionCallingConfig.mode: AUTO/ANY/NONE
 *   - API key 通过 URL query 传递
 *   - JSON Schema 需清理 (不支持 default/examples)
 *   - thoughtSignature 必须原样回传 (Gemini 3+)
 */
import { LLMTransport, } from './LLMTransport.js';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_EMBED_MODEL = 'models/gemini-embedding-001';
export class GoogleTransport extends LLMTransport {
    #embedModel;
    constructor(config) {
        super('google', { ...config, baseUrl: config.baseUrl || GEMINI_BASE });
        this.#embedModel = config.embedModel
            ? `models/${config.embedModel.replace(/^models\//, '')}`
            : DEFAULT_EMBED_MODEL;
    }
    async chat(request) {
        this.requireApiKey('Google Gemini');
        const contents = this.#buildContents(request.messages);
        const body = {
            contents,
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.maxTokens,
            },
        };
        if (request.systemPrompt) {
            body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
        }
        if (request.responseFormat === 'json') {
            body.generationConfig.responseMimeType = 'application/json';
        }
        const url = `${this.baseUrl}/models/${request.model}:generateContent?key=${this.apiKey}`;
        const data = await this.post(url, body, {}, request.abortSignal);
        const candidates = data?.candidates || [];
        const parts = candidates[0]?.content?.parts;
        return parts?.[0]?.text || '';
    }
    async chatWithTools(request) {
        this.requireApiKey('Google Gemini');
        const contents = this.#buildContents(request.messages);
        const body = {
            contents,
            generationConfig: {
                temperature: request.temperature,
                maxOutputTokens: request.maxTokens,
            },
        };
        if (request.tools && request.tools.length > 0) {
            body.tools = [
                {
                    functionDeclarations: request.tools.map((s) => ({
                        name: s.name,
                        description: s.description || '',
                        parameters: this.#sanitizeSchema(s.parameters),
                    })),
                },
            ];
            body.toolConfig = {
                functionCallingConfig: {
                    mode: this.#toGeminiMode(request.toolChoice || 'auto'),
                },
            };
        }
        if (request.systemPrompt) {
            body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
        }
        const url = `${this.baseUrl}/models/${request.model}:generateContent?key=${this.apiKey}`;
        const data = await this.post(url, body, {}, request.abortSignal);
        return this.#parseResponse(data);
    }
    async embed(texts) {
        this.requireApiKey('Google Gemini');
        const results = [];
        for (let i = 0; i < texts.length; i += 100) {
            const batch = texts.slice(i, i + 100);
            const requests = batch.map((t) => ({
                model: this.#embedModel,
                content: { parts: [{ text: t.slice(0, 8000) }] },
            }));
            const url = `${this.baseUrl}/${this.#embedModel}:batchEmbedContents?key=${this.apiKey}`;
            const data = await this.post(url, { requests }, {});
            const embeddings = (data?.embeddings || []);
            results.push(...embeddings.map((e) => e.values));
        }
        return results;
    }
    // ─── 消息转换 ──────────────────────────────────────
    #buildContents(messages) {
        const contents = [];
        let pendingToolResults = [];
        const pushOrMerge = (entry) => {
            const last = contents[contents.length - 1];
            if (last && last.role === entry.role) {
                last.parts.push(...entry.parts);
            }
            else {
                contents.push(entry);
            }
        };
        for (const msg of messages) {
            if (msg.role === 'tool') {
                pendingToolResults.push({
                    functionResponse: {
                        name: msg.name || '',
                        response: { result: msg.content || '' },
                    },
                });
                continue;
            }
            if (pendingToolResults.length > 0) {
                pushOrMerge({ role: 'user', parts: pendingToolResults });
                pendingToolResults = [];
            }
            if (msg.role === 'user') {
                pushOrMerge({ role: 'user', parts: [{ text: msg.content || '' }] });
            }
            else if (msg.role === 'assistant') {
                const parts = [];
                if (msg.content) {
                    parts.push({ text: msg.content });
                }
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    for (const tc of msg.toolCalls) {
                        const fcPart = {
                            functionCall: { name: tc.name, args: tc.args || {} },
                        };
                        if (tc.thoughtSignature) {
                            fcPart.thoughtSignature = tc.thoughtSignature;
                        }
                        parts.push(fcPart);
                    }
                }
                if (parts.length > 0) {
                    pushOrMerge({ role: 'model', parts });
                }
            }
        }
        if (pendingToolResults.length > 0) {
            pushOrMerge({ role: 'user', parts: pendingToolResults });
        }
        return contents;
    }
    #toGeminiMode(toolChoice) {
        switch (toolChoice) {
            case 'required':
                return 'ANY';
            case 'none':
                return 'NONE';
            default:
                return 'AUTO';
        }
    }
    // ─── 响应解析 ──────────────────────────────────────
    #parseResponse(data) {
        const candidates = data?.candidates || [];
        const content = candidates[0]?.content;
        const meta = data?.usageMetadata;
        const usage = meta
            ? {
                inputTokens: meta.promptTokenCount || 0,
                outputTokens: meta.candidatesTokenCount || 0,
                totalTokens: meta.totalTokenCount || 0,
            }
            : null;
        const parts = (content?.parts || []);
        if (parts.length === 0) {
            return { text: '', functionCalls: null, usage };
        }
        const functionCalls = [];
        const textParts = [];
        let fcIndex = 0;
        for (const part of parts) {
            if (part.functionCall) {
                const fc = part.functionCall;
                functionCalls.push({
                    id: `gemini_fc_${Date.now()}_${fcIndex++}`,
                    name: fc.name,
                    args: fc.args || {},
                    thoughtSignature: part.thoughtSignature || undefined,
                });
            }
            else if (part.text) {
                textParts.push(part.text);
            }
        }
        return {
            text: textParts.length > 0 ? textParts.join('\n') : null,
            functionCalls: functionCalls.length > 0 ? functionCalls : null,
            usage,
        };
    }
    #sanitizeSchema(schema) {
        if (!schema || typeof schema !== 'object') {
            return { type: 'object', properties: {} };
        }
        const cleaned = { ...schema };
        delete cleaned.default;
        delete cleaned.examples;
        if (!cleaned.type) {
            cleaned.type = 'object';
        }
        if (cleaned.properties) {
            const props = {};
            for (const [key, val] of Object.entries(cleaned.properties)) {
                props[key] = this.#sanitizeSchema(val);
            }
            cleaned.properties = props;
        }
        if (cleaned.type === 'array') {
            cleaned.items = cleaned.items ? this.#sanitizeSchema(cleaned.items) : { type: 'string' };
        }
        return cleaned;
    }
}

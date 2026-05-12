/**
 * ClaudeTransport — Anthropic Messages API 协议转换
 *
 * 处理 Anthropic 特有的协议差异：
 *   - system prompt 是顶层字段（非 message）
 *   - assistant content 是 block 数组 (text / tool_use)
 *   - 工具结果通过 user 消息中的 tool_result blocks 传递
 *   - tool_choice: {type: 'auto'|'any'|'tool'}（无 'none'，不传 tools 即可）
 *   - 消息必须严格交替 user/assistant
 */
import { LLMTransport, } from './LLMTransport.js';
const CLAUDE_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
export class ClaudeTransport extends LLMTransport {
    constructor(config) {
        super('claude', { ...config, baseUrl: config.baseUrl || CLAUDE_BASE });
    }
    async chat(request) {
        this.requireApiKey('Claude');
        const messages = this.#convertMessages(request.messages);
        const body = {
            model: request.model,
            messages,
            max_tokens: request.maxTokens || 4096,
        };
        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }
        if (request.systemPrompt) {
            body.system = request.systemPrompt;
        }
        const data = await this.post(`${this.baseUrl}/messages`, body, this.#headers(), request.abortSignal);
        const content = (data?.content || []);
        const textBlock = content.find((c) => c.type === 'text');
        return textBlock?.text || '';
    }
    async chatWithTools(request) {
        this.requireApiKey('Claude');
        const messages = this.#convertMessages(request.messages);
        const body = {
            model: request.model,
            messages,
            max_tokens: request.maxTokens || 4096,
        };
        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }
        if (request.systemPrompt) {
            body.system = request.systemPrompt;
        }
        const effectiveToolChoice = request.toolChoice || 'auto';
        if (effectiveToolChoice !== 'none' && request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((s) => ({
                name: s.name,
                description: s.description || '',
                input_schema: s.parameters || { type: 'object', properties: {} },
            }));
            body.tool_choice = effectiveToolChoice === 'required' ? { type: 'any' } : { type: 'auto' };
        }
        const data = await this.post(`${this.baseUrl}/messages`, body, this.#headers(), request.abortSignal);
        return this.#parseResponse(data);
    }
    // ─── 消息转换 ──────────────────────────────────────
    #convertMessages(messages) {
        const result = [];
        const pushOrMerge = (entry) => {
            const last = result[result.length - 1];
            if (last && last.role === entry.role) {
                const lastContent = Array.isArray(last.content)
                    ? last.content
                    : [{ type: 'text', text: last.content || '' }];
                const newContent = Array.isArray(entry.content)
                    ? entry.content
                    : [{ type: 'text', text: entry.content || '' }];
                last.content = [...lastContent, ...newContent];
            }
            else {
                result.push(entry);
            }
        };
        let i = 0;
        while (i < messages.length) {
            const msg = messages[i];
            if (msg.role === 'user') {
                pushOrMerge({ role: 'user', content: msg.content || '' });
                i++;
            }
            else if (msg.role === 'assistant') {
                const content = [];
                if (msg.content) {
                    content.push({ type: 'text', text: msg.content });
                }
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    for (const tc of msg.toolCalls) {
                        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
                    }
                }
                pushOrMerge({
                    role: 'assistant',
                    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
                });
                i++;
            }
            else if (msg.role === 'tool') {
                const toolResults = [];
                while (i < messages.length && messages[i].role === 'tool') {
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: messages[i].toolCallId || '',
                        content: messages[i].content || '',
                    });
                    i++;
                }
                pushOrMerge({ role: 'user', content: toolResults });
            }
            else {
                i++;
            }
        }
        return result;
    }
    // ─── 响应解析 ──────────────────────────────────────
    #parseResponse(data) {
        const rawUsage = data?.usage;
        const usage = rawUsage
            ? {
                inputTokens: rawUsage.input_tokens || 0,
                outputTokens: rawUsage.output_tokens || 0,
                totalTokens: (rawUsage.input_tokens || 0) + (rawUsage.output_tokens || 0),
            }
            : null;
        const content = (data?.content || []);
        if (content.length === 0) {
            return { text: '', functionCalls: null, usage };
        }
        const functionCalls = [];
        const textParts = [];
        for (const block of content) {
            if (block.type === 'tool_use') {
                functionCalls.push({
                    id: block.id,
                    name: block.name,
                    args: block.input || {},
                });
            }
            else if (block.type === 'text') {
                textParts.push(block.text);
            }
        }
        return {
            text: textParts.length > 0 ? textParts.join('\n') : null,
            functionCalls: functionCalls.length > 0 ? functionCalls : null,
            usage,
        };
    }
    #headers() {
        return {
            'x-api-key': this.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
        };
    }
}

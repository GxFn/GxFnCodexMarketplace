/**
 * ContextualEnricher — 上下文增强管线
 *
 * 基于 Anthropic Contextual Retrieval 论文 (2024-09) 的实现。
 * 对每个 chunk 生成 50-100 token 的上下文前缀，使其嵌入时保留文档层面的语义。
 *
 * 效果: retrieval failure rate 降低 35-67% (with reranking)
 *
 * 成本控制:
 *   - 使用轻量模型 (Haiku/Gemini Flash)
 *   - Prompt Caching: 同一文档不同 chunk 共享 system prompt 缓存
 *   - 增量模式: 只对新增/变更 chunk 做 enrichment
 *   - 配置开关: contextualEnrich = false 时完全跳过
 *
 * @module service/vector/ContextualEnricher
 */
import Logger from '../../infrastructure/logging/Logger.js';
// ── Enricher ──
export class ContextualEnricher {
    #aiProvider;
    #cache;
    #cacheEnabled;
    #logger = Logger.getInstance();
    constructor(config) {
        this.#aiProvider = config.aiProvider;
        this.#cacheEnabled = config.cacheEnabled !== false;
        this.#cache = new Map();
    }
    /**
     * 为多个 chunks 生成上下文前缀
     *
     * 策略: 将整篇文档作为 system prompt，逐 chunk 请求上下文描述。
     * 利用 Prompt Caching: 文档只需编码一次，后续 chunk 查询只需增量 tokens。
     *
     * @param document - 文档整体信息
     * @param chunks   - 分块后的内容数组
     * @returns 带上下文前缀的 chunks
     */
    async enrichChunks(document, chunks) {
        if (chunks.length === 0) {
            return [];
        }
        // Mock 模式下跳过 AI enrichment，直接返回原始 chunks
        if (this.#aiProvider.name === 'mock') {
            return chunks;
        }
        const systemPrompt = this.#buildSystemPrompt(document);
        const enriched = [];
        for (const chunk of chunks) {
            try {
                // 检查缓存
                const cacheKey = this.#cacheEnabled
                    ? this.#computeCacheKey(document.sourcePath || document.title, chunk.content)
                    : '';
                let context;
                if (this.#cacheEnabled && this.#cache.has(cacheKey)) {
                    context = this.#cache.get(cacheKey);
                }
                else {
                    context = await this.#generateContext(systemPrompt, chunk.content);
                    if (this.#cacheEnabled && context) {
                        this.#cache.set(cacheKey, context);
                    }
                }
                if (context) {
                    enriched.push({
                        content: `[${context.trim()}]\n\n${chunk.content}`,
                        metadata: {
                            ...chunk.metadata,
                            contextEnriched: true,
                            contextLength: context.length,
                        },
                    });
                }
                else {
                    enriched.push(chunk);
                }
            }
            catch (err) {
                // 单个 chunk enrichment 失败不阻塞整个流程
                this.#logger.warn('[ContextualEnricher] Failed to enrich chunk', {
                    error: err instanceof Error ? err.message : String(err),
                });
                enriched.push(chunk);
            }
        }
        return enriched;
    }
    /** 清除缓存 */
    clearCache() {
        this.#cache.clear();
    }
    /** 当前缓存大小 */
    get cacheSize() {
        return this.#cache.size;
    }
    // ═══ Private ═══
    #buildSystemPrompt(document) {
        // 截断过长文档（避免超出模型 context window）
        const maxDocLen = 8000;
        const docContent = document.content.length > maxDocLen
            ? `${document.content.slice(0, maxDocLen)}\n\n[... document truncated ...]`
            : document.content;
        return [
            `<document title="${this.#escapeXml(document.title)}" kind="${document.kind}">`,
            docContent,
            '</document>',
            '',
            'Given the above document, provide 1-2 sentences of context that situate the following chunk within the document.',
            'Focus on: what topic/function/section this chunk belongs to, and any key entities or concepts referenced.',
            'Answer ONLY with the context sentences, nothing else.',
        ].join('\n');
    }
    async #generateContext(systemPrompt, chunkContent) {
        const userPrompt = `<chunk>\n${chunkContent}\n</chunk>`;
        const response = await this.#aiProvider.chat(userPrompt, {
            system: systemPrompt,
            maxTokens: 120,
            temperature: 0,
        });
        // 清理响应 — 移除可能的 XML tag 或多余引号
        let cleaned = response.trim();
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
        }
        // 限制长度
        if (cleaned.length > 500) {
            cleaned = cleaned.slice(0, 500);
        }
        return cleaned;
    }
    #computeCacheKey(sourcePath, content) {
        // 简单的字符串 hash（不需要加密级别）
        let hash = 0;
        const str = `${sourcePath}::${content.slice(0, 200)}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash + char) | 0;
        }
        return `ctx_${hash.toString(36)}`;
    }
    #escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}

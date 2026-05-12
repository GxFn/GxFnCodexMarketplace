/**
 * @module tools/v2/cache/SearchCache
 *
 * 搜索结果 LRU 缓存。避免同一会话中重复搜索相同 pattern。
 */
export class SearchCache {
    #cache = new Map();
    #maxEntries;
    constructor(maxEntries = 100) {
        this.#maxEntries = maxEntries;
    }
    /** 生成缓存 key: pattern + glob + regex flag 组合 */
    static makeKey(pattern, glob, regex) {
        return `${pattern}|${glob ?? ''}|${regex ? 'r' : 'l'}`;
    }
    get(key) {
        const entry = this.#cache.get(key);
        if (!entry) {
            return undefined;
        }
        this.#cache.delete(key);
        this.#cache.set(key, entry);
        return entry.result;
    }
    set(key, result) {
        this.#cache.delete(key);
        this.#cache.set(key, { result, createdAt: Date.now() });
        if (this.#cache.size > this.#maxEntries) {
            const firstKey = this.#cache.keys().next().value;
            if (firstKey !== undefined) {
                this.#cache.delete(firstKey);
            }
        }
    }
    has(key) {
        return this.#cache.has(key);
    }
    clear() {
        this.#cache.clear();
    }
    get size() {
        return this.#cache.size;
    }
}

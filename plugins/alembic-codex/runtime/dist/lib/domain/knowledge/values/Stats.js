export class Stats {
    adoptions;
    applications;
    authority;
    guardHits;
    searchHits;
    views;
    // Phase 0: 时间戳 —— "最后一次被使用是什么时候"
    lastHitAt;
    lastSearchedAt;
    lastGuardHitAt;
    // Phase 0: 滑窗统计 —— "最近趋势如何"
    hitsLast30d;
    hitsLast90d;
    searchHitsLast30d;
    // Phase 0: 版本 —— "这条知识更新了几次"
    version;
    // Phase 0: 精度 (仅 kind=rule)
    ruleFalsePositiveRate;
    constructor(props = {}) {
        /** 浏览次数 */
        this.views = props.views ?? 0;
        /** 采用次数 */
        this.adoptions = props.adoptions ?? 0;
        /** 应用次数 */
        this.applications = props.applications ?? 0;
        /** Guard 命中次数 */
        this.guardHits = props.guardHits ?? 0;
        /** 搜索命中次数 */
        this.searchHits = props.searchHits ?? 0;
        /** 权威分 0-5 */
        this.authority = props.authority ?? 0;
        // Phase 0 扩展字段（旧 JSON 无这些字段时取默认值）
        this.lastHitAt = props.lastHitAt ?? null;
        this.lastSearchedAt = props.lastSearchedAt ?? null;
        this.lastGuardHitAt = props.lastGuardHitAt ?? null;
        this.hitsLast30d = props.hitsLast30d ?? 0;
        this.hitsLast90d = props.hitsLast90d ?? 0;
        this.searchHitsLast30d = props.searchHitsLast30d ?? 0;
        this.version = props.version ?? 1;
        this.ruleFalsePositiveRate = props.ruleFalsePositiveRate ?? null;
    }
    /** 从任意输入构造 Stats */
    static from(input) {
        if (input instanceof Stats) {
            return input;
        }
        if (typeof input === 'string') {
            try {
                input = JSON.parse(input);
            }
            catch {
                return new Stats();
            }
        }
        return new Stats((input || {}));
    }
    /** 增加计数 */
    increment(counter, delta = 1) {
        this[counter] += delta;
        return this;
    }
    /** 记录一次命中，同时更新时间戳（Unix 秒） */
    recordHit(counter, timestamp = Math.floor(Date.now() / 1000)) {
        this[counter] += 1;
        this.lastHitAt = timestamp;
        if (counter === 'searchHits') {
            this.lastSearchedAt = timestamp;
        }
        if (counter === 'guardHits') {
            this.lastGuardHitAt = timestamp;
        }
        return this;
    }
    /** 转换为 JSON */
    toJSON() {
        return {
            views: this.views,
            adoptions: this.adoptions,
            applications: this.applications,
            guardHits: this.guardHits,
            searchHits: this.searchHits,
            authority: this.authority,
            lastHitAt: this.lastHitAt,
            lastSearchedAt: this.lastSearchedAt,
            lastGuardHitAt: this.lastGuardHitAt,
            hitsLast30d: this.hitsLast30d,
            hitsLast90d: this.hitsLast90d,
            searchHitsLast30d: this.searchHitsLast30d,
            version: this.version,
            ruleFalsePositiveRate: this.ruleFalsePositiveRate,
        };
    }
    /** 从 wire format 创建 */
    static fromJSON(data) {
        return Stats.from(data);
    }
}
export default Stats;

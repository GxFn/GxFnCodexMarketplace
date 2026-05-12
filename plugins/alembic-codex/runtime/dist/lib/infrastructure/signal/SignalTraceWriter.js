/**
 * SignalTraceWriter — 全类型信号 JSONL 留痕
 *
 * 订阅 SignalBus 全量信号，按类型分文件写入 JSONL。
 * 替代 SignalModule 中 intent-only 的 JSONL 写入逻辑，统一处理全部类型。
 *
 * @module infrastructure/signal/SignalTraceWriter
 */
import fs from 'node:fs';
import path from 'node:path';
export class SignalTraceWriter {
    #baseDir;
    #wz;
    constructor(signalBus, baseDir, writeZone) {
        this.#baseDir = baseDir;
        this.#wz = writeZone ?? null;
        if (this.#wz) {
            this.#wz.ensureDir(this.#runtimePath(baseDir));
        }
        else {
            fs.mkdirSync(baseDir, { recursive: true });
        }
        signalBus.subscribe('*', (signal) => {
            this.#write(signal);
        });
    }
    #write(signal) {
        try {
            const fileName = this.#resolveFile(signal.type);
            const line = `${JSON.stringify({
                type: signal.type,
                source: signal.source,
                value: signal.value,
                target: signal.target,
                metadata: signal.metadata,
                timestamp: signal.timestamp,
            })}\n`;
            if (this.#wz) {
                this.#wz.appendFile(this.#runtimePath(fileName), line);
            }
            else {
                fs.appendFileSync(fileName, line, 'utf8');
            }
        }
        catch {
            // 写入失败不阻断信号分发
        }
    }
    /** 查询历史信号 */
    async query(opts = {}) {
        const types = opts.type?.length ? opts.type : this.#listTypes();
        const all = [];
        for (const t of types) {
            const filePath = this.#resolveFile(t);
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const entries = this.#readJsonl(filePath);
            all.push(...entries);
        }
        // 过滤
        let filtered = all;
        if (opts.source) {
            filtered = filtered.filter((s) => s.source === opts.source);
        }
        if (opts.target) {
            filtered = filtered.filter((s) => s.target === opts.target);
        }
        if (opts.from) {
            filtered = filtered.filter((s) => s.timestamp >= opts.from);
        }
        if (opts.to) {
            filtered = filtered.filter((s) => s.timestamp <= opts.to);
        }
        // 按时间倒序
        filtered.sort((a, b) => b.timestamp - a.timestamp);
        const total = filtered.length;
        const offset = opts.offset ?? 0;
        const limit = opts.limit ?? 50;
        const signals = filtered.slice(offset, offset + limit);
        return { signals, total };
    }
    /** 统计信息 */
    async stats(opts = {}) {
        const types = this.#listTypes();
        const byType = {};
        const bySource = {};
        let total = 0;
        for (const t of types) {
            const filePath = this.#resolveFile(t);
            if (!fs.existsSync(filePath)) {
                continue;
            }
            const entries = this.#readJsonl(filePath);
            for (const e of entries) {
                if (opts.from && e.timestamp < opts.from) {
                    continue;
                }
                if (opts.to && e.timestamp > opts.to) {
                    continue;
                }
                total++;
                byType[e.type] = (byType[e.type] ?? 0) + 1;
                bySource[e.source] = (bySource[e.source] ?? 0) + 1;
            }
        }
        return { total, byType, bySource };
    }
    // ── Private ───────────────────────────────────────
    #runtimePath(absPath) {
        const asdRoot = path.join(this.#wz.dataRoot, '.asd');
        return this.#wz.runtime(path.relative(asdRoot, absPath));
    }
    #resolveFile(type) {
        return path.join(this.#baseDir, `${type}.jsonl`);
    }
    #listTypes() {
        try {
            return fs
                .readdirSync(this.#baseDir)
                .filter((f) => f.endsWith('.jsonl'))
                .map((f) => f.replace('.jsonl', ''));
        }
        catch {
            return [];
        }
    }
    #readJsonl(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n').filter((l) => l.trim());
            const entries = [];
            for (const line of lines) {
                try {
                    entries.push(JSON.parse(line));
                }
                catch {
                    // 跳过损坏行
                }
            }
            return entries;
        }
        catch {
            return [];
        }
    }
}

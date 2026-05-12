/**
 * TimerRegistry — 全局定时器注册中心
 *
 * 职责：
 *   1. 所有 setInterval/setTimeout 通过此中心创建 → 自动 unref + 记录
 *   2. shutdown 时一键 dispose() 清理所有定时器
 *   3. 提供诊断接口：列出活跃定时器（名称、创建时间、类型）
 *
 * 不替代组件内部的定时器引用（组件仍可持有 handle 做 reschedule），
 * 但保证 shutdown 时兜底清理。
 *
 * @module shared/TimerRegistry
 */
class TimerRegistryImpl {
    #timers = new Map();
    #disposables = new Map();
    #disposed = false;
    /**
     * 创建 setInterval 并自动注册 + unref
     */
    setInterval(fn, ms, label, opts) {
        const handle = globalThis.setInterval(fn, ms);
        const blocking = opts?.blocking ?? false;
        if (!blocking && handle.unref) {
            handle.unref();
        }
        this.#timers.set(handle, {
            label,
            handle,
            kind: 'interval',
            createdAt: Date.now(),
            blocking,
        });
        return handle;
    }
    /**
     * 创建 setTimeout 并自动注册 + unref
     *
     * 到期后自动从注册表移除。
     */
    setTimeout(fn, ms, label, opts) {
        const handle = globalThis.setTimeout(() => {
            this.#timers.delete(handle);
            fn();
        }, ms);
        const blocking = opts?.blocking ?? false;
        if (!blocking && handle.unref) {
            handle.unref();
        }
        this.#timers.set(handle, {
            label,
            handle,
            kind: 'timeout',
            createdAt: Date.now(),
            blocking,
        });
        return handle;
    }
    /**
     * 手动清除已注册的定时器
     */
    clear(handle) {
        const entry = this.#timers.get(handle);
        if (!entry) {
            return;
        }
        if (entry.kind === 'interval') {
            globalThis.clearInterval(handle);
        }
        else {
            globalThis.clearTimeout(handle);
        }
        this.#timers.delete(handle);
    }
    /**
     * 注册一个 Disposable 组件（shutdown 时自动调用 dispose）
     */
    registerDisposable(label, disposable) {
        this.#disposables.set(label, disposable);
    }
    /**
     * 移除已注册的 Disposable
     */
    unregisterDisposable(label) {
        this.#disposables.delete(label);
    }
    /**
     * 清理所有定时器 + 调用所有已注册 Disposable 的 dispose。
     *
     * 幂等：多次调用安全。
     */
    async dispose() {
        if (this.#disposed) {
            return;
        }
        this.#disposed = true;
        // 1. 清除所有定时器
        for (const [handle, entry] of this.#timers) {
            if (entry.kind === 'interval') {
                globalThis.clearInterval(handle);
            }
            else {
                globalThis.clearTimeout(handle);
            }
        }
        this.#timers.clear();
        // 2. 调用所有 Disposable（并行执行，单个失败不阻断）
        await Promise.allSettled([...this.#disposables.entries()].map(async ([label, d]) => {
            try {
                await d.dispose();
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[TimerRegistry] dispose "${label}" failed: ${msg}\n`);
            }
        }));
        this.#disposables.clear();
    }
    /**
     * 诊断：列出所有活跃定时器和已注册的 Disposable
     */
    diagnostics() {
        const now = Date.now();
        return {
            timers: [...this.#timers.values()].map((e) => ({
                label: e.label,
                kind: e.kind,
                ageMs: now - e.createdAt,
            })),
            disposables: [...this.#disposables.keys()],
        };
    }
    /** 活跃定时器数 */
    get timerCount() {
        return this.#timers.size;
    }
    /** 注册的 Disposable 数 */
    get disposableCount() {
        return this.#disposables.size;
    }
    /** 是否已 disposed */
    get isDisposed() {
        return this.#disposed;
    }
    /**
     * 重置状态（仅供测试使用）
     */
    _resetForTesting() {
        this.#disposed = false;
        this.#timers.clear();
        this.#disposables.clear();
    }
}
/** 全局单例 */
export const timerRegistry = new TimerRegistryImpl();

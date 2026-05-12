/**
 * FileChangeSourceTracker — tracks live IDE collectors for daemon fallback gating.
 *
 * VSCode sends a lightweight heartbeat while its Alembic extension is active.
 * The daemon file-change collector uses this signal to avoid duplicating IDE
 * events, and only falls back to git worktree scans after the heartbeat expires.
 */
export class FileChangeSourceTracker {
    #vscodeExtensionSeenAt = 0;
    markVscodeExtensionSeen(now = Date.now()) {
        this.#vscodeExtensionSeenAt = now;
    }
    hasRecentVscodeExtension(ttlMs, now = Date.now()) {
        return this.#vscodeExtensionSeenAt > 0 && now - this.#vscodeExtensionSeenAt <= ttlMs;
    }
    snapshot(now = Date.now()) {
        return {
            vscodeExtensionSeenAt: this.#vscodeExtensionSeenAt > 0
                ? new Date(this.#vscodeExtensionSeenAt).toISOString()
                : null,
            vscodeExtensionAgeMs: this.#vscodeExtensionSeenAt > 0 ? now - this.#vscodeExtensionSeenAt : null,
        };
    }
    resetForTesting() {
        this.#vscodeExtensionSeenAt = 0;
    }
}
const globalFileChangeSourceTracker = new FileChangeSourceTracker();
export function getFileChangeSourceTracker() {
    return globalFileChangeSourceTracker;
}

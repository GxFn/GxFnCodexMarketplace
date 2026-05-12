import { spawn } from "node:child_process";

export class KeepAwakeController {
  constructor({
    config = {},
    logger = console,
    platform = process.platform,
    spawnImpl = spawn,
  } = {}) {
    this.config = config;
    this.logger = logger;
    this.platform = platform;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.lastError = "";
  }

  start() {
    if (!this.#enabled()) {
      return this.status({ message: "disabled" });
    }
    if (this.platform !== "darwin") {
      return this.status({ message: "macOS only" });
    }
    if (this.#isRunning()) {
      return this.status({ message: "already running" });
    }

    const command = this.config.handoff?.keepAwakeCommand || "caffeinate";
    const args = Array.isArray(this.config.handoff?.keepAwakeArgs)
      ? this.config.handoff.keepAwakeArgs
      : ["-dimsu"];

    try {
      const child = this.spawnImpl(command, args, {
        stdio: "ignore",
        detached: false,
      });
      this.child = child;
      this.lastError = "";
      child.once?.("error", (error) => {
        this.lastError = error.message;
        if (this.child === child) this.child = null;
        this.logger?.warn?.(`Codex Lark Remote keep-awake failed: ${error.message}`);
      });
      child.once?.("exit", () => {
        if (this.child === child) this.child = null;
      });
      child.unref?.();
      return this.status({ message: "started" });
    } catch (error) {
      this.lastError = error.message;
      this.logger?.warn?.(`Codex Lark Remote keep-awake failed: ${error.message}`);
      return this.status({ message: "failed" });
    }
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (!child) return this.status({ message: "not running" });
    try {
      child.kill?.("SIGTERM");
      return this.status({ message: "stopped" });
    } catch (error) {
      this.lastError = error.message;
      return this.status({ message: "stop failed" });
    }
  }

  status(extra = {}) {
    return {
      enabled: this.#enabled(),
      active: this.#isRunning(),
      platform: this.platform,
      pid: this.#isRunning() ? this.child.pid || 0 : 0,
      command: this.config.handoff?.keepAwakeCommand || "caffeinate",
      args: Array.isArray(this.config.handoff?.keepAwakeArgs)
        ? this.config.handoff.keepAwakeArgs
        : ["-dimsu"],
      lastError: this.lastError,
      ...extra,
    };
  }

  #enabled() {
    if (process.env.CODEX_LARK_KEEP_AWAKE === "0") return false;
    return this.config.handoff?.keepAwake !== false;
  }

  #isRunning() {
    return Boolean(this.child && !this.child.killed);
  }
}

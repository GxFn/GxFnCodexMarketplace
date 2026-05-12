import fs from "node:fs/promises";
import { ensureDir, nowIso, observationFilePath, resolveDataDir } from "./config.mjs";
import { findCodexThreadById, listCodexThreads } from "./handoff.mjs";
import { createSessionProgressWatcher } from "./runner.mjs";

export async function readObservation(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  try {
    const state = JSON.parse(await fs.readFile(observationFilePath(dataDir), "utf8"));
    return state?.active ? state : null;
  } catch {
    return null;
  }
}

export async function activateObservation(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  const thread = await resolveObservationThread(options);
  const state = {
    active: true,
    mode: "observe",
    threadId: thread.threadId,
    threadPath: thread.threadPath || "",
    cwd: thread.cwd || "",
    name: thread.name || "",
    messageId: options.messageId || "",
    chatIdHash: options.chatIdHash || "",
    userIdHash: options.userIdHash || "",
    activatedAt: nowIso(),
    activatedBy: options.activatedBy || "lark",
  };
  await fs.writeFile(observationFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export async function clearObservation(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const previous = await readObservation({ dataDir });
  await ensureDir(dataDir);
  await fs.writeFile(
    observationFilePath(dataDir),
    `${JSON.stringify({ active: false, deactivatedAt: nowIso(), previousThreadId: previous?.threadId || "" }, null, 2)}\n`,
  );
  return { active: false, previous };
}

export async function listObservationTargets(options = {}) {
  return listCodexThreads({ ...options, limit: options.limit || 10 });
}

export async function resolveObservationThread(options = {}) {
  const selector = String(options.selector || options.threadId || "").trim();
  const candidates = await listObservationTargets(options);
  if (!selector) throw new Error("Select a Codex session to observe.");
  if (/^\d+$/.test(selector)) {
    const index = Number(selector) - 1;
    if (candidates[index]) return candidates[index];
    throw new Error(`No observable Codex session at index ${selector}.`);
  }
  const lower = selector.toLowerCase();
  const matches = candidates.filter((thread) =>
    thread.threadId.toLowerCase().startsWith(lower)
    || thread.threadId.toLowerCase() === lower
    || (thread.name && thread.name.toLowerCase().includes(lower))
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Observation selector is ambiguous: ${selector}`);
  }
  const byId = await findCodexThreadById(selector, options);
  if (byId) return byId;
  throw new Error(`No observable Codex session matched: ${selector}`);
}

export class CodexSessionObserver {
  constructor({ config, notifier, logger = console }) {
    this.config = config;
    this.notifier = notifier;
    this.logger = logger;
    this.watcher = null;
    this.state = null;
  }

  status() {
    return {
      active: Boolean(this.state?.active),
      threadId: this.state?.threadId || "",
      name: this.state?.name || "",
      cwd: this.state?.cwd || "",
      lastError: this.state?.lastError || "",
    };
  }

  async restore() {
    const state = await readObservation({ dataDir: this.config.dataDir });
    if (state) await this.start(state);
  }

  async start(state) {
    await this.stop();
    this.state = state;
    if (!state?.threadPath || !state?.messageId || !this.notifier) return this.status();
    this.watcher = createSessionProgressWatcher({
      sessionPath: state.threadPath,
      onEvent: async (_event, summary) => this.#notify(summary),
    });
    await this.watcher.start();
    return this.status();
  }

  async stop() {
    if (this.watcher) {
      const watcher = this.watcher;
      this.watcher = null;
      this.state = null;
      await watcher.stop().catch((error) => this.logger.warn?.(error));
    } else {
      this.state = null;
    }
  }

  async #notify(summary) {
    if (!summary || !this.state?.active) return;
    const live = await readObservation({ dataDir: this.config.dataDir });
    if (!live?.active || live.threadId !== this.state.threadId) return;
    try {
      await this.notifier.reply(this.state.messageId, withObservationTitle(summary, this.state));
    } catch (error) {
      this.logger.warn?.(`Codex Lark Remote observer notify failed: ${error.message}`);
    }
  }
}

function withObservationTitle(summary, state) {
  const title = String(state?.name || "").trim();
  if (!title) return summary;
  return `Title: ${title}\n${summary}`;
}

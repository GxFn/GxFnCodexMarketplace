import fs from "node:fs/promises";
import { ensureDir, newId, nowIso, queueFilePath } from "./config.mjs";

const EMPTY_DB = { version: 1, commands: [], events: [] };

export class RemoteCommandQueue {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = queueFilePath(dataDir);
  }

  async enqueue(input) {
    return this.#mutate((db) => {
      const now = nowIso();
      const command = {
        id: input.id || newId(),
        source: input.source || "lark",
        mode: input.mode || "worktree",
        presentation: input.presentation || (input.mode === "thread_handoff" ? "chat" : "task"),
        notifyQueued: input.notifyQueued === true,
        notifyStarted: input.notifyStarted === true,
        includeRemoteNote: input.includeRemoteNote === true,
        handoffGuidance: input.handoffGuidance === true,
        guidanceForCommandId: input.guidanceForCommandId || "",
        repoKey: input.repoKey,
        projectRoot: input.projectRoot,
        prompt: input.prompt,
        normalizedTask: input.normalizedTask || input.prompt,
        status: "pending",
        chatIdHash: input.chatIdHash || "",
        messageId: input.messageId || "",
        userIdHash: input.userIdHash || "",
        userName: input.userName || "lark_user",
        worktreePath: "",
        branchName: "",
        codexSessionId: input.codexSessionId || "",
        codexSessionPath: input.codexSessionPath || "",
        result: "",
        diffSummary: "",
        testSummary: "",
        error: "",
        createdAt: now,
        claimedAt: "",
        completedAt: "",
        approvedActions: [],
      };
      db.commands.push(command);
      db.events.push(eventFor(command.id, "queued", { repoKey: command.repoKey }));
      return command;
    });
  }

  async list({ limit = 20 } = {}) {
    const db = await this.#read();
    return db.commands.slice().reverse().slice(0, limit);
  }

  async get(id) {
    const db = await this.#read();
    return db.commands.find((command) => command.id === id) || null;
  }

  async findByMessageId(messageId) {
    if (!messageId) return null;
    const db = await this.#read();
    return db.commands.find((command) => command.messageId === messageId) || null;
  }

  async counts() {
    const db = await this.#read();
    const counts = {};
    for (const command of db.commands) {
      counts[command.status] = (counts[command.status] || 0) + 1;
    }
    return counts;
  }

  async claimNext() {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.status === "pending");
      if (!command) return null;
      command.status = "running";
      command.claimedAt = nowIso();
      db.events.push(eventFor(command.id, "claimed", {}));
      return command;
    });
  }

  async update(id, patch, eventKind = "updated") {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      Object.assign(command, patch);
      db.events.push(eventFor(id, eventKind, patch));
      return command;
    });
  }

  async cancel(id, reason = "cancelled by user") {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      if (!["pending", "running", "waiting_review"].includes(command.status)) return command;
      command.status = "cancelled";
      command.error = reason;
      command.completedAt = nowIso();
      db.events.push(eventFor(id, "cancelled", { reason }));
      return command;
    });
  }

  async approve(id, action) {
    return this.#mutate((db) => {
      const command = db.commands.find((item) => item.id === id);
      if (!command) return null;
      command.approvedActions = [...new Set([...(command.approvedActions || []), action])];
      db.events.push(eventFor(id, "approved", { action }));
      return command;
    });
  }

  async events(id, { limit = 50 } = {}) {
    const db = await this.#read();
    return db.events.filter((event) => event.commandId === id).slice(-limit);
  }

  async #mutate(fn) {
    const db = await this.#read();
    const result = fn(db);
    await this.#write(db);
    return result;
  }

  async #read() {
    await ensureDir(this.dataDir);
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text);
      return {
        version: parsed.version || 1,
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(EMPTY_DB);
      throw error;
    }
  }

  async #write(db) {
    await ensureDir(this.dataDir);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`);
    await fs.rename(tmp, this.filePath);
  }
}

function eventFor(commandId, kind, payload) {
  return {
    id: newId("evt"),
    commandId,
    kind,
    payload,
    createdAt: nowIso(),
  };
}

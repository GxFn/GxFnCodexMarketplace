import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_BRIDGE_HOST = "127.0.0.1";

export function resolveDataDir(explicitDir) {
  return path.resolve(
    explicitDir ||
      process.env.CODEX_LARK_DATA_DIR ||
      path.join(os.homedir(), ".codex-lark-remote"),
  );
}

export function queueFilePath(dataDir) {
  return path.join(dataDir, "queue.json");
}

export function stateFilePath(dataDir) {
  return path.join(dataDir, "bridge-state.json");
}

export function bridgeLogFilePath(dataDir) {
  return path.join(dataDir, "bridge.log");
}

export function handoffFilePath(dataDir) {
  return path.join(dataDir, "handoff.json");
}

export function observationFilePath(dataDir) {
  return path.join(dataDir, "observation.json");
}

export function configFilePath(dataDir) {
  return path.resolve(process.env.CODEX_LARK_CONFIG || path.join(dataDir, "config.json"));
}

export function worktreeRoot(dataDir) {
  return path.join(dataDir, "worktrees");
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readPackageVersion() {
  for (const url of [
    new URL("../package.json", import.meta.url),
    new URL("../.codex-plugin/plugin.json", import.meta.url),
  ]) {
    try {
      const text = await fs.readFile(url, "utf8");
      const version = JSON.parse(text).version;
      if (version) return version;
    } catch {
      // Try the next metadata location. Marketplace bundles may start at the plugin root.
    }
  }
  return "0.0.0";
}

export async function loadConfig(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);

  let userConfig = {};
  const configPath = options.configPath || configFilePath(dataDir);
  try {
    userConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const config = mergeConfig(defaultConfig(dataDir), userConfig);
  config.dataDir = dataDir;
  config.configPath = configPath;
  return config;
}

export function defaultConfig(dataDir = resolveDataDir()) {
  return {
    dataDir,
    lark: {
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      allowedUsers: [],
      transport: "websocket",
      websocket: true,
      websocketStartTimeoutMs: 10000,
    },
    defaultRepo: "",
    repos: {},
    runner: {
      sandbox: "workspace-write",
      askForApproval: "never",
      ignoreUserConfig: true,
      skipGitRepoCheck: true,
      model: "",
      codexPath: "codex",
      timeoutMs: 30 * 60 * 1000,
      workerEnabled: true,
    },
    handoff: {
      enabled: true,
      mode: "resume",
      promptStyle: "direct",
      notifyQueued: false,
      notifyStarted: true,
      notifyProgress: true,
      showCommands: false,
      keepAwake: true,
      keepAwakeCommand: "caffeinate",
      keepAwakeArgs: ["-dimsu"],
    },
    policy: {
      requireReviewForCommit: true,
      requireReviewForPush: true,
      maxPromptChars: 4000,
      maxResultChars: 3000,
      allowNetwork: false,
    },
  };
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    lark: { ...(base.lark || {}), ...(override.lark || {}) },
    repos: { ...(base.repos || {}), ...(override.repos || {}) },
    runner: { ...(base.runner || {}), ...(override.runner || {}) },
    handoff: { ...(base.handoff || {}), ...(override.handoff || {}) },
    policy: { ...(base.policy || {}), ...(override.policy || {}) },
  };
}

export function safeFileName(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "unknown";
}

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix = "rcmd") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

export function shortHash(value) {
  if (!value) return "";
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

export function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

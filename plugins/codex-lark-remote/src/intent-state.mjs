import fs from "node:fs/promises";
import { ensureDir, intentConsoleFilePath, nowIso, resolveDataDir, shortHash } from "./config.mjs";

const VALID_MODES = new Set(["console", "handoff"]);
const VALID_LANGUAGES = new Set(["zh", "en"]);

export async function readIntentState(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  try {
    const parsed = JSON.parse(await fs.readFile(intentConsoleFilePath(dataDir), "utf8"));
    return {
      version: 1,
      sessions: {},
      ...parsed,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, sessions: {} };
    throw error;
  }
}

export async function readIntentSession(options = {}) {
  const state = await readIntentState(options);
  const key = intentSessionKey(options.event);
  if (!key) return null;
  const stored = state.sessions?.[key] || null;
  if (stored) return stored;
  if (isConfiguredConsoleChat(options.event, options.config)) {
    return {
      mode: "console",
      language: normalizeIntentLanguage(options.config?.intent?.language),
      chatIdHash: key,
      configured: true,
    };
  }
  return null;
}

export async function resolveIntentSessionMode(options = {}) {
  if (options.config?.intent?.enabled === false) return "handoff";
  const session = await readIntentSession(options);
  return session?.mode === "console" ? "console" : "handoff";
}

export async function setIntentSessionMode(options = {}) {
  const mode = String(options.mode || "").trim();
  if (!VALID_MODES.has(mode)) throw new Error(`Unknown intent session mode: ${mode}`);
  const language = normalizeIntentLanguage(options.language);
  return writeIntentSession({
    ...options,
    patch: { mode, ...(language ? { language } : {}) },
  });
}

export async function setIntentSessionLanguage(options = {}) {
  const language = normalizeIntentLanguage(options.language);
  if (!language) return null;
  return writeIntentSession({
    ...options,
    patch: { language },
  });
}

export async function resolveIntentSessionLanguage(options = {}) {
  const detected = detectIntentLanguage(options.text || options.event?.text || "");
  if (detected) return detected;
  const session = await readIntentSession(options);
  return normalizeIntentLanguage(session?.language)
    || normalizeIntentLanguage(options.config?.intent?.language)
    || "zh";
}

export function detectIntentLanguage(text) {
  const value = String(text || "");
  if (/[\u3400-\u9fff]/.test(value)) return "zh";
  if (/[A-Za-z]/.test(value)) return "en";
  return "";
}

export function normalizeIntentLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  return VALID_LANGUAGES.has(language) ? language : "";
}

async function writeIntentSession(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const key = intentSessionKey(options.event);
  if (!key) return null;
  const state = await readIntentState({ dataDir });
  const previous = state.sessions?.[key] || {};
  const session = {
    ...previous,
    ...(options.patch || {}),
    chatId: options.event?.chatId || previous.chatId || "",
    chatIdHash: key,
    userIdHash: options.event?.userIdHash || previous.userIdHash || "",
    updatedAt: nowIso(),
    updatedBy: options.reason || "lark",
  };
  if (!previous.createdAt) session.createdAt = session.updatedAt;
  state.sessions = { ...(state.sessions || {}), [key]: session };
  await writeIntentState(dataDir, state);
  return session;
}

export function intentSessionKey(event = {}) {
  if (event.chatIdHash) return event.chatIdHash;
  if (event.chatId) return `c_${shortHash(event.chatId)}`;
  return "";
}

export function isConfiguredConsoleChat(event = {}, config = {}) {
  if (config.intent?.enabled === false) return false;
  const configured = config.intent?.consoleChatIds;
  const ids = Array.isArray(configured)
    ? configured.map((item) => String(item || "").trim()).filter(Boolean)
    : String(configured || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!ids.length) return false;
  const candidates = [
    event.chatId,
    event.chatIdHash,
    event.chatId ? `c_${shortHash(event.chatId)}` : "",
  ].filter(Boolean);
  return candidates.some((candidate) => ids.includes(candidate));
}

async function writeIntentState(dataDir, state) {
  await ensureDir(dataDir);
  await fs.writeFile(intentConsoleFilePath(dataDir), `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`);
}

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, handoffFilePath, nowIso, resolveDataDir } from "./config.mjs";

const SESSION_FILE_RE = /rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export async function activateHandoff(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  const thread = await resolveCodexThread({
    ...options,
    requireExplicitThread: options.requireExplicitThread !== false,
  });
  const state = {
    active: true,
    mode: "resume",
    threadId: thread.threadId,
    threadPath: thread.threadPath || "",
    cwd: thread.cwd || options.cwd || "",
    name: thread.name || "",
    activatedAt: nowIso(),
    activatedBy: options.activatedBy || "codex",
    source: thread.source || "",
    remoteNoteSentAt: "",
  };
  await fs.writeFile(handoffFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export async function readHandoff(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  try {
    const state = JSON.parse(await fs.readFile(handoffFilePath(dataDir), "utf8"));
    return state?.active ? state : null;
  } catch {
    return null;
  }
}

export async function clearHandoff(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const previous = await readHandoff({ dataDir });
  await ensureDir(dataDir);
  await fs.writeFile(
    handoffFilePath(dataDir),
    `${JSON.stringify({ active: false, deactivatedAt: nowIso(), previousThreadId: previous?.threadId || "" }, null, 2)}\n`,
  );
  return { active: false, previous };
}

export async function markHandoffRemoteNoteSent(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const filePath = handoffFilePath(dataDir);
  const state = await readHandoff({ dataDir });
  if (!state) return false;
  if (options.threadId && state.threadId !== options.threadId) return false;
  if (state.remoteNoteSentAt) return false;

  state.remoteNoteSentAt = nowIso();
  await ensureDir(dataDir);
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
  return true;
}

export async function resolveCodexThread(options = {}) {
  if (options.threadId) {
    const resolved = {
      threadId: options.threadId,
      threadPath: options.threadPath || "",
      cwd: options.cwd || "",
      name: options.name || "",
      source: "explicit",
    };
    if (!resolved.threadPath) {
      const match = await findCodexThreadById(options.threadId, options);
      if (match) return { ...match, cwd: resolved.cwd || match.cwd, name: resolved.name || match.name };
    }
    return resolved;
  }
  if (options.requireExplicitThread) {
    throw new Error("Current Codex thread id is required for handoff. Refusing to guess from workspace path.");
  }

  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const sessionsRoot = path.join(codexHome, "sessions");
  const requestedCwd = options.cwd ? path.resolve(options.cwd) : "";
  const candidates = await listSessionFiles(sessionsRoot);
  const exact = await findSession(candidates, requestedCwd);
  if (exact) return exact;
  throw new Error("No Codex session found for handoff. Pass threadId explicitly.");
}

export async function listCodexThreads(options = {}) {
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const sessionsRoot = path.join(codexHome, "sessions");
  const requestedCwd = options.cwd ? path.resolve(options.cwd) : "";
  const limit = Number(options.limit || 10);
  const candidates = [];
  for (const file of await listSessionFiles(sessionsRoot)) {
    if (candidates.length >= limit) break;
    const meta = await readSessionMeta(file.path);
    if (!meta?.id || isHiddenSession(meta)) continue;
    const candidate = {
      threadId: meta.id,
      threadPath: file.path,
      cwd: meta.cwd || "",
      name: meta.name || "",
      source: meta.source || "",
      updatedAtMs: file.mtimeMs,
    };
    if (requestedCwd && !cwdMatches(candidate.cwd, requestedCwd)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

export async function findCodexThreadById(threadId, options = {}) {
  const target = String(threadId || "").trim().toLowerCase();
  if (!target) return null;
  const codexHome = path.resolve(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  const sessionsRoot = path.join(codexHome, "sessions");
  for (const file of await listSessionFiles(sessionsRoot)) {
    const meta = await readSessionMeta(file.path);
    if (!meta?.id || isHiddenSession(meta)) continue;
    if (String(meta.id).toLowerCase() !== target) continue;
    return {
      threadId: meta.id,
      threadPath: file.path,
      cwd: meta.cwd || "",
      name: meta.name || "",
      source: meta.source || "",
      updatedAtMs: file.mtimeMs,
    };
  }
  return null;
}

async function findSession(files, requestedCwd) {
  let fallback = null;
  for (const file of files) {
    const meta = await readSessionMeta(file.path);
    if (!meta?.id) continue;
    if (isHiddenSession(meta)) continue;
    const candidate = {
      threadId: meta.id,
      threadPath: file.path,
      cwd: meta.cwd || "",
      name: meta.name || "",
      source: meta.source || "",
      updatedAtMs: file.mtimeMs,
    };
    if (!fallback) fallback = candidate;
    if (!requestedCwd || cwdMatches(candidate.cwd, requestedCwd)) return candidate;
  }
  return fallback;
}

async function listSessionFiles(root) {
  const files = [];
  await walk(root, files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

async function walk(dir, files) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, files);
    } else if (entry.isFile() && SESSION_FILE_RE.test(entry.name)) {
      try {
        const stat = await fs.stat(fullPath);
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Skip files that disappear while scanning.
      }
    }
  }
}

async function readSessionMeta(filePath) {
  const firstLine = await readFirstLine(filePath);
  try {
    const record = JSON.parse(firstLine);
    if (record.type !== "session_meta") return null;
    const payload = record.payload || {};
    const name = await inferSessionTitle(filePath, payload.name || payload.title || "");
    return {
      id: payload.id || idFromPath(filePath),
      cwd: payload.cwd || "",
      name,
      source: payload.source || "",
      threadSource: payload.thread_source || "",
      agentRole: payload.agent_role || "",
      agentNickname: payload.agent_nickname || "",
      baseInstructions: payload.base_instructions?.text || "",
    };
  } catch {
    return { id: idFromPath(filePath), cwd: "" };
  }
}

async function readFirstLine(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const chunks = [];
    let offset = 0;
    let total = 0;
    const chunkSize = 128 * 1024;
    const maxFirstLineBytes = 2 * 1024 * 1024;
    while (total < maxFirstLineBytes) {
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newline = chunk.indexOf(10);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        break;
      }
      chunks.push(chunk);
      offset += bytesRead;
      total += bytesRead;
    }
    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  } finally {
    await handle.close();
  }
}

async function inferSessionTitle(filePath, fallback = "") {
  const fallbackTitle = cleanTitle(fallback);
  if (fallbackTitle) return fallbackTitle;
  for (const line of await readInitialLines(filePath)) {
    let record = null;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = record?.payload || {};
    const explicit = cleanTitle(payload.title || payload.name || payload.session_title || "");
    if (explicit) return explicit;
    const userText = extractUserText(record);
    const title = cleanTitle(userText);
    if (title) return title;
  }
  return "";
}

async function readInitialLines(filePath, { maxBytes = 512 * 1024, maxLines = 120 } = {}) {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, maxLines);
  } finally {
    await handle.close();
  }
}

function extractUserText(record) {
  const payload = record?.payload || {};
  if (record.type === "event_msg" && payload.type === "user_message") return payload.message || "";
  if (record.type === "response_item" && payload.type === "message" && payload.role === "user") {
    return extractContentText(payload.content);
  }
  if (payload.role === "user" && Array.isArray(payload.content)) return extractContentText(payload.content);
  return "";
}

function extractContentText(content) {
  return content
    .map((item) => item?.text || "")
    .filter(Boolean)
    .join("\n");
}

function cleanTitle(value) {
  const text = String(value || "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .replace(/<codex_lark_remote_note>[\s\S]*?<\/codex_lark_remote_note>/g, "")
    .replace(/\[@([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^<[^>]+>$/.test(text)) return "";
  if (/^(system|developer|assistant):/i.test(text)) return "";
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function idFromPath(filePath) {
  return path.basename(filePath).match(SESSION_FILE_RE)?.[1] || "";
}

function cwdMatches(sessionCwd, requestedCwd) {
  if (!sessionCwd || !requestedCwd) return false;
  const sessionPath = path.resolve(sessionCwd);
  const requestedPath = path.resolve(requestedCwd);
  return (
    sessionPath === requestedPath ||
    requestedPath.startsWith(`${sessionPath}${path.sep}`) ||
    sessionPath.startsWith(`${requestedPath}${path.sep}`)
  );
}

function isHiddenSession(meta) {
  if (meta.threadSource === "subagent") return true;
  if (meta.source === "exec") return true;
  if (typeof meta.source === "object" && meta.source?.subagent) return true;
  if (meta.agentRole || meta.agentNickname) return true;
  if (/judging one planned coding-agent action|guardian/i.test(meta.baseInstructions || "")) return true;
  return false;
}

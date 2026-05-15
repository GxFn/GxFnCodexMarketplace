import fs from "node:fs/promises";
import path from "node:path";
import { activateHandoff } from "./handoff.mjs";
import { ensureDir, nowIso, resolveDataDir, takeoverFilePath } from "./config.mjs";
import { listCodexThreads, findCodexThreadById } from "./handoff.mjs";

const FINAL_EVENT_RE = /(?:turn[./_-]?completed|response[./_-]?completed|final_answer|agent_message)/i;
const RUNNING_EVENT_RE = /(?:tool_call|command|exec|turn[./_-]?started|response[./_-]?started|agent_reasoning|agent_progress)/i;

export async function readTakeover(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  try {
    const state = JSON.parse(await fs.readFile(takeoverFilePath(dataDir), "utf8"));
    if (!state || state.state === "none" || state.state === "cancelled") return null;
    return state;
  } catch {
    return null;
  }
}

export async function prepareTakeoverScope(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  const now = nowIso();
  const state = {
    version: 1,
    state: "selecting",
    scope: {
      cwd: options.cwd || "",
      startedByThreadId: options.threadId || "",
      startedByThreadPath: options.threadPath || "",
      startedAt: now,
      startedBy: options.startedBy || "mcp",
    },
    selection: emptySelection(),
    target: null,
    lark: {},
    pendingInputs: [],
    activatedAt: "",
    deactivatedAt: "",
    lastSeenStatus: "",
    lastSeenAt: "",
  };
  await writeTakeover({ dataDir }, state);
  return state;
}

export async function clearTakeover(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const previous = await readTakeover({ dataDir });
  await ensureDir(dataDir);
  const state = {
    version: 1,
    state: "cancelled",
    deactivatedAt: nowIso(),
    previousThreadId: previous?.target?.threadId || "",
  };
  await fs.writeFile(takeoverFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
  return { state: "cancelled", previous };
}

export async function listTakeoverTargets(options = {}) {
  const state = await readTakeover(options);
  const scope = state?.scope || {};
  const cwd = options.cwd || scope.cwd || "";
  const excludeThreadId = options.excludeThreadId || "";
  const limit = Number(options.limit || 10);
  const candidates = await listCodexThreads({
    ...options,
    cwd,
    limit: Math.max(limit + 5, limit),
  });
  const filtered = [];
  for (const thread of candidates) {
    if (excludeThreadId && thread.threadId === excludeThreadId) continue;
    const status = await detectSessionStatus(thread.threadPath, {
      idleDebounceMs: options.idleDebounceMs,
    });
    filtered.push({
      ...thread,
      status: status.status,
      statusReason: status.reason,
      lastEventAtMs: status.lastEventAtMs || thread.updatedAtMs || 0,
    });
    if (filtered.length >= limit) break;
  }
  return filtered;
}

export async function listTakeoverProjects(options = {}) {
  const limit = Number(options.limit || 20);
  const threadLimit = Number(options.threadLimit || Math.max(limit * 20, 200));
  const threads = await listCodexThreads({
    ...options,
    cwd: "",
    limit: threadLimit,
  });
  const projects = new Map();
  for (const thread of threads) {
    const cwd = String(thread.cwd || "").trim();
    if (!cwd) continue;
    const existing = projects.get(cwd) || {
      cwd,
      name: projectNameFromCwd(cwd),
      windowCount: 0,
      updatedAtMs: 0,
      latestThreadId: "",
      latestWindowName: "",
    };
    existing.windowCount += 1;
    if (Number(thread.updatedAtMs || 0) > existing.updatedAtMs) {
      existing.updatedAtMs = Number(thread.updatedAtMs || 0);
      existing.latestThreadId = thread.threadId || "";
      existing.latestWindowName = thread.name || "";
    }
    projects.set(cwd, existing);
  }
  return Array.from(projects.values())
    .sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0))
    .slice(0, limit)
    .map((project, index) => ({ ...project, index: index + 1 }));
}

export async function refreshTakeoverProjectSelection(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir }) || await prepareTakeoverScope(options);
  const projects = await listTakeoverProjects(options);
  const now = Date.now();
  const updated = {
    ...state,
    state: "selecting_project",
    projectSelection: {
      listedAt: nowIso(),
      expiresAt: new Date(now + Number(options.selectionTtlMs || 10 * 60 * 1000)).toISOString(),
      options: projects.map((project, index) => optionForProject(project, index + 1)),
    },
    selection: emptySelection(),
    target: null,
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return { state: updated, projects };
}

export async function selectTakeoverProject(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await ensureTakeoverState(options);
  const project = await resolveTakeoverProject({ ...options, dataDir, state });
  const updated = {
    ...state,
    state: "selecting",
    scope: {
      ...(state.scope || {}),
      cwd: project.cwd,
    },
    project,
    selection: emptySelection(),
    target: null,
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  const refreshed = await refreshTakeoverSelection({
    ...options,
    dataDir,
    cwd: project.cwd,
  });
  const refreshedProject = refreshProjectFromTargets(project, refreshed.targets);
  const refreshedState = {
    ...refreshed.state,
    project: refreshedProject,
  };
  await writeTakeover({ dataDir }, refreshedState);
  return { ...refreshed, state: refreshedState, project: refreshedProject };
}

export async function refreshTakeoverSelection(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir }) || await prepareTakeoverScope(options);
  const targets = await listTakeoverTargets({
    ...options,
    dataDir,
    cwd: options.cwd || state.scope?.cwd || "",
    excludeThreadId: options.excludeThreadId || "",
    idleDebounceMs: options.idleDebounceMs,
  });
  const now = Date.now();
  const updated = {
    ...state,
    state: "selecting",
    selection: {
      listedAt: nowIso(),
      expiresAt: new Date(now + Number(options.selectionTtlMs || 10 * 60 * 1000)).toISOString(),
      options: targets.map((target, index) => optionForTarget(target, index + 1)),
    },
    target: null,
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return { state: updated, targets };
}

export async function selectTakeoverTarget(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await ensureTakeoverState(options);
  const target = await resolveTakeoverTarget({
    ...options,
    dataDir,
    state,
  });
  const updated = {
    ...state,
    state: "selected",
    target: {
      ...target,
      selectedAt: nowIso(),
      selectedBy: options.selectedBy || "lark",
    },
    lark: mergeLarkState(state.lark, options),
    lastSeenStatus: target.status || "",
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return { state: updated, target };
}

export async function executeTakeoverTarget(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  let state = await ensureTakeoverState(options);
  let target = options.target || state.target;
  if (!target || options.selector || options.threadId || options.optionIndex) {
    const selected = await selectTakeoverTarget({
      ...options,
      dataDir,
      selectedBy: options.selectedBy || "lark",
    });
    state = selected.state;
    target = selected.target;
  }
  const fresh = await refreshTargetStatus(target, options);
  const updatedTarget = { ...target, ...fresh };

  if (updatedTarget.status === "running" || updatedTarget.status === "unknown") {
    const pendingAt = state.pendingAt || nowIso();
    const pending = {
      ...state,
      state: "pending",
      pendingAt,
      target: {
        ...updatedTarget,
        selectedAt: state.target?.selectedAt || nowIso(),
        selectedBy: state.target?.selectedBy || options.selectedBy || "lark",
      },
      lark: mergeLarkState(state.lark, options),
      lastSeenStatus: updatedTarget.status,
      lastSeenAt: nowIso(),
    };
    await writeTakeover({ dataDir }, pending);
    return { state: pending, target: pending.target, handoff: null, pending: true };
  }

  const handoff = await activateHandoff({
    dataDir,
    threadId: updatedTarget.threadId,
    threadPath: updatedTarget.threadPath,
    cwd: updatedTarget.cwd,
    name: updatedTarget.name,
    requireExplicitThread: true,
    activatedBy: options.activatedBy || "takeover",
  });
  const active = {
    ...state,
    state: "active",
    target: updatedTarget,
    lark: mergeLarkState(state.lark, options),
    activatedAt: nowIso(),
    pendingAt: "",
    lastSeenStatus: "idle",
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, active);
  return { state: active, target: updatedTarget, handoff, pending: false };
}

export async function activatePendingTakeoverIfIdle(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir });
  if (!state || state.state !== "pending" || !state.target?.threadId) return null;
  const timeoutMs = Number(options.pendingTimeoutMs || 0);
  const pendingAtMs = Date.parse(state.pendingAt || state.lastSeenAt || "");
  if (timeoutMs > 0 && Number.isFinite(pendingAtMs) && Date.now() - pendingAtMs > timeoutMs) {
    const timedOut = {
      ...state,
      state: "cancelled",
      deactivatedAt: nowIso(),
      lastSeenStatus: "timeout",
      lastSeenAt: nowIso(),
    };
    await writeTakeover({ dataDir }, timedOut);
    return { activated: false, timedOut: true, state: timedOut, target: state.target };
  }
  const target = await refreshTargetStatus(state.target, options);
  if (target.status !== "idle") {
    const updated = {
      ...state,
      target: { ...state.target, ...target },
      lastSeenStatus: target.status,
      lastSeenAt: nowIso(),
    };
    await writeTakeover({ dataDir }, updated);
    return { activated: false, state: updated };
  }
  const result = await executeTakeoverTarget({
    ...options,
    dataDir,
    target: { ...state.target, ...target },
    activatedBy: "takeover-watcher",
  });
  return { activated: true, ...result };
}

export async function clearPendingTakeoverInputs(options = {}) {
  const dataDir = resolveDataDir(options.dataDir);
  const state = await readTakeover({ dataDir });
  if (!state) return null;
  const updated = {
    ...state,
    pendingInputs: [],
    lastSeenAt: nowIso(),
  };
  await writeTakeover({ dataDir }, updated);
  return updated;
}

export async function detectSessionStatus(sessionPath, options = {}) {
  if (!sessionPath) return { status: "unknown", reason: "missing session path" };
  let stat;
  try {
    stat = await fs.stat(sessionPath);
  } catch {
    return { status: "unknown", reason: "session file unavailable" };
  }
  const last = await readLastJsonRecord(sessionPath);
  const statusFromEvent = statusFromRecord(last);
  if (statusFromEvent) {
    return {
      status: statusFromEvent,
      reason: `last event ${statusFromEvent}`,
      lastEventAtMs: stat.mtimeMs,
    };
  }
  const idleDebounceMs = Number(options.idleDebounceMs || 3000);
  if (Date.now() - stat.mtimeMs < idleDebounceMs) {
    return { status: "running", reason: "recent session write", lastEventAtMs: stat.mtimeMs };
  }
  return { status: "idle", reason: "session file stable", lastEventAtMs: stat.mtimeMs };
}

async function ensureTakeoverState(options = {}) {
  const existing = await readTakeover(options);
  if (existing) return existing;
  return prepareTakeoverScope(options);
}

async function resolveTakeoverTarget(options = {}) {
  const state = options.state || await readTakeover(options);
  const selector = String(options.selector || options.threadId || options.optionIndex || "").trim();
  const selectionOptions = Array.isArray(state?.selection?.options) ? state.selection.options : [];

  if (selector && /^\d+$/.test(selector)) {
    const option = selectionOptions.find((item) => Number(item.index) === Number(selector));
    if (option) return refreshTargetStatus(option, options);
  }
  if (options.threadId) {
    const exact = selectionOptions.find((item) => item.threadId === options.threadId);
    if (exact) return refreshTargetStatus(exact, options);
  }

  const candidates = selectionOptions.length
    ? selectionOptions
    : await listTakeoverTargets({
        ...options,
        cwd: options.cwd || state?.scope?.cwd || "",
        excludeThreadId: options.excludeThreadId || "",
      });

  if (!selector && candidates.length === 1) return refreshTargetStatus(candidates[0], options);
  if (!selector) throw new Error("Select a Codex window first.");

  const lower = selector.toLowerCase();
  const matches = candidates.filter((thread) =>
    String(thread.threadId || "").toLowerCase().startsWith(lower)
    || String(thread.threadId || "").toLowerCase() === lower
    || (thread.name && thread.name.toLowerCase().includes(lower))
  );
  if (matches.length === 1) return refreshTargetStatus(matches[0], options);
  if (matches.length > 1) throw new Error(`Takeover selector is ambiguous: ${selector}`);

  const byId = await findCodexThreadById(selector, options);
  if (byId) return refreshTargetStatus(byId, options);
  throw new Error(`No Codex window matched: ${selector}`);
}

async function resolveTakeoverProject(options = {}) {
  const state = options.state || await readTakeover(options);
  const selector = String(options.selector || options.cwd || options.projectIndex || "").trim();
  const projectOptions = Array.isArray(state?.projectSelection?.options) ? state.projectSelection.options : [];
  if (options.cwd) {
    const exact = projectOptions.find((item) => item.cwd === options.cwd);
    if (exact) return exact;
    return {
      index: 0,
      cwd: options.cwd,
      name: projectNameFromCwd(options.cwd),
      windowCount: 0,
      updatedAtMs: 0,
      latestThreadId: "",
      latestWindowName: "",
    };
  }
  if (selector && /^\d+$/.test(selector)) {
    const option = projectOptions.find((item) => Number(item.index) === Number(selector));
    if (option) return option;
  }
  const candidates = projectOptions.length ? projectOptions : await listTakeoverProjects(options);
  if (!selector && candidates.length === 1) return candidates[0];
  if (!selector) throw new Error("请先选择一个项目。");

  const lower = selector.toLowerCase();
  const matches = candidates.filter((project) =>
    String(project.cwd || "").toLowerCase() === lower
    || String(project.cwd || "").toLowerCase().includes(lower)
    || String(project.name || "").toLowerCase().includes(lower)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`项目选择不明确: ${selector}`);
  throw new Error(`没有匹配的 Codex 项目: ${selector}`);
}

async function refreshTargetStatus(target, options = {}) {
  const status = await detectSessionStatus(target.threadPath, options);
  return {
    ...target,
    status: status.status,
    statusReason: status.reason,
    lastEventAtMs: status.lastEventAtMs || target.lastEventAtMs || target.updatedAtMs || 0,
  };
}

async function writeTakeover(options, state) {
  const dataDir = resolveDataDir(options.dataDir);
  await ensureDir(dataDir);
  await fs.writeFile(takeoverFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

function emptySelection() {
  return { listedAt: "", expiresAt: "", options: [] };
}

function optionForTarget(target, index) {
  return {
    index,
    threadId: target.threadId,
    threadPath: target.threadPath || "",
    cwd: target.cwd || "",
    name: target.name || "",
    status: target.status || "unknown",
    statusReason: target.statusReason || "",
    updatedAtMs: target.updatedAtMs || 0,
    lastEventAtMs: target.lastEventAtMs || 0,
  };
}

function optionForProject(project, index) {
  return {
    index,
    cwd: project.cwd || "",
    name: project.name || projectNameFromCwd(project.cwd),
    windowCount: project.windowCount || 0,
    updatedAtMs: project.updatedAtMs || 0,
    latestThreadId: project.latestThreadId || "",
    latestWindowName: project.latestWindowName || "",
  };
}

function refreshProjectFromTargets(project, targets = []) {
  const latest = targets[0] || null;
  return {
    ...project,
    windowCount: targets.length,
    updatedAtMs: latest?.updatedAtMs || project.updatedAtMs || 0,
    latestThreadId: latest?.threadId || project.latestThreadId || "",
    latestWindowName: latest?.name || project.latestWindowName || "",
  };
}

function projectNameFromCwd(cwd) {
  const normalized = String(cwd || "").trim();
  return normalized ? path.basename(normalized) || normalized : "未知项目";
}

function mergeLarkState(previous = {}, options = {}) {
  return {
    ...(previous || {}),
    messageId: options.messageId || previous?.messageId || "",
    chatIdHash: options.chatIdHash || previous?.chatIdHash || "",
    userIdHash: options.userIdHash || previous?.userIdHash || "",
  };
}

async function readLastJsonRecord(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const length = Math.min(stat.size, 256 * 1024);
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, stat.size - length);
      const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          return JSON.parse(line);
        } catch {
          // Try the previous line.
        }
      }
      return null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

function statusFromRecord(record) {
  if (!record || record.type === "session_meta") return "";
  const payload = record.payload || {};
  const item = record.item || payload.item || payload || {};
  const typeText = [
    record.type,
    record.method,
    payload.type,
    payload.phase,
    item.type,
    item.phase,
    item.status,
  ].filter(Boolean).join(" ");

  const text = `${typeText} ${JSON.stringify({
    message: payload.message || item.message || "",
    role: item.role || payload.role || "",
  })}`;
  if (/final_answer/i.test(text)) return "idle";
  if (/turn[./_-]?completed|response[./_-]?completed/i.test(text)) return "idle";
  if (item.type === "agent_message" || item.type === "message") {
    if (item.phase === "final_answer" || payload.phase === "final_answer") return "idle";
  }
  if (RUNNING_EVENT_RE.test(text) && !FINAL_EVENT_RE.test(text)) return "running";
  return "";
}

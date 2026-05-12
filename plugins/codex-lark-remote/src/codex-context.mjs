const THREAD_ID_KEYS = new Set([
  "codexThreadId",
  "codex_thread_id",
  "currentCodexThreadId",
  "current_codex_thread_id",
  "currentThreadId",
  "current_thread_id",
  "threadId",
  "thread_id",
  "conversationId",
  "conversation_id",
]);

const SESSION_ID_KEYS = new Set([
  "codexSessionId",
  "codex_session_id",
  "sessionId",
  "session_id",
]);

const THREAD_PATH_KEYS = new Set(["threadPath", "thread_path", "sessionPath", "session_path"]);
const CWD_KEYS = new Set(["cwd", "workspaceCwd", "workspace_cwd", "projectRoot", "project_root"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_FILE_RE = /rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export function applyCodexContext(args = {}, request = {}, env = process.env) {
  const context = extractCodexContext(request, env);
  return {
    ...args,
    threadId: args.threadId || context.threadId || "",
    threadPath: args.threadPath || context.threadPath || "",
    cwd: args.cwd || context.cwd || "",
    contextSource: context.source || "",
  };
}

export function extractCodexContext(request = {}, env = process.env) {
  const envThreadId = firstString(env.CODEX_THREAD_ID, env.CODEX_SESSION_ID);
  if (looksLikeThreadId(envThreadId)) {
    return {
      threadId: envThreadId,
      threadPath: firstString(env.CODEX_THREAD_PATH, env.CODEX_SESSION_PATH),
      cwd: firstString(env.CODEX_CWD, env.PWD),
      source: "env",
    };
  }
  const envThreadPath = firstString(env.CODEX_THREAD_PATH, env.CODEX_SESSION_PATH);
  const envPathThreadId = threadIdFromPath(envThreadPath);
  if (envPathThreadId) {
    return {
      threadId: envPathThreadId,
      threadPath: envThreadPath,
      cwd: firstString(env.CODEX_CWD, env.PWD),
      source: "env.threadPath",
    };
  }

  const found = { threadId: "", threadPath: "", cwd: "", source: "" };
  visitContext(request, [], found);
  if (!found.threadId) {
    const pathThreadId = threadIdFromPath(found.threadPath);
    if (pathThreadId) {
      found.threadId = pathThreadId;
      found.source = `${found.source || "threadPath"}:derived`;
    }
  }
  return found;
}

function visitContext(value, path, found, seen = new WeakSet()) {
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (typeof child === "string") {
      if (!found.threadId && isThreadKey(key, nextPath) && looksLikeThreadId(child)) {
        found.threadId = child;
        found.source = nextPath.join(".");
      } else if (!found.threadPath && THREAD_PATH_KEYS.has(key)) {
        found.threadPath = child;
      } else if (!found.cwd && CWD_KEYS.has(key)) {
        found.cwd = child;
      }
    } else if (child && typeof child === "object") {
      visitContext(child, nextPath, found, seen);
    }
  }
}

function isThreadKey(key, path) {
  if (THREAD_ID_KEYS.has(key)) return true;
  if (!SESSION_ID_KEYS.has(key)) return false;
  return path.some((part) => /codex|thread|conversation/i.test(part));
}

function looksLikeThreadId(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function threadIdFromPath(value) {
  if (typeof value !== "string") return "";
  return value.match(SESSION_FILE_RE)?.[1] || "";
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

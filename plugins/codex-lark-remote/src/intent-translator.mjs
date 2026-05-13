import { spawn } from "node:child_process";
import { extractFinalMessage } from "./runner.mjs";

export const INTENT_NAMES = new Set([
  "system.help",
  "system.status",
  "setup.verify",
  "identity.whoami",
  "commands.show",
  "commands.hide",
  "handoff.status",
  "handoff.disable",
  "chat.forward_to_handoff",
  "takeover.list_projects",
  "takeover.select_project",
  "takeover.list_windows",
  "takeover.select_window",
  "takeover.observe_window",
  "takeover.execute",
  "takeover.cancel",
  "takeover.status",
  "observation.status",
  "observation.start",
  "observation.stop",
  "bridge.stop",
  "task.status",
  "task.cancel",
  "task.approve",
  "unknown",
  "clarify",
]);

export async function translateTextToIntent(input = {}) {
  if (typeof input.translator === "function") {
    return normalizeIntent(await input.translator(input), input);
  }
  const config = input.config || {};
  if (config.intent?.enabled === false) return unknownIntent("intent disabled");
  const mode = config.intent?.mode || "hybrid";
  const provider = config.intent?.translator?.provider || "codex-thread";
  if (mode === "rules" || provider === "rules") return unknownIntent("rules did not match");
  return translateWithCodex(input);
}

export function normalizeIntent(value, input = {}) {
  const parsed = typeof value === "string" ? parseIntentJson(value) : value;
  const intent = String(parsed?.intent || "").trim();
  if (!INTENT_NAMES.has(intent)) return unknownIntent("translator returned unknown intent");
  const confidence = clampConfidence(parsed?.confidence);
  const minConfidence = Number(input.config?.intent?.translator?.minConfidence ?? 0.75);
  if (intent !== "unknown" && intent !== "clarify" && confidence < minConfidence) {
    return {
      schemaVersion: 1,
      intent: "clarify",
      args: {},
      confidence,
      needsConfirmation: false,
      reason: parsed?.reason || "translator confidence is too low",
    };
  }
  return {
    schemaVersion: 1,
    intent,
    args: normalizeArgs(parsed?.args),
    confidence,
    needsConfirmation: parsed?.needsConfirmation === true,
    reason: String(parsed?.reason || "").slice(0, 300),
  };
}

export function parseIntentJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function translateWithCodex(input = {}) {
  const config = input.config || {};
  const runner = config.runner || {};
  const translator = config.intent?.translator || {};
  const timeoutMs = Number(translator.timeoutMs || 15000);
  const prompt = buildCodexIntentPrompt(input);
  const args = ["exec", "--json"];
  if (runner.ignoreUserConfig !== false) args.push("--ignore-user-config");
  args.push("--sandbox", translator.sandbox || "read-only");
  const cwd = input.context?.cwd || input.context?.activeHandoff?.cwd || "";
  if (cwd) args.push("-C", cwd);
  if (runner.model) args.push("-m", runner.model);
  args.push(prompt);

  try {
    const result = await runProcess(runner.codexPath || "codex", args, { timeoutMs, cwd: cwd || undefined });
    if (result.exitCode !== 0) return unknownIntent(`codex translator failed: ${result.stderrTail || result.exitCode}`);
    return normalizeIntent(extractFinalMessage(result.stdout) || result.stdoutTail, input);
  } catch (error) {
    return unknownIntent(error.message || "codex translator failed");
  }
}

function buildCodexIntentPrompt(input = {}) {
  return [
    "You are the intent translator for Codex Lark Remote.",
    "Translate the Feishu/Lark user message into exactly one JSON object.",
    "Do not execute tasks. Do not edit files. Do not call tools. Do not write Markdown.",
    "Use only these intent names:",
    Array.from(INTENT_NAMES).filter((name) => !["unknown"].includes(name)).join(", "),
    "",
    "Required JSON shape:",
    '{"schemaVersion":1,"intent":"takeover.list_projects","args":{},"confidence":0.9,"needsConfirmation":false,"reason":"short reason"}',
    "",
    "Rules:",
    "- If the message is ambiguous, use intent clarify.",
    "- If no intent fits, use intent unknown.",
    "- Never invent project ids, thread ids, or option numbers.",
    "- Selectors must refer to the provided context, such as current option index, thread prefix, or last selected window.",
    "- High impact actions such as takeover.execute, handoff.disable, and bridge.stop should set needsConfirmation true.",
    "",
    "Context JSON:",
    JSON.stringify(sanitizeContext(input.context || {}), null, 2),
    "",
    "User message:",
    String(input.text || ""),
  ].join("\n");
}

function sanitizeContext(context = {}) {
  return {
    mode: context.mode || "console",
    cwd: context.cwd || "",
    activeHandoff: context.activeHandoff || null,
    takeover: context.takeover || null,
  };
}

function normalizeArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args).filter(([, value]) =>
    ["string", "number", "boolean"].includes(typeof value) || value === null
  ));
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function unknownIntent(reason) {
  return {
    schemaVersion: 1,
    intent: "unknown",
    args: {},
    confidence: 0,
    needsConfirmation: false,
    reason: String(reason || "unknown").slice(0, 300),
  };
}

async function runProcess(command, args, { timeoutMs, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, Number(timeoutMs || 15000));
    timer.unref?.();

    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout,
        stderr,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    };

    child.stdout?.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      stderr = appendLimited(stderr, error.message);
      finish(1);
    });
    child.on("close", (code) => finish(typeof code === "number" ? code : 1));
  });
}

function appendLimited(existing, next, limit = 256 * 1024) {
  const combined = `${existing || ""}${next || ""}`;
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}

function tail(text, limit = 4000) {
  const value = String(text || "");
  return value.length > limit ? value.slice(value.length - limit) : value;
}

import { truncateForLark } from "./notifier.mjs";

export function formatHelp() {
  return [
    "Codex Lark Remote",
    "",
    "Examples:",
    "Ask Codex anything from Feishu/Lark.",
    "Plain language controls: 状态, 我是谁, 接管状态, 断开连接吧.",
    "Task controls: 查看任务 rcmd_..., 看改动 rcmd_..., 取消任务 rcmd_..., 批准提交 rcmd_...",
    "/codex whoami",
    "/codex status",
    "/codex observe",
    "/codex observe <number|thread-prefix>",
    "/codex observe off",
    "/codex commands on|off",
    "/codex handoff off",
  ].join("\n");
}

export function formatWhoami(event) {
  return [
    "Codex Lark Remote whoami",
    `senderIdType: ${event.senderIdType || "unknown"}`,
    `senderId: ${event.senderId || "unknown"}`,
    event.openId && event.openId !== event.senderId ? `openId: ${event.openId}` : "",
    event.unionId ? `unionId: ${event.unionId}` : "",
    `userHash: ${event.userIdHash || "-"}`,
    "",
    "Add senderId to lark.allowedUsers.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatBridgeStatus({ config, counts, workerBusy, url, larkWs, handoff, observation, keepAwake }) {
  const transport = config.lark?.transport || "websocket";
  return [
    "Codex Lark Remote status",
    `Bridge: ${url || "running"}`,
    `Feishu/Lark: ${formatLarkTransport({ transport, larkWs })}`,
    `Conversation: ${formatHandoffState(handoff)}`,
    `Observation: ${formatObservationState(observation)}`,
    `Command display: ${formatCommandDisplay(config.handoff?.showCommands)}`,
    `Mac keep-awake: ${formatKeepAwake(keepAwake)}`,
    `Pending replies: ${formatCounts(counts)}`,
    `Codex worker: ${workerBusy ? "busy" : "idle"}`,
  ].join("\n");
}

export function formatObservationList(targets = [], observation = null) {
  if (!targets.length) return "No observable Codex sessions found.";
  return [
    "Observable Codex sessions",
    ...targets.map((thread, index) => [
      `${index + 1}. ${thread.name || "Untitled Codex chat"}`,
      `   Thread: ${String(thread.threadId).slice(0, 8)}`,
      thread.cwd ? `   Cwd: ${thread.cwd}` : "",
      thread.updatedAtMs ? `   Updated: ${new Date(thread.updatedAtMs).toLocaleString()}` : "",
    ].filter(Boolean).join("\n")),
    "",
    "Use /codex observe <number or thread prefix> to stream that session.",
    observation?.active ? "Use /codex observe off to stop the current observation." : "",
  ].filter(Boolean).join("\n");
}

export function formatObservationStatus(observation) {
  if (!observation?.active) return "Codex Lark Remote observation: off";
  return [
    "Codex Lark Remote observation: active",
    observation.name ? `Title: ${observation.name}` : "",
    `Thread: ${String(observation.threadId || "").slice(0, 8) || "unknown"}`,
    observation.cwd ? `Cwd: ${observation.cwd}` : "",
    "This is read-only progress streaming. Feishu/Lark messages are not sent to the observed session.",
    "Use /codex observe off to stop.",
  ].filter(Boolean).join("\n");
}

export function formatTask(command) {
  if (!command) return "Task not found.";
  return [
    `Task: ${command.id}`,
    `Status: ${command.status}`,
    command.mode === "thread_handoff" ? "Conversation: current Codex chat" : "",
    command.presentation ? `Presentation: ${command.presentation}` : "",
    command.codexSessionId ? `Thread: ${command.codexSessionId}` : "",
    command.mode === "thread_handoff" ? "" : `Repo: ${command.repoKey || "-"}`,
    command.branchName ? `Branch: ${command.branchName}` : "",
    command.worktreePath ? `Worktree: ${command.worktreePath}` : "",
    command.diffSummary ? `Diff:\n${command.diffSummary}` : "",
    command.testSummary ? `Validation:\n${command.testSummary}` : "",
    command.progressSummary ? `Agent progress:\n${truncateForLark(command.progressSummary, 1200)}` : "",
    command.error ? `Error:\n${command.error}` : "",
    command.lastNotifyError ? `Last notify error:\n${command.lastNotifyError}` : "",
    command.result ? `Result:\n${truncateForLark(command.result, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatQueued(command) {
  if (command.mode === "thread_handoff") {
    return [
      "Codex received your message.",
      "Status: queued",
      "",
      `Request: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
    ].join("\n");
  }
  return [
    `Task created: ${command.id}`,
    `Repo: ${command.repoKey}`,
    "Status: queued",
    "",
    `Request: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
  ].join("\n");
}

export function formatGuidanceQueued(command) {
  return [
    "已收到补充引导。",
    "当前 Codex 还在执行时，无法稳定热注入这条消息；我会在当前轮结束后立刻把它作为下一条引导继续同一个对话。",
    "",
    `补充: ${truncateForLark(command.normalizedTask || command.prompt, 500)}`,
  ].join("\n");
}

export function formatFinal(command) {
  if (command.status === "failed") {
    return [
      `Task failed: ${command.id}`,
      command.error || "Unknown error.",
      command.progressSummary ? `\nAgent progress:\n${truncateForLark(command.progressSummary, 1200)}` : "",
      "",
      `Use /codex status ${command.id} for details.`,
    ].join("\n");
  }
  if (command.mode === "thread_handoff") {
    if (command.presentation === "chat" && command.status === "completed") {
      return command.result || "Codex finished.";
    }
    return [
      `Codex message ${command.status}: ${command.id}`,
      `Thread: ${command.codexSessionId || "-"}`,
      "",
      "Summary:",
      truncateForLark(command.result || "Codex finished.", 1600),
      "",
      command.diffSummary ? `Files changed:\n${command.diffSummary}` : "Files changed: none",
      "",
      `Use /codex status ${command.id} for details.`,
    ].join("\n");
  }
  return [
    `Task ${command.status}: ${command.id}`,
    "",
    "Summary:",
    truncateForLark(command.result || "Codex finished.", 1200),
    "",
    command.diffSummary ? `Files changed:\n${command.diffSummary}` : "Files changed: none",
    command.testSummary ? `Validation:\n${command.testSummary}` : "Validation: not run",
    "",
    "Next actions:",
    `/codex diff ${command.id}`,
    `/codex approve ${command.id} test`,
    `/codex approve ${command.id} commit`,
    `/codex cancel ${command.id}`,
  ].join("\n");
}

export function formatProgress(command, text) {
  return String(text || "").trim() || "Codex is working.";
}

function formatCounts(counts = {}) {
  const keys = ["pending", "running", "waiting_review", "completed", "failed", "timeout", "cancelled"];
  return keys.map((key) => `${key}=${counts[key] || 0}`).join(" ");
}

function formatLarkTransport({ transport, larkWs }) {
  if (transport === "webhook") return "webhook";
  if (!larkWs?.enabled) return "websocket disabled";
  if (larkWs.connected) return "websocket connected";
  if (larkWs.starting) return "websocket connecting";
  return `websocket ${larkWs.message || "not connected"}`;
}

function formatHandoffState(handoff) {
  if (!handoff?.active) return "not attached";
  const thread = handoff.threadId ? handoff.threadId.slice(0, 8) : "unknown";
  const name = handoff.name ? ` ${handoff.name}` : "";
  return `attached ${thread}${name}`;
}

function formatObservationState(observation) {
  if (!observation?.active) return "off";
  const thread = observation.threadId ? observation.threadId.slice(0, 8) : "unknown";
  const name = observation.name ? ` ${observation.name}` : "";
  return `streaming ${thread}${name}`;
}

function formatCommandDisplay(showCommands) {
  return showCommands === true ? "on" : "off (risky only)";
}

function formatKeepAwake(keepAwake) {
  if (!keepAwake) return "unknown";
  if (!keepAwake.enabled) return "disabled";
  if (keepAwake.active) return keepAwake.pid ? `active pid=${keepAwake.pid}` : "active";
  if (keepAwake.platform && keepAwake.platform !== "darwin") return "macOS only";
  if (keepAwake.lastError) return `failed ${keepAwake.lastError}`;
  return "idle";
}

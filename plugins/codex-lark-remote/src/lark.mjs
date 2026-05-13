import { parseCsv, shortHash } from "./config.mjs";
import { parseControlSemanticAction } from "./control-semantics.mjs";

const COMMAND_ID_RE = /\b(rcmd_[a-z0-9]+_[a-z0-9]+)\b/i;
const MANAGEMENT_ACTIONS = new Set([
  "help",
  "whoami",
  "status",
  "verify",
  "verification",
  "验证",
  "验证配置",
  "command",
  "commands",
  "show-commands",
  "handoff",
  "bridge",
  "connection",
  "observe",
  "observer",
  "watch",
  "projects",
  "project",
  "项目",
  "takeover",
  "windows",
  "window",
  "窗口",
  "接管",
  "diff",
  "cancel",
  "approve",
]);

export function parseLarkEvent(body) {
  if (body?.type === "url_verification" || body?.challenge) {
    return { kind: "url_verification", challenge: body.challenge };
  }
  const cardAction = parseLarkCardAction(body);
  if (cardAction) return cardAction;

  const event = body?.event || body;
  const message = event?.message || body?.message || {};
  const sender = event?.sender || body?.sender || {};
  const senderIds = sender?.sender_id || {};
  const senderId = senderIds.user_id || senderIds.open_id || "";
  const senderIdType = senderIds.user_id ? "user_id" : senderIds.open_id ? "open_id" : "";
  const messageType = message.message_type || "";
  const messageId = message.message_id || "";
  const chatId = message.chat_id || "";

  let text = "";
  if (messageType === "text" || message.content) {
    try {
      const content = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
      text = String(content?.text || "").trim();
    } catch {
      text = "";
    }
  }
  text = normalizeText(text);

  return {
    kind: "message",
    messageType,
    messageId,
    chatId,
    senderId,
    senderIdType,
    openId: senderIds.open_id || "",
    unionId: senderIds.union_id || "",
    senderName: senderId || "lark_user",
    text,
    chatIdHash: chatId ? `c_${shortHash(chatId)}` : "",
    userIdHash: senderId ? `u_${shortHash(senderId)}` : "",
  };
}

export function parseLarkCardAction(body) {
  const eventType = body?.header?.event_type || body?.event_type || body?.type || "";
  const event = body?.event || body;
  const rawAction = event?.action || body?.action || {};
  const value = normalizeCardActionValue(rawAction.value || rawAction);
  const actionName = String(value.action || value.kind || rawAction.name || rawAction.tag || "").trim();
  const looksLikeCardAction = eventType === "card.action.trigger" || Boolean(actionName && (event?.action || body?.action));
  if (!looksLikeCardAction) return null;

  const operatorIds = event?.operator?.operator_id || event?.operator_id || event?.sender?.sender_id || event?.operator || event?.user_id || {};
  const operatorUserId = pickId(operatorIds, "user");
  const operatorOpenId = pickId(operatorIds, "open");
  const operatorUnionId = pickId(operatorIds, "union");
  const eventUserId = typeof event?.user_id === "string" ? event.user_id : "";
  const eventOpenId = typeof event?.open_id === "string" ? event.open_id : "";
  const eventUnionId = typeof event?.union_id === "string" ? event.union_id : "";
  const senderId = operatorUserId || operatorOpenId || eventUserId || eventOpenId || "";
  const context = event?.context || body?.context || {};
  const messageId = context.open_message_id || context.message_id || event?.open_message_id || event?.messageId || event?.message_id || body?.message_id || "";
  const chatId = context.open_chat_id || context.chat_id || event?.open_chat_id || event?.chatId || event?.chat_id || "";

  return {
    kind: "card_action",
    action: actionName,
    value,
    messageId,
    actionMessageId: event?.action_id || value.actionId || "",
    chatId,
    senderId,
    senderIdType: operatorUserId || eventUserId ? "user_id" : operatorOpenId || eventOpenId ? "open_id" : operatorUnionId || eventUnionId ? "union_id" : "",
    openId: operatorOpenId || eventOpenId || "",
    unionId: operatorUnionId || eventUnionId || "",
    senderName: senderId || "lark_user",
    chatIdHash: chatId ? `c_${shortHash(chatId)}` : "",
    userIdHash: senderId ? `u_${shortHash(senderId)}` : "",
    token: event?.token || body?.token || "",
  };
}

function pickId(value, kind) {
  if (!value || typeof value !== "object") return "";
  const keys = kind === "user"
    ? ["user_id", "userId"]
    : kind === "open"
      ? ["open_id", "openId"]
      : ["union_id", "unionId"];
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  return "";
}

export function isUserAllowed(senderId, config = {}) {
  const allowed = configuredAllowedUsers(config);
  if (allowed.length === 0) return true;
  return userIdCandidates(senderId).some((id) => allowed.includes(id));
}

function userIdCandidates(value) {
  if (Array.isArray(value)) return value.flatMap((item) => userIdCandidates(item));
  if (value && typeof value === "object") {
    return [
      value.senderId,
      value.userId,
      value.openId,
      value.unionId,
      value.sender?.sender_id?.user_id,
      value.sender?.sender_id?.open_id,
      value.sender?.sender_id?.union_id,
      value.operator?.operator_id?.user_id,
      value.operator?.operator_id?.open_id,
      value.operator?.operator_id?.union_id,
      value.operator?.user_id,
      value.operator?.open_id,
      value.operator?.union_id,
      value.operator?.userId,
      value.operator?.openId,
      value.operator?.unionId,
    ].map((item) => String(item || "").trim()).filter(Boolean);
  }
  const id = String(value || "").trim();
  return id ? [id] : [];
}

export function configuredAllowedUsers(config = {}) {
  const configured = config.lark?.allowedUsers ?? process.env.CODEX_LARK_ALLOWED_USERS;
  if (Array.isArray(configured)) {
    return configured.map((item) => String(item).trim()).filter(Boolean);
  }
  return parseCsv(configured);
}

export function classifyChatText(text, config) {
  const trimmed = normalizeText(text);
  if (!trimmed) return { kind: "empty" };

  const command = parseManagementCommand(trimmed);
  if (command) return command;
  const naturalCommand = parseNaturalManagementCommand(trimmed);
  if (naturalCommand) return naturalCommand;

  if (trimmed.startsWith("$")) {
    return {
      kind: "rejected",
      reason: "Shell commands are not enabled in the first version. Send a coding request instead.",
    };
  }

  const forced = trimmed.startsWith(">");
  const withoutPrefix = forced ? normalizeText(trimmed.slice(1)) : trimmed;
  const { repoKey, taskText } = parseRepoPrefix(withoutPrefix, config);
  if (!taskText) return { kind: "empty" };
  return {
    kind: "task",
    forced,
    repoKey,
    taskText,
  };
}

export function normalizeText(text) {
  return String(text || "")
    .replace(/@_user_\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseManagementCommand(text) {
  const slashMatch = text.match(/^\/codex(?:\s+(.+))?$/i);
  const candidate = slashMatch ? normalizeText(slashMatch[1] || "help") : normalizeText(text);
  const firstToken = String(candidate.split(/\s+/)[0] || "").toLowerCase();
  if (!slashMatch && !MANAGEMENT_ACTIONS.has(firstToken)) return null;
  const rest = candidate || "help";
  const [action, id, subAction] = rest.split(/\s+/);
  if (!action || action === "help") return { kind: "help" };
  if (action === "whoami") return { kind: "whoami" };
  if (action === "status") return id ? { kind: "task_status", id } : { kind: "status" };
  if (["verify", "verification", "验证", "验证配置"].includes(action)) return { kind: "setup_verify" };
  if (["command", "commands", "show-commands"].includes(action)) {
    if (["on", "enable", "enabled", "show", "true"].includes(id)) return { kind: "command_visibility", enabled: true };
    if (["off", "disable", "disabled", "hide", "false"].includes(id)) return { kind: "command_visibility", enabled: false };
    return { kind: "command_visibility" };
  }
  if (action === "handoff") {
    if (["off", "stop", "disable", "end", "close", "disconnect"].includes(id)) return { kind: "handoff_disable" };
    return { kind: "handoff_status" };
  }
  if (["bridge", "connection"].includes(action)) {
    if (["off", "stop", "disable", "end", "close", "disconnect", "关闭", "停止", "断开"].includes(id)) return { kind: "bridge_stop_confirm" };
    return { kind: "status" };
  }
  if (["observe", "observer", "watch"].includes(action)) {
    if (!id || ["list", "status", "列表", "查看", "窗口", "会话"].includes(id)) return { kind: "observe_list" };
    if (["off", "stop", "disable", "end", "close", "关闭", "停止", "结束"].includes(id)) return { kind: "observe_disable" };
    if (["session", "sessions", "chat", "chats", "window", "windows"].includes(id) && subAction) {
      return { kind: "observe_enable", selector: subAction };
    }
    return { kind: "observe_enable", selector: id };
  }
  if (["projects", "project", "项目"].includes(action)) {
    if (!id || ["list", "status", "列表", "项目"].includes(id)) return { kind: "takeover_list" };
    return { kind: "takeover_project_select", selector: id };
  }
  if (["takeover", "windows", "window", "窗口", "接管"].includes(action)) {
    if (!id || ["list", "status", "列表", "窗口", "windows"].includes(id)) {
      return id === "status" ? { kind: "takeover_status" } : { kind: "takeover_list" };
    }
    if (["off", "stop", "disable", "end", "close", "关闭", "停止", "结束", "cancel"].includes(id)) {
      return { kind: "takeover_disable" };
    }
    if (["now", "execute", "confirm", "接管", "确认", "执行"].includes(id)) {
      return { kind: "takeover_execute" };
    }
    if (!slashMatch && action === "takeover" && id && !subAction) {
      return { kind: "takeover_execute", selector: id };
    }
    if (action === "接管" && id && !subAction) {
      return { kind: "takeover_execute", selector: id };
    }
    if (["now", "execute", "confirm"].includes(subAction)) {
      return { kind: "takeover_execute", selector: id };
    }
    return { kind: "takeover_select", selector: id };
  }
  if (action === "diff" && id) return { kind: "task_diff", id };
  if (action === "cancel" && id) return { kind: "cancel", id };
  if (action === "approve" && id && subAction) return { kind: "approve", id, action: subAction };
  return { kind: "help" };
}

function parseNaturalManagementCommand(text) {
  const normalized = normalizeText(text).toLowerCase();
  const semanticAction = parseControlSemanticAction(normalized, { mode: "global" });
  if (semanticAction) return semanticAction;

  const id = extractCommandId(normalized);

  if (/^(验证配置|验证飞书配置|检查配置|检查飞书配置|测试配置|测试飞书配置|verify setup|verify config|check setup|check config)[。.?？!！]?$/.test(normalized)) {
    return { kind: "setup_verify" };
  }

  if (id) {
    const approvalAction = parseNaturalApprovalAction(normalized);
    if (approvalAction) return { kind: "approve", id, action: approvalAction };
    if (/(取消|停止|终止|删掉|删除).*(任务|task|rcmd)|^(取消|停止|终止)/.test(normalized)) return { kind: "cancel", id };
    if (/(diff|改动|变更|修改|变化)/.test(normalized)) return { kind: "task_diff", id };
    if (/(状态|进度|详情|结果|查看|看看|看一下|查一下|task)/.test(normalized)) return { kind: "task_status", id };
  }
  return null;
}

function extractCommandId(text) {
  return text.match(COMMAND_ID_RE)?.[1] || "";
}

function parseNaturalApprovalAction(text) {
  if (!/(批准|通过|同意|允许|approve)/.test(text)) return "";
  if (/\bpush\b|推送|发布/.test(text)) return "push";
  if (/\bcommit\b|提交/.test(text)) return "commit";
  if (/\btest\b|测试|跑测试/.test(text)) return "test";
  if (/\breview\b|审查|审核|确认/.test(text)) return "review";
  return "";
}

function parseRepoPrefix(text, config) {
  const match = text.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (match) {
    return { repoKey: match[1].trim(), taskText: match[2].trim() };
  }
  return { repoKey: config.defaultRepo || Object.keys(config.repos || {})[0] || "", taskText: text };
}

function normalizeCardActionValue(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { action: value };
    }
  }
  if (typeof value === "object") return value;
  return { action: String(value) };
}

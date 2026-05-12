import { parseCsv, shortHash } from "./config.mjs";

const COMMAND_ID_RE = /\b(rcmd_[a-z0-9]+_[a-z0-9]+)\b/i;

export function parseLarkEvent(body) {
  if (body?.type === "url_verification" || body?.challenge) {
    return { kind: "url_verification", challenge: body.challenge };
  }

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

export function isUserAllowed(senderId, config = {}) {
  const allowed = configuredAllowedUsers(config);
  if (allowed.length === 0) return true;
  return allowed.includes(senderId);
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
  const match = text.match(/^\/codex(?:\s+(.+))?$/i);
  if (!match) return null;
  const rest = normalizeText(match[1] || "help");
  const [action, id, subAction] = rest.split(/\s+/);
  if (!action || action === "help") return { kind: "help" };
  if (action === "whoami") return { kind: "whoami" };
  if (action === "status") return id ? { kind: "task_status", id } : { kind: "status" };
  if (["command", "commands", "show-commands"].includes(action)) {
    if (["on", "enable", "enabled", "show", "true"].includes(id)) return { kind: "command_visibility", enabled: true };
    if (["off", "disable", "disabled", "hide", "false"].includes(id)) return { kind: "command_visibility", enabled: false };
    return { kind: "command_visibility" };
  }
  if (action === "handoff") {
    if (["off", "stop", "disable", "end", "close", "disconnect"].includes(id)) return { kind: "handoff_disable" };
    return { kind: "handoff_status" };
  }
  if (["observe", "observer", "watch"].includes(action)) {
    if (!id || ["list", "status", "列表", "查看", "窗口", "会话"].includes(id)) return { kind: "observe_list" };
    if (["off", "stop", "disable", "end", "close", "关闭", "停止", "结束"].includes(id)) return { kind: "observe_disable" };
    return { kind: "observe_enable", selector: id };
  }
  if (action === "diff" && id) return { kind: "task_diff", id };
  if (action === "cancel" && id) return { kind: "cancel", id };
  if (action === "approve" && id && subAction) return { kind: "approve", id, action: subAction };
  return { kind: "help" };
}

function parseNaturalManagementCommand(text) {
  const normalized = normalizeText(text).toLowerCase();
  const id = extractCommandId(normalized);

  if (/^(帮助|使用帮助|怎么用|如何使用|有哪些命令|命令列表|指令列表|可用命令|help|usage)[。.!！]?$/.test(normalized)) return { kind: "help" };
  if (/^(我是谁|我的id|我的 id|查看我的id|查看我的 id|获取我的id|获取我的 id|我的用户id|我的用户 id|查我身份|whoami)[。.!！]?$/.test(normalized)) {
    return { kind: "whoami" };
  }

  if (/^(状态|查看状态|看下状态|看看状态|现在状态|当前状态|连接状态|插件状态|飞书状态|lark状态|lark status|status|进度|查看进度|看下进度|看看进度|当前进度|现在进度|执行到哪了|进行到哪了|还在跑吗|还在工作吗|还活着吗|跑着吗|连接正常吗|在干嘛|现在在干嘛|现在干嘛呢)[。.?？!！]?$/.test(normalized)) {
    return { kind: "status" };
  }
  if (/^(接管状态|查看接管|看下接管|当前接管|是否接管|接管了吗|还在接管吗|接管还在吗|飞书接管状态|远程接管状态|handoff status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "handoff_status" };
  }
  if (/^(观察列表|查看观察|可观察窗口|可观察会话|有哪些窗口|看看有哪些窗口|列出窗口|列出会话|观察哪些窗口|可以观察哪些|observe|observe list|watch list)[。.?？!！]?$/.test(normalized)) {
    return { kind: "observe_list" };
  }
  const observeSelector = parseNaturalObserveSelector(normalized);
  if (observeSelector) return { kind: "observe_enable", selector: observeSelector };
  if (/^(关闭|关掉|停止|结束|退出)(观察|观察模式|串流|串流观察|观察串流|watch|observe)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(继续)?(观察|看|串流|串流观察|观察串流)了?[。.!！]?$/.test(normalized)
    || /^(别看了|不看了)[。.!！]?$/.test(normalized)) {
    return { kind: "observe_disable" };
  }

  if (/^(命令显示状态|查看命令显示|commands status|command status|show commands status)[。.?？!！]?$/.test(normalized)) {
    return { kind: "command_visibility" };
  }
  if (/^(打开|开启|启用|显示|展示|展开)(命令|命令显示|详细命令|终端输出|命令输出|日志|详细日志|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(commands on|command on|show commands|show commands on|enable commands|show logs)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: true };
  }
  if (/^(关闭|关掉|停止|禁用|隐藏|收起)(命令|命令显示|详细命令|终端输出|命令输出|日志|详细日志|command display|commands|show commands)吧?[。.!！]?$/.test(normalized)
    || /^(不要|别)(再)?(显示|展示|发|刷)?(命令|命令显示|日志|输出)了?[。.!！]?$/.test(normalized)
    || /^(别刷命令了|别刷屏了|太吵了)[。.!！]?$/.test(normalized)
    || /^(commands off|command off|hide commands|disable commands|hide logs)[。.!！]?$/.test(normalized)) {
    return { kind: "command_visibility", enabled: false };
  }

  if (/^断开(连接|接管|远程|飞书)?吧?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };
  if (/^(关闭|关掉|停止|暂停|结束|退出)(连接|接管|远程|远程接管|飞书|飞书接管|插件|机器人|lark remote|codex lark remote)吧?[。.!！]?$/.test(normalized)) {
    return { kind: "handoff_disable" };
  }
  if (/^(不要|别)(继续|再)?(接管|远程接管|飞书接管|连着|连接)了?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };
  if (/^(停止|暂停|关闭|关掉|退出|结束|断开)吧?[。.!！]?$/.test(normalized)) return { kind: "handoff_disable" };

  if (id) {
    const approvalAction = parseNaturalApprovalAction(normalized);
    if (approvalAction) return { kind: "approve", id, action: approvalAction };
    if (/(取消|停止|终止|删掉|删除).*(任务|task|rcmd)|^(取消|停止|终止)/.test(normalized)) return { kind: "cancel", id };
    if (/(diff|改动|变更|修改|变化)/.test(normalized)) return { kind: "task_diff", id };
    if (/(状态|进度|详情|结果|查看|看看|看一下|查一下|task)/.test(normalized)) return { kind: "task_status", id };
  }
  return null;
}

function parseNaturalObserveSelector(normalized) {
  const match = normalized.match(/^(?:开始|打开|开启|启用|切到|看|看看|观察|串流|跟踪|盯一下)?(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*(?:个)?(?:窗口|会话|session|chat)?(?:的)?(?:观察|串流|进度)?吧?[。.!！]?$/);
  if (!match) return "";
  return chineseNumberToAscii(match[1]);
}

function chineseNumberToAscii(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) return text;
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return "10";
  if (text.startsWith("十")) return String(10 + (map[text.slice(1)] || 0));
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return String((map[tens] || 1) * 10 + (map[ones] || 0));
  }
  return map[text] ? String(map[text]) : text;
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

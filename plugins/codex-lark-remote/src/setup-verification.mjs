import { loadConfig } from "./config.mjs";
import { larkWebSocketEnabled } from "./lark-ws.mjs";
import { configuredAllowedUsers } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import { hasLarkAppCredentials } from "./setup-guide.mjs";
import { bridgeStatus, startBridgeProcess } from "./supervisor.mjs";

export async function verifyLarkSetup(options = {}) {
  const config = await (options.loadConfig || loadConfig)(options);
  const appCredentialsConfigured = hasLarkAppCredentials(config);
  let auth = null;
  let start = null;
  let status = null;

  if (appCredentialsConfigured && options.checkAuth !== false) {
    auth = await (options.checkAuth || defaultCheckAuth)(config);
  }

  if (appCredentialsConfigured && options.startBridge !== false) {
    start = await (options.startBridgeProcess || startBridgeProcess)(options);
  }

  status = await (options.bridgeStatus || bridgeStatus)(options);

  return buildLarkSetupVerificationReport({ config, status, auth, start });
}

export function buildLarkSetupVerificationReport({ config = {}, status = {}, auth = null, start = null } = {}) {
  const larkWs = status.data?.larkWs || start?.data?.larkWs || null;
  const webSocketEnabled = larkWebSocketEnabled(config);
  const appCredentialsConfigured = hasLarkAppCredentials(config);
  const appCredentialsValid = auth ? auth.ok === true : null;
  const bridgeRunning = Boolean(status.running);
  const webSocketConnected = Boolean(larkWs?.connected);
  const messageEventReceived = Boolean(larkWs?.lastMessageEventAt);
  const cardCallbackReceived = Boolean(larkWs?.lastCardActionAt);
  const registeredEvents = Array.isArray(larkWs?.registeredEvents) ? larkWs.registeredEvents : [];

  const checks = {
    appCredentialsConfigured,
    appCredentialsValid,
    bridgeRunning,
    webSocketEnabled,
    webSocketConnected,
    eventLongConnectionReady: webSocketEnabled && webSocketConnected,
    callbackLongConnectionReady: webSocketEnabled && webSocketConnected,
    messageEventReceived,
    cardCallbackReceived,
    allowedUsersConfigured: configuredAllowedUsers(config).length > 0,
  };

  return {
    ok: Boolean(appCredentialsConfigured && appCredentialsValid !== false && bridgeRunning && (!webSocketEnabled || webSocketConnected)),
    checks,
    auth: sanitizeAuth(auth),
    lark: {
      transport: config.lark?.transport || "websocket",
      appIdPrefix: config.lark?.appId ? `${config.lark.appId.slice(0, 8)}...` : "",
      allowedUsersCount: configuredAllowedUsers(config).length,
    },
    bridge: {
      running: bridgeRunning,
      message: status.message || start?.message || "",
      localUrl: status.state?.url || "",
      larkWs,
    },
    required: {
      event: "im.message.receive_v1",
      callback: "card.action.trigger",
      registeredEvents,
    },
    nextActions: buildVerificationNextActions({ checks, auth, larkWs }),
  };
}

function buildVerificationNextActions({ checks, auth, larkWs }) {
  const actions = [];
  if (!checks.appCredentialsConfigured) {
    actions.push("把 App ID 和 App Secret 复制到剪贴板，然后回到 Codex 说“已复制”。");
    return actions;
  }
  if (auth && !auth.ok) {
    actions.push("App ID/App Secret 鉴权失败，请重新从“凭证与基础信息”复制后保存。");
    return actions;
  }
  if (!checks.bridgeRunning) {
    actions.push("先在 Codex 启动 Lark Remote bridge，再回到飞书后台验证长连接。");
    return actions;
  }
  if (checks.webSocketEnabled && !checks.webSocketConnected) {
    actions.push(`长连接还没连上：${larkWs?.message || "not connected"}。保持本机网络可访问 open.feishu.cn 后重试。`);
    return actions;
  }
  if (checks.webSocketConnected) {
    actions.push("先去飞书后台完成事件配置：选择“使用长连接接收”，添加 im.message.receive_v1，然后点击验证/保存。");
    actions.push("再完成回调配置：选择“使用长连接接收”，添加 card.action.trigger，然后点击验证/保存。");
    actions.push("两个后台配置都验证通过并发布后，先回到 Codex 明确同意连接当前会话到 Lark Remote。");
    actions.push("Codex 确认连接生效后，再给机器人发送 whoami；能收到回复就说明消息事件已打通。");
    actions.push("连接生效并看到插件发出的卡片后，点击卡片按钮或“刷新验证”；能收到更新就说明卡片回调已打通。");
  }
  if (checks.webSocketConnected && checks.messageEventReceived && checks.cardCallbackReceived) {
    actions.push("消息事件和卡片回调都已经被插件实际收到。");
  }
  if (!checks.allowedUsersConfigured) {
    actions.push("最后把 whoami 返回的 senderId 加入 lark.allowedUsers，再使用项目/会话接管。");
  }
  return actions;
}

async function defaultCheckAuth(config) {
  return new LarkNotifier(config.lark || {}).checkAuth();
}

function sanitizeAuth(auth) {
  if (!auth) return null;
  return {
    ok: auth.ok === true,
    hasCredentials: auth.hasCredentials === true,
    appIdPrefix: auth.appIdPrefix || "",
    message: auth.message || auth.error || "",
  };
}

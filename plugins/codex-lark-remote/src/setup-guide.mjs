export const FEISHU_OPEN_PLATFORM_URL = "https://open.feishu.cn/";
export const LARK_OPEN_PLATFORM_URL = "https://open.larksuite.com/";

export function hasLarkAppCredentials(config = {}) {
  return Boolean(config.lark?.appId && config.lark?.appSecret);
}

export function assertLarkAppCredentials(config = {}) {
  if (hasLarkAppCredentials(config)) return;
  throw new Error(formatMissingLarkCredentials(config));
}

export function formatMissingLarkCredentials(config = {}) {
  const missing = [];
  if (!config.lark?.appId) missing.push("appId");
  if (!config.lark?.appSecret) missing.push("appSecret");
  return [
    "Codex Lark Remote is not started",
    `Reason: missing Feishu/Lark ${missing.join(" and ") || "app credentials"}.`,
    config.configPath ? `Config: ${config.configPath}` : "",
    "",
    "Create a Feishu/Lark app first:",
    `1. Feishu: ${FEISHU_OPEN_PLATFORM_URL} or Lark: ${LARK_OPEN_PLATFORM_URL}`,
    "2. Create an internal/custom app.",
    "3. Enable the bot capability.",
    "4. In Credentials & Basic Info, copy App ID and App Secret.",
    "5. In Event Subscriptions, choose long connection/WebSocket and subscribe to im.message.receive_v1.",
    "6. Add the message receive/reply permissions requested by the platform, then publish or enable the app for your tenant.",
    "",
    "Then paste the values into this Codex chat and ask Codex to configure the plugin:",
    "codex_lark_configure with lark.appId, lark.appSecret, and lark.allowedUsers.",
    "",
    "After configuration, run codex_lark_check_auth and codex_lark_handoff again.",
  ]
    .filter(Boolean)
    .join("\n");
}

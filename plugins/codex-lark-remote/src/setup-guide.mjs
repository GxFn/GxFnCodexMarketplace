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
    "Codex Lark Remote setup required",
    `Missing: Feishu/Lark ${missing.join(" and ") || "app credentials"}.`,
    config.configPath ? `Config: ${config.configPath}` : "",
    "",
    "Recommended first-time path:",
    "1. Create the Feishu/Lark app.",
    "2. Copy App ID and App Secret to your clipboard.",
    "3. Return to Codex and say: 已复制",
    "4. Codex reads the clipboard, saves config, then runs the auth check.",
    "5. Run setup verification: Codex starts the bridge and confirms WebSocket is connected.",
    "6. In Feishu Event Configuration and Callback Configuration, choose long connection and click verify/save while the bridge is running.",
    "7. Return to Codex and explicitly approve connecting this Codex conversation to Lark Remote.",
    "8. After Codex confirms the connection is active, send whoami from Feishu/Lark, then add the returned senderId to lark.allowedUsers.",
    "",
    "Feishu/Lark app settings:",
    `1. Open Feishu: ${FEISHU_OPEN_PLATFORM_URL} or Lark: ${LARK_OPEN_PLATFORM_URL}`,
    "2. Create an internal/custom app.",
    "3. Enable the bot capability.",
    "4. In Credentials & Basic Info, copy App ID and App Secret.",
    "5. In Event Configuration, choose long connection/WebSocket and subscribe to im.message.receive_v1.",
    "6. In Callback Configuration, choose long connection/WebSocket and subscribe to card.action.trigger.",
    "7. Keep Codex Lark Remote running when you click Feishu's verify/save buttons for both pages.",
    "8. Add message receive, send/reply, and card interaction permissions.",
    "9. Publish or enable the app for your tenant after permission changes.",
    "",
    "Copy App ID/App Secret to the clipboard in this shape, then tell Codex: 已复制",
    "",
    "Feishu/Lark app:",
    "- appId: cli_xxx",
    "- appSecret: xxx",
    "",
    "Allowed users:",
    "- allowedUsers: []",
    "",
    "Codex should read the clipboard, call codex_lark_configure, run codex_lark_check_auth, then run codex_lark_verify_setup.",
    "",
    "Use allowedUsers: [] only for the first private setup. After Feishu platform verification passes, ask for explicit consent before calling codex_lark_handoff; only after that connection succeeds should the user send whoami. After whoami works, add your senderId before project/session takeover.",
  ]
    .filter(Boolean)
    .join("\n");
}

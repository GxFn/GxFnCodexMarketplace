import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { readHandoff } from "./handoff.mjs";
import { larkWebSocketEnabled } from "./lark-ws.mjs";
import { configuredAllowedUsers } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import { formatMissingLarkCredentials, hasLarkAppCredentials } from "./setup-guide.mjs";
import { bridgeStatus } from "./supervisor.mjs";
import { readTakeover } from "./takeover.mjs";

export async function diagnoseLarkRemote(options = {}) {
  const config = await loadConfig(options);
  const status = await bridgeStatus(options);
  const publicUrl = cleanPublicUrl(process.env.CODEX_LARK_PUBLIC_URL || config.publicUrl || "");
  const webhookUrl = publicUrl ? joinUrl(publicUrl, "/bridge/lark/event") : "";
  const webSocketEnabled = larkWebSocketEnabled(config);
  const allowedUsers = configuredAllowedUsers(config);
  const appCredentialsConfigured = hasLarkAppCredentials(config);
  const repos = await repoDiagnostics(config);
  const auth = options.checkAuth ? await new LarkNotifier(config.lark || {}).checkAuth() : null;
  const handoff = await readHandoff({ dataDir: config.dataDir });
  const takeover = await readTakeover({ dataDir: config.dataDir });

  const issues = [];
  const warnings = [];
  if (!appCredentialsConfigured) {
    issues.push("Feishu/Lark App ID/App Secret are missing. Save them with codex_lark_configure before starting the bridge.");
  } else if (!status.running) {
    issues.push("Bridge is not running. Start it with codex_lark_handoff from a trusted Codex conversation, then use the Feishu/Lark console.");
  }
  if (!webSocketEnabled && !publicUrl) warnings.push("Public callback URL is not configured.");
  if (webSocketEnabled && status.data?.larkWs?.lastError) warnings.push(status.data.larkWs.lastError);
  if (!webSocketEnabled && !config.lark?.verificationToken && !process.env.CODEX_LARK_VERIFICATION_TOKEN) {
    warnings.push("Verification token is not configured.");
  }
  if (!webSocketEnabled && !config.lark?.encryptKey && !process.env.CODEX_LARK_ENCRYPT_KEY) {
    warnings.push("Encrypt key is not configured; signed/encrypted event verification is recommended.");
  }
  if (allowedUsers.length === 0) warnings.push("No allowedUsers allowlist is configured. This is OK only during first private setup; project/session takeover is blocked until you add your Feishu senderId.");
  if (config.defaultRepo && !config.repos?.[config.defaultRepo]) issues.push(`defaultRepo is not defined in repos: ${config.defaultRepo}`);
  for (const repo of repos) {
    if (!repo.pathExists) issues.push(`Repo path does not exist: ${repo.key}`);
  }
  if (auth && !auth.ok) issues.push(auth.message || "Lark auth check failed.");

  return {
    ok: issues.length === 0,
    checks: {
      bridgeRunning: Boolean(status.running),
      webSocketEnabled,
      webSocketConnected: Boolean(status.data?.larkWs?.connected),
      keepAwakeActive: Boolean(status.data?.keepAwake?.active),
      publicUrlConfigured: Boolean(publicUrl),
      appCredentialsConfigured,
      verificationTokenConfigured: Boolean(config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN),
      encryptKeyConfigured: Boolean(config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY),
      allowedUsersConfigured: allowedUsers.length > 0,
      reposConfigured: Object.keys(config.repos || {}).length > 0,
    },
    bridge: {
      localUrl: status.state?.url || "",
      publicUrl,
      webhookUrl,
      route: "/bridge/lark/event",
      larkWs: status.data?.larkWs || null,
      keepAwake: status.data?.keepAwake || null,
    },
    paths: {
      dataDir: config.dataDir,
      configPath: config.configPath,
    },
    handoff,
    takeover,
    lark: {
      transport: config.lark?.transport || "websocket",
      appIdPrefix: config.lark?.appId ? `${config.lark.appId.slice(0, 8)}...` : "",
      appSecretConfigured: Boolean(config.lark?.appSecret),
      verificationTokenConfigured: Boolean(config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN),
      encryptKeyConfigured: Boolean(config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY),
      allowedUsersCount: allowedUsers.length,
      auth,
    },
    repos,
    issues,
    warnings,
    nextActions: buildNextActions({ config, status, webhookUrl, publicUrl, webSocketEnabled, allowedUsers }),
  };
}

export function formatDiagnostics(diagnostics) {
  return [
    "Codex Lark Remote diagnostics",
    `Ready: ${diagnostics.ok ? "yes" : "no"}`,
    `Bridge: ${diagnostics.checks.bridgeRunning ? "running" : "stopped"}`,
    `Config: ${diagnostics.paths?.configPath || "-"}`,
    `Feishu/Lark: ${formatTransport(diagnostics)}`,
    diagnostics.handoff?.active ? `Conversation: attached ${formatThread(diagnostics.handoff.threadId)}` : "Conversation: not attached",
    diagnostics.takeover ? `Takeover: ${diagnostics.takeover.state}` : "Takeover: off",
    `Mac keep-awake: ${formatKeepAwake(diagnostics.bridge?.keepAwake)}`,
    `Lark app: ${diagnostics.lark.appIdPrefix || "-"}`,
    `Allowed users: ${diagnostics.lark.allowedUsersCount || 0}`,
    diagnostics.issues.length ? `Issues:\n${diagnostics.issues.map((item) => `- ${item}`).join("\n")}` : "Issues: none",
    diagnostics.warnings.length ? `Warnings:\n${diagnostics.warnings.map((item) => `- ${item}`).join("\n")}` : "Warnings: none",
    diagnostics.nextActions.length ? `Next actions:\n${diagnostics.nextActions.map((item) => `- ${item}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatHandoff(diagnostics) {
  const handoff = diagnostics.handoff;
  if (!diagnostics.checks.appCredentialsConfigured) {
    return [
      "Codex Lark Remote",
      "Status: configuration required",
      "Bridge: not started",
      "Conversation: not attached",
      "",
      formatMissingLarkCredentials({
        configPath: diagnostics.paths?.configPath,
      }),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "Codex Lark Remote",
    diagnostics.ok ? "Status: ready for Feishu/Lark" : "Status: needs attention",
    `Feishu/Lark: ${formatTransport(diagnostics)}`,
    handoff?.active ? `Conversation: attached ${formatThread(handoff.threadId)}` : "Conversation: not attached",
    diagnostics.takeover ? `Takeover: ${diagnostics.takeover.state}` : "Takeover: off",
    `Mac keep-awake: ${formatKeepAwake(diagnostics.bridge?.keepAwake)}`,
    diagnostics.checks.webSocketEnabled
      ? "Feishu setup: Event Configuration -> im.message.receive_v1; Callback Configuration -> card.action.trigger; both use long connection"
      : `Feishu setup: webhook URL ${diagnostics.bridge.webhookUrl || "-"}`,
    diagnostics.paths?.configPath ? `Config: ${diagnostics.paths.configPath}` : "",
    "",
    "From Feishu:",
    "Send 控制台 or console to open the project/session console.",
    "Use project list, session list, observe session 2, takeover 1.",
    "status",
    "handoff off (exit current handoff only)",
    "close Lark connection / 关闭飞书连接 (stop bridge and WebSocket after confirmation)",
    diagnostics.issues.length ? `\nIssues:\n${diagnostics.issues.map((item) => `- ${item}`).join("\n")}` : "",
    diagnostics.warnings.length ? `\nWarnings:\n${diagnostics.warnings.map((item) => `- ${item}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function repoDiagnostics(config) {
  return Promise.all(
    Object.entries(config.repos || {}).map(async ([key, repo]) => ({
      key,
      pathConfigured: Boolean(repo.path),
      pathExists: repo.path ? await pathExists(repo.path) : false,
      remote: repo.remote || "",
      baseBranch: repo.baseBranch || "",
      testCommandConfigured: Boolean(repo.testCommand),
      isDefault: config.defaultRepo === key,
    })),
  );
}

async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function buildNextActions({ config, status, webhookUrl, publicUrl, webSocketEnabled, allowedUsers }) {
  const actions = [];
  if (!hasLarkAppCredentials(config)) {
    actions.push("Create a Feishu/Lark internal/custom app and enable the bot capability.");
    actions.push("In Event Configuration, choose long connection/WebSocket and subscribe to im.message.receive_v1.");
    actions.push("In Callback Configuration, choose long connection/WebSocket and subscribe to card.action.trigger.");
    actions.push("Copy App ID/App Secret to the clipboard, then return to Codex and say 已复制.");
    actions.push("Codex should read the clipboard, call codex_lark_configure, then run codex_lark_check_auth and codex_lark_verify_setup. Use allowedUsers: [] only for the first private setup.");
    return actions;
  }
  if (!status.running) actions.push("Run codex_lark_handoff from a trusted Codex conversation to start the local bridge and open the Feishu/Lark console.");
  if (webSocketEnabled) {
    const larkWs = status.data?.larkWs || {};
    const webSocketConnected = Boolean(larkWs.connected);
    const eventSeen = Boolean(larkWs.lastMessageEventAt);
    const callbackSeen = Boolean(larkWs.lastCardActionAt);
    actions.push("Run codex_lark_verify_setup during first-time setup or troubleshooting to confirm the WebSocket connection before Feishu verify/save.");
    if (webSocketConnected && (!eventSeen || !callbackSeen)) {
      actions.push("First complete Feishu Event Configuration: choose long connection, add im.message.receive_v1, then click verify/save.");
      actions.push("Then complete Feishu Callback Configuration: choose long connection, add card.action.trigger, then click verify/save.");
      actions.push("After both platform pages are verified and published, return to Codex and explicitly approve connecting this conversation to Lark Remote.");
      actions.push("Only after Codex confirms the connection is active, send whoami from Feishu/Lark.");
    } else {
      actions.push("In Feishu Event Configuration, keep long connection selected and add im.message.receive_v1.");
      actions.push("In Feishu Callback Configuration, keep long connection selected and add card.action.trigger.");
      actions.push("After the Codex connection is active, send whoami from Feishu/Lark; click a plugin card button to verify card.action.trigger.");
    }
  } else {
    if (!publicUrl) actions.push("Expose the local bridge with a trusted tunnel/reverse proxy and set CODEX_LARK_PUBLIC_URL.");
    if (webhookUrl) actions.push(`Set Feishu Event Subscription request URL to ${webhookUrl}.`);
    actions.push("Use npm run fixture -- --sign --encrypt --challenge before configuring Feishu.");
    actions.push("Send any message from Feishu/Lark after URL verification succeeds.");
  }
  if (!allowedUsers.length) {
    actions.push("After whoami works, add the returned senderId to lark.allowedUsers before project/session takeover.");
  }
  return actions;
}

function formatTransport(diagnostics) {
  if (!diagnostics.checks.webSocketEnabled) return "webhook";
  const larkWs = diagnostics.bridge.larkWs;
  if (larkWs?.connected) return "websocket connected";
  if (larkWs?.starting) return "websocket connecting";
  return `websocket ${larkWs?.message || "not connected"}`;
}

function formatThread(threadId) {
  return threadId ? String(threadId).slice(0, 8) : "unknown";
}

function formatKeepAwake(keepAwake) {
  if (!keepAwake) return "unknown";
  if (!keepAwake.enabled) return "disabled";
  if (keepAwake.active) return keepAwake.pid ? `active pid=${keepAwake.pid}` : "active";
  if (keepAwake.platform && keepAwake.platform !== "darwin") return "macOS only";
  if (keepAwake.lastError) return `failed ${keepAwake.lastError}`;
  return "idle";
}

function cleanPublicUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function joinUrl(base, route) {
  return `${cleanPublicUrl(base)}${route.startsWith("/") ? route : `/${route}`}`;
}

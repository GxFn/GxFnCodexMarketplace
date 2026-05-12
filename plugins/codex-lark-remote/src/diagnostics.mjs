import fs from "node:fs/promises";
import { loadConfig } from "./config.mjs";
import { readHandoff } from "./handoff.mjs";
import { larkWebSocketEnabled } from "./lark-ws.mjs";
import { configuredAllowedUsers } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import { formatMissingLarkCredentials, hasLarkAppCredentials } from "./setup-guide.mjs";
import { bridgeStatus } from "./supervisor.mjs";

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

  const issues = [];
  const warnings = [];
  if (!appCredentialsConfigured) {
    issues.push("Feishu/Lark appId/appSecret are not configured. Bridge start is blocked until they are saved.");
  } else if (!status.running) {
    issues.push("Remote takeover is not running. Start it with codex_lark_handoff from the Codex conversation you want to continue.");
  }
  if (!webSocketEnabled && !publicUrl) warnings.push("Public callback URL is not configured.");
  if (webSocketEnabled && status.data?.larkWs?.lastError) warnings.push(status.data.larkWs.lastError);
  if (!webSocketEnabled && !config.lark?.verificationToken && !process.env.CODEX_LARK_VERIFICATION_TOKEN) {
    warnings.push("Verification token is not configured.");
  }
  if (!webSocketEnabled && !config.lark?.encryptKey && !process.env.CODEX_LARK_ENCRYPT_KEY) {
    warnings.push("Encrypt key is not configured; signed/encrypted event verification is recommended.");
  }
  if (allowedUsers.length === 0) warnings.push("No allowedUsers allowlist is configured.");
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
    `Mac keep-awake: ${formatKeepAwake(diagnostics.bridge?.keepAwake)}`,
    diagnostics.checks.webSocketEnabled
      ? "Feishu setup: Event Subscriptions -> long connection -> im.message.receive_v1"
      : `Feishu setup: webhook URL ${diagnostics.bridge.webhookUrl || "-"}`,
    diagnostics.paths?.configPath ? `Config: ${diagnostics.paths.configPath}` : "",
    "",
    "From Feishu:",
    "Send any message to continue this Codex conversation.",
    "/codex status",
    "/codex handoff off",
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
    actions.push("Create a Feishu/Lark internal/custom app in the Feishu/Lark Open Platform.");
    actions.push("Copy App ID and App Secret, then ask Codex to call codex_lark_configure with lark.appId and lark.appSecret.");
    actions.push("Do not run codex_lark_start or codex_lark_handoff until app credentials are configured.");
    return actions;
  }
  if (!allowedUsers.length) {
    actions.push("After the bot can receive messages, send /codex whoami from Feishu/Lark and add the returned senderId to lark.allowedUsers.");
  }
  if (!status.running) actions.push("Run codex_lark_handoff from the Codex conversation you want to continue in Feishu/Lark.");
  if (webSocketEnabled) {
    actions.push("In Feishu Event Subscriptions, choose long connection and add im.message.receive_v1.");
    actions.push("Send any message from Feishu/Lark after WebSocket is connected.");
  } else {
    if (!publicUrl) actions.push("Expose the local bridge with a trusted tunnel/reverse proxy and set CODEX_LARK_PUBLIC_URL.");
    if (webhookUrl) actions.push(`Set Feishu Event Subscription request URL to ${webhookUrl}.`);
    actions.push("Use npm run fixture -- --sign --encrypt --challenge before configuring Feishu.");
    actions.push("Send any message from Feishu/Lark after URL verification succeeds.");
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

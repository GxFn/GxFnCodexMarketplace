import fs from "node:fs/promises";
import path from "node:path";
import { configFilePath, ensureDir, resolveDataDir } from "./config.mjs";
import { configuredAllowedUsers } from "./lark.mjs";

export async function updateRuntimeConfig(input = {}) {
  const dataDir = resolveDataDir(input.dataDir);
  const targetPath = path.resolve(input.configPath || configFilePath(dataDir));
  const current = await readJsonIfExists(targetPath);
  const patch = normalizeConfigPatch(input);
  const next = mergeConfigPatch(current, patch);

  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    configPath: targetPath,
    summary: summarizeConfig(next),
  };
}

export function formatConfigUpdate(result) {
  const summary = result.summary;
  const allowedUsersConfigured = summary.lark.allowedUsersCount > 0;
  const startupTargetConfigured = Boolean(summary.startup?.receiveIdConfigured);
  return [
    "Codex Lark Remote configuration saved",
    `Config: ${result.configPath}`,
    `Lark app: ${summary.lark.appIdPrefix || "-"}`,
    `App secret: ${summary.lark.appSecretConfigured ? "configured" : "missing"}`,
    `Verification token: ${summary.lark.verificationTokenConfigured ? "configured" : "missing"}`,
    `Encrypt key: ${summary.lark.encryptKeyConfigured ? "configured" : "missing"}`,
    `Allowed users: ${summary.lark.allowedUsersCount}`,
    `Startup intro target: ${startupTargetConfigured ? "configured" : "learn from first Feishu chat"}`,
    "",
    "Next steps:",
    "- Run codex_lark_check_auth to verify App ID/App Secret.",
    "- Run codex_lark_verify_setup to start/reuse the bridge and confirm WebSocket is connected.",
    "- In Feishu Event Configuration, choose long connection, add im.message.receive_v1, then click verify/save.",
    "- In Feishu Callback Configuration, choose long connection, add card.action.trigger, then click verify/save.",
    "- After both Feishu/Lark platform pages are verified and published, ask the user for explicit consent and run codex_lark_handoff to connect this Codex conversation.",
    allowedUsersConfigured
      ? "- In Feishu/Lark, send 控制台 or console to open the project/session console."
      : "- Only after Codex confirms the connection is active, send whoami to the bot and add the returned senderId to lark.allowedUsers before project/session takeover.",
  ].join("\n");
}

function normalizeConfigPatch(input) {
  const patch = {};
  for (const key of ["publicUrl", "defaultRepo"]) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  for (const key of ["lark", "repos", "runner", "handoff", "takeover", "startup", "intent", "policy"]) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  return patch;
}

function mergeConfigPatch(base, patch) {
  return {
    ...base,
    ...patch,
    lark: { ...(base.lark || {}), ...(patch.lark || {}) },
    repos: { ...(base.repos || {}), ...(patch.repos || {}) },
    runner: { ...(base.runner || {}), ...(patch.runner || {}) },
    handoff: { ...(base.handoff || {}), ...(patch.handoff || {}) },
    takeover: { ...(base.takeover || {}), ...(patch.takeover || {}) },
    startup: { ...(base.startup || {}), ...(patch.startup || {}) },
    intent: {
      ...(base.intent || {}),
      ...(patch.intent || {}),
      translator: {
        ...(base.intent?.translator || {}),
        ...(patch.intent?.translator || {}),
      },
    },
    policy: { ...(base.policy || {}), ...(patch.policy || {}) },
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function summarizeConfig(config) {
  const allowedUsers = configuredAllowedUsers(config);
  return {
    defaultRepo: config.defaultRepo || "",
    repoKeys: Object.keys(config.repos || {}),
    lark: {
      appIdPrefix: config.lark?.appId ? `${String(config.lark.appId).slice(0, 8)}...` : "",
      appSecretConfigured: Boolean(config.lark?.appSecret),
      verificationTokenConfigured: Boolean(config.lark?.verificationToken),
      encryptKeyConfigured: Boolean(config.lark?.encryptKey),
      allowedUsersCount: allowedUsers.length,
    },
    startup: {
      receiveIdConfigured: Boolean(config.startup?.receiveId),
      receiveIdType: config.startup?.receiveIdType || "",
    },
  };
}

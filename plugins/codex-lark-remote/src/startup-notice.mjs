import fs from "node:fs/promises";
import { ensureDir, nowIso, shortHash, startupNoticeFilePath } from "./config.mjs";
import { buildStartupIntroCard, formatStartupIntro } from "./presenter.mjs";

const RECEIVE_ID_TYPES = new Set(["chat_id", "open_id", "user_id", "union_id", "email"]);

export async function sendStartupIntroIfNeeded(ctx = {}, options = {}) {
  try {
    const config = ctx.config || {};
    const startup = config.startup || {};
    if (startup.enabled === false) return { sent: false, reason: "disabled" };
    if (!config.dataDir) return { sent: false, reason: "missing data dir" };
    if (!ctx.notifier?.send) return { sent: false, reason: "notifier send unavailable" };

    const state = await readStartupNoticeState(config.dataDir);
    let stateChanged = rememberLastChatTarget(state, config, options.event);
    const target = resolveStartupTarget(config, state, options.event);
    if (!target.receiveId) return { sent: false, reason: "missing receive id" };
    if (!RECEIVE_ID_TYPES.has(target.receiveIdType)) {
      return { sent: false, reason: `unsupported receive id type: ${target.receiveIdType}` };
    }

    const once = startup.once !== false;
    const key = startupNoticeKey(config, target);
    if (once && state.notices?.[key]?.sentAt) {
      if (stateChanged) await writeStartupNoticeState(config.dataDir, state);
      return { sent: false, reason: "already sent", state: state.notices[key] };
    }
    if (stateChanged) {
      await writeStartupNoticeState(config.dataDir, state);
      stateChanged = false;
    }

    let delivery = null;
    if (ctx.notifier.sendCard) {
      delivery = await ctx.notifier.sendCard(target.receiveId, buildStartupIntroCard(), {
        receiveIdType: target.receiveIdType,
      });
    }
    if (!delivery?.ok) {
      delivery = await ctx.notifier.send(target.receiveId, formatStartupIntro(), {
        receiveIdType: target.receiveIdType,
      });
    }
    if (!delivery?.ok) {
      return { sent: false, reason: "delivery failed", error: delivery?.error || "unknown Lark delivery error" };
    }

    const sentState = {
      sentAt: nowIso(),
      reason: options.reason || "startup",
      receiveIdType: target.receiveIdType,
      receiveIdHash: `r_${shortHash(target.receiveId)}`,
      messageId: delivery.messageId || "",
    };
    if (once) {
      state.notices = { ...(state.notices || {}), [key]: sentState };
      stateChanged = true;
    }
    if (stateChanged) {
      await writeStartupNoticeState(config.dataDir, state);
    }
    return { sent: true, state: sentState, delivery };
  } catch (error) {
    return { sent: false, reason: "error", error: error.message };
  }
}

export function startupNoticeTarget(config = {}, event = null) {
  const startup = config.startup || {};
  const lark = config.lark || {};
  const configuredReceiveId = firstNonEmpty(
    startup.receiveId,
    lark.startupReceiveId,
    process.env.CODEX_LARK_STARTUP_RECEIVE_ID,
  );
  if (configuredReceiveId) {
    return {
      receiveId: configuredReceiveId,
      receiveIdType: normalizeReceiveIdType(
        startup.receiveIdType || lark.startupReceiveIdType || process.env.CODEX_LARK_STARTUP_RECEIVE_ID_TYPE || "chat_id",
      ),
      source: "configured",
    };
  }

  const configuredChatId = firstNonEmpty(
    startup.chatId,
    lark.startupChatId,
    process.env.CODEX_LARK_STARTUP_CHAT_ID,
  );
  if (configuredChatId) {
    return { receiveId: configuredChatId, receiveIdType: "chat_id", source: "configured_chat" };
  }

  const eventChatId = firstNonEmpty(event?.chatId);
  if (eventChatId) return { receiveId: eventChatId, receiveIdType: "chat_id", source: "event_chat" };

  return { receiveId: "", receiveIdType: "chat_id", source: "none" };
}

function resolveStartupTarget(config, state, event) {
  const target = startupNoticeTarget(config, event);
  if (target.receiveId) return target;
  const remembered = state?.lastTarget || {};
  if (remembered.receiveId && remembered.receiveIdType) {
    return {
      receiveId: remembered.receiveId,
      receiveIdType: remembered.receiveIdType,
      source: "remembered_chat",
    };
  }
  return target;
}

function rememberLastChatTarget(state, config, event) {
  const startup = config.startup || {};
  if (startup.rememberLastChat === false || !event?.chatId) return false;
  state.lastTarget = {
    receiveId: String(event.chatId),
    receiveIdType: "chat_id",
    rememberedAt: nowIso(),
    chatIdHash: event.chatIdHash || `c_${shortHash(event.chatId)}`,
  };
  return true;
}

async function readStartupNoticeState(dataDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(startupNoticeFilePath(dataDir), "utf8"));
    return { notices: {}, ...parsed };
  } catch (error) {
    if (error.code === "ENOENT") return { notices: {} };
    throw error;
  }
}

async function writeStartupNoticeState(dataDir, state) {
  await ensureDir(dataDir);
  await fs.writeFile(startupNoticeFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

function startupNoticeKey(config, target) {
  const appKey = shortHash(config.lark?.appId || "unknown-app");
  const targetKey = shortHash(`${target.receiveIdType}:${target.receiveId}`);
  return `${appKey}:${targetKey}`;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeReceiveIdType(value) {
  return String(value || "chat_id").trim() || "chat_id";
}

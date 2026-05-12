import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DEFAULT_BRIDGE_HOST, ensureDir, loadConfig, nowIso, readPackageVersion, stateFilePath } from "./config.mjs";
import { runApprovedAction } from "./actions.mjs";
import { decryptLarkPayload, verifyLarkSignature } from "./crypto.mjs";
import { updateRuntimeConfig } from "./config-writer.mjs";
import { activateHandoff, clearHandoff, markHandoffRemoteNoteSent, readHandoff } from "./handoff.mjs";
import { KeepAwakeController } from "./keep-awake.mjs";
import { LarkWebSocketReceiver } from "./lark-ws.mjs";
import { parseLarkEvent, isUserAllowed, classifyChatText } from "./lark.mjs";
import { LarkNotifier } from "./notifier.mjs";
import {
  formatBridgeStatus,
  formatGuidanceQueued,
  formatHelp,
  formatObservationList,
  formatObservationStatus,
  formatQueued,
  formatTask,
  formatWhoami,
} from "./presenter.mjs";
import { RemoteCommandQueue } from "./queue.mjs";
import { CodexCliRunner } from "./runner.mjs";
import { activateObservation, clearObservation, CodexSessionObserver, listObservationTargets, readObservation } from "./observer.mjs";
import { assertLarkAppCredentials } from "./setup-guide.mjs";

export async function startBridge(options = {}) {
  const config = await loadConfig({ dataDir: options.dataDir, configPath: options.configPath });
  assertLarkAppCredentials(config);
  const queue = new RemoteCommandQueue({ dataDir: config.dataDir });
  const notifier = new LarkNotifier(config.lark || {});
  const runner = new CodexCliRunner({ queue, config, notifier });
  const logger = options.logger || console;
  const keepAwake = new KeepAwakeController({ config, logger });
  const observer = new CodexSessionObserver({ config, notifier, logger });
  const bridge = { config, queue, notifier, runner, observer, token: null, server: null, larkWs: null, keepAwake, seenMessageIds: new Map() };
  const cleanup = () => {
    bridge.larkWs?.stop();
    bridge.observer?.stop();
    bridge.keepAwake?.stop();
  };
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.once("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  const version = await readPackageVersion();
  const token = options.token || process.env.CODEX_LARK_BRIDGE_TOKEN || crypto.randomBytes(24).toString("hex");
  bridge.token = token;
  const host = options.host || DEFAULT_BRIDGE_HOST;
  const port = Number(options.port ?? 0);

  const server = http.createServer(async (req, res) => {
    try {
      await route({ ...bridge, req, res });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error.message });
    }
  });
  bridge.server = server;
  bridge.larkWs = new LarkWebSocketReceiver({
    config,
    onEvent: (eventBody) => processLarkEvent(bridge, eventBody),
    logger,
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  await writeState(config.dataDir, { pid: process.pid, version, host, port: address.port, url, token, startedAt: nowIso() });
  await bridge.larkWs.start();
  const activeHandoff = await readHandoff({ dataDir: config.dataDir });
  if (activeHandoff) {
    bridge.keepAwake.start();
  } else {
    await cancelInactiveHandoffTasks(bridge);
  }
  await bridge.observer.restore();

  if (config.runner?.workerEnabled !== false) {
    setInterval(() => runner.processAll().catch(() => {}), 2000).unref();
  }

  return { ...bridge, url, token };
}

async function route(ctx) {
  const { req, res, token } = ctx;
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "POST" && url.pathname === "/bridge/lark/event") {
    const { body, raw } = await readJson(req);
    return handleLarkEvent(ctx, body, raw, req.headers);
  }

  if (url.pathname.startsWith("/bridge/") && !isAuthorized(req, token)) {
    return sendJson(res, 401, { success: false, error: "Unauthorized" });
  }

  if (req.method === "GET" && ["/bridge/status", "/bridge/lark/status"].includes(url.pathname)) {
    const counts = await ctx.queue.counts();
    return sendJson(res, 200, {
      success: true,
      data: {
        url: publicUrl(ctx.config),
        version: await readPackageVersion(),
        counts,
        workerBusy: ctx.runner.busy,
        handoff: await readHandoff({ dataDir: ctx.config.dataDir }),
        observation: await readObservation({ dataDir: ctx.config.dataDir }),
        observer: ctx.observer?.status(),
        keepAwake: ctx.keepAwake?.status(),
        larkWs: ctx.larkWs?.status(),
        repos: Object.keys(ctx.config.repos || {}),
        text: formatBridgeStatus({
          config: ctx.config,
          counts,
          workerBusy: ctx.runner.busy,
          handoff: await readHandoff({ dataDir: ctx.config.dataDir }),
          observation: await readObservation({ dataDir: ctx.config.dataDir }),
          keepAwake: ctx.keepAwake?.status(),
          larkWs: ctx.larkWs?.status(),
          url: publicUrl(ctx.config),
        }),
      },
    });
  }

  if (req.method === "POST" && ["/bridge/stop", "/bridge/lark/stop"].includes(url.pathname)) {
    sendJson(res, 200, { success: true, message: "Stopping bridge" });
    ctx.larkWs?.stop();
    ctx.observer?.stop();
    ctx.keepAwake?.stop();
    setTimeout(() => ctx.server.close(() => process.exit(0)), 50).unref();
    return;
  }

  if (req.method === "POST" && url.pathname === "/bridge/lark/start") {
    return sendJson(res, 200, { success: true, data: await ctx.larkWs?.start(), message: "Bridge already running" });
  }

  if (req.method === "GET" && url.pathname === "/bridge/tasks") {
    const limit = Number(url.searchParams.get("limit") || 20);
    return sendJson(res, 200, { success: true, data: await ctx.queue.list({ limit }) });
  }

  if (req.method === "GET" && url.pathname === "/bridge/handoff") {
    return sendJson(res, 200, { success: true, data: await readHandoff({ dataDir: ctx.config.dataDir }) });
  }

  if (req.method === "POST" && url.pathname === "/bridge/handoff") {
    const { body } = await readJson(req);
    const data = await activateHandoff({
      dataDir: ctx.config.dataDir,
      threadId: body.threadId,
      threadPath: body.threadPath,
      cwd: body.cwd,
      name: body.name,
      requireExplicitThread: body.requireExplicitThread !== false,
      activatedBy: body.activatedBy || "bridge",
    });
    const keepAwake = ctx.keepAwake?.start();
    return sendJson(res, 200, { success: true, data, keepAwake });
  }

  if (req.method === "DELETE" && url.pathname === "/bridge/handoff") {
    const data = await clearHandoff({ dataDir: ctx.config.dataDir });
    const keepAwake = ctx.keepAwake?.stop();
    return sendJson(res, 200, { success: true, data, keepAwake });
  }

  if (req.method === "POST" && url.pathname === "/bridge/tasks") {
    const { body } = await readJson(req);
    const created = await enqueueTask(ctx, {
      repoKey: body.repoKey || ctx.config.defaultRepo,
      text: body.prompt || body.text || "",
      messageId: "",
      chatIdHash: "",
      userIdHash: "manual",
      userName: "developer",
    });
    ctx.runner.processAll().catch(() => {});
    return sendJson(res, 200, { success: true, data: created });
  }

  const taskMatch = url.pathname.match(/^\/bridge\/tasks\/([^/]+)(?:\/([^/]+))?$/);
  if (taskMatch) {
    const [, id, action] = taskMatch;
    if (req.method === "GET" && !action) return sendJson(res, 200, { success: true, data: await ctx.queue.get(id) });
    if (req.method === "POST" && action === "cancel") {
      return sendJson(res, 200, { success: true, data: await ctx.queue.cancel(id) });
    }
    if (req.method === "POST" && action === "approve") {
      const { body } = await readJson(req);
      return sendJson(res, 200, {
        success: true,
        data: await runApprovedAction({
          queue: ctx.queue,
          config: ctx.config,
          commandId: id,
          action: body.action || "review",
        }),
      });
    }
  }

  return sendJson(res, 404, { success: false, error: "Not found" });
}

async function handleLarkEvent(ctx, incomingBody, rawBody, headers) {
  const signature = verifyLarkSignature({
    rawBody,
    headers,
    encryptKey: ctx.config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY || "",
  });
  if (signature.checked && !signature.ok) {
    return sendJson(ctx.res, 401, { success: false, error: signature.reason || "Invalid Lark signature" });
  }

  const body = normalizeLarkBody(incomingBody, ctx.config);
  const token = ctx.config.lark?.verificationToken || process.env.CODEX_LARK_VERIFICATION_TOKEN || "";
  const headerToken = body?.header?.token || body?.token || "";
  if (token && headerToken !== token) {
    return sendJson(ctx.res, 403, { success: false, error: "Invalid verification token" });
  }

  const event = parseLarkEvent(body);
  if (event.kind === "url_verification") return sendJson(ctx.res, 200, { challenge: event.challenge });
  await processLarkEvent(ctx, body);
  return sendJson(ctx.res, 200, { success: true });
}

export async function processLarkEvent(ctx, body) {
  const event = parseLarkEvent(body);
  if (event.kind !== "message") return { success: true, ignored: true };
  if (rememberLarkMessage(ctx, event.messageId)) return { success: true, duplicate: true };

  if (event.messageType && event.messageType !== "text") {
    await ctx.notifier.reply(event.messageId, "Please send a text message.");
    return { success: true, rejected: true };
  }
  if (!event.text) return { success: true, ignored: true };

  const duplicate = await ctx.queue.findByMessageId(event.messageId);
  if (duplicate) return { success: true, duplicate: true };

  const action = classifyChatText(event.text, ctx.config);
  if (action.kind !== "whoami" && !isUserAllowed(event.senderId, ctx.config)) {
    await ctx.notifier.reply(event.messageId, "Permission denied.");
    return { success: true, rejected: true };
  }
  await handleChatAction(ctx, event, action);
  return { success: true };
}

async function handleChatAction(ctx, event, action) {
  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  if (action.kind === "help") return ctx.notifier.reply(event.messageId, formatHelp());
  if (action.kind === "whoami") return ctx.notifier.reply(event.messageId, formatWhoami(event));
  if (action.kind === "status") {
    const counts = await ctx.queue.counts();
    return ctx.notifier.reply(
      event.messageId,
      formatBridgeStatus({
        config: ctx.config,
        counts,
        workerBusy: ctx.runner.busy,
        handoff,
        observation: await readObservation({ dataDir: ctx.config.dataDir }),
        keepAwake: ctx.keepAwake?.status(),
        larkWs: ctx.larkWs?.status(),
        url: publicUrl(ctx.config),
      }),
    );
  }
  if (action.kind === "handoff_status") {
    return ctx.notifier.reply(event.messageId, formatHandoffStatus(handoff));
  }
  if (action.kind === "command_visibility") {
    return handleCommandVisibility(ctx, event, action);
  }
  if (action.kind === "observe_list") {
    const targets = await listObservationTargets({ cwd: handoff?.cwd || "", limit: 10 });
    return ctx.notifier.reply(
      event.messageId,
      formatObservationList(targets, await readObservation({ dataDir: ctx.config.dataDir })),
    );
  }
  if (action.kind === "observe_enable") {
    try {
      const observation = await activateObservation({
        dataDir: ctx.config.dataDir,
        selector: action.selector,
        cwd: handoff?.cwd || "",
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        activatedBy: "lark",
      });
      await ctx.observer?.start(observation);
      return ctx.notifier.reply(event.messageId, formatObservationStatus(observation));
    } catch (error) {
      const targets = await listObservationTargets({ cwd: handoff?.cwd || "", limit: 10 });
      return ctx.notifier.reply(event.messageId, `${error.message}\n\n${formatObservationList(targets)}`);
    }
  }
  if (action.kind === "observe_disable") {
    const observation = await clearObservation({ dataDir: ctx.config.dataDir });
    await ctx.observer?.stop();
    return ctx.notifier.reply(event.messageId, formatObservationStatus(observation));
  }
  if (action.kind === "handoff_disable") {
    const activeHandoff = handoff;
    const handoffState = await clearHandoff({ dataDir: ctx.config.dataDir });
    await cancelHandoffTasks(ctx, activeHandoff?.threadId || handoffState?.previous?.threadId);
    ctx.keepAwake?.stop();
    return ctx.notifier.reply(
      event.messageId,
      formatHandoffStatus(handoffState),
    );
  }
  if (action.kind === "task_status" || action.kind === "task_diff") {
    return ctx.notifier.reply(event.messageId, formatTask(await ctx.queue.get(action.id)));
  }
  if (action.kind === "cancel") {
    return ctx.notifier.reply(event.messageId, formatTask(await ctx.queue.cancel(action.id)));
  }
  if (action.kind === "approve") {
    try {
      return ctx.notifier.reply(
        event.messageId,
        formatTask(
          await runApprovedAction({
            queue: ctx.queue,
            config: ctx.config,
            commandId: action.id,
            action: action.action,
          }),
        ),
      );
    } catch (error) {
      return ctx.notifier.reply(event.messageId, `Approval failed: ${error.message}`);
    }
  }
  if (action.kind === "rejected" && !handoff) return ctx.notifier.reply(event.messageId, action.reason);
  if (action.kind === "rejected" && handoff) action = { kind: "task", repoKey: "current", taskText: event.text };
  if (action.kind !== "task") return;

  const created = handoff
    ? await enqueueHandoffTask(ctx, {
        handoff,
        text: event.text,
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        userName: event.senderName,
        runningCommand: await findRunningHandoffTask(ctx, handoff),
      })
    : await enqueueTask(ctx, {
        repoKey: action.repoKey,
        text: action.taskText,
        messageId: event.messageId,
        chatIdHash: event.chatIdHash,
        userIdHash: event.userIdHash,
        userName: event.senderName,
  });
  if (created.handoffGuidance) {
    await ctx.notifier.reply(event.messageId, formatGuidanceQueued(created));
  } else if (created.mode !== "thread_handoff" || created.notifyQueued) {
    await ctx.notifier.reply(event.messageId, formatQueued(created));
  }
  Promise.resolve(ctx.runner.processAll()).catch(() => {});
}

async function handleCommandVisibility(ctx, event, action) {
  if (typeof action.enabled !== "boolean") {
    return ctx.notifier.reply(event.messageId, formatCommandVisibility(ctx.config));
  }
  await updateRuntimeConfig({
    dataDir: ctx.config.dataDir,
    configPath: ctx.config.configPath,
    handoff: { showCommands: action.enabled },
  });
  ctx.config.handoff = { ...(ctx.config.handoff || {}), showCommands: action.enabled };
  return ctx.notifier.reply(event.messageId, formatCommandVisibility(ctx.config));
}

async function enqueueTask(ctx, input) {
  const repo = ctx.config.repos?.[input.repoKey];
  if (!repo?.path) throw new Error(`Repo is not configured: ${input.repoKey}`);
  return ctx.queue.enqueue({
    source: "lark",
    repoKey: input.repoKey,
    projectRoot: repo.path,
    prompt: input.text,
    normalizedTask: input.text,
    messageId: input.messageId,
    chatIdHash: input.chatIdHash,
    userIdHash: input.userIdHash,
    userName: input.userName,
  });
}

async function enqueueHandoffTask(ctx, input) {
  const guidance = Boolean(input.runningCommand);
  const text = guidance ? buildHandoffGuidancePrompt(input.text, input.runningCommand) : input.text;
  const includeRemoteNote = await markHandoffRemoteNoteSent({
    dataDir: ctx.config.dataDir,
    threadId: input.handoff.threadId,
  });
  return ctx.queue.enqueue({
    source: "lark",
    mode: "thread_handoff",
    presentation: "chat",
    notifyQueued: guidance || ctx.config.handoff?.notifyQueued === true,
    notifyStarted: ctx.config.handoff?.notifyStarted !== false,
    includeRemoteNote,
    handoffGuidance: guidance,
    guidanceForCommandId: input.runningCommand?.id || "",
    repoKey: "current",
    projectRoot: input.handoff.cwd || "",
    prompt: text,
    normalizedTask: input.text,
    messageId: input.messageId,
    chatIdHash: input.chatIdHash,
    userIdHash: input.userIdHash,
    userName: input.userName,
    codexSessionId: input.handoff.threadId,
    codexSessionPath: input.handoff.threadPath || "",
  });
}

async function findRunningHandoffTask(ctx, handoff) {
  if (!ctx.runner?.busy || !handoff?.threadId || typeof ctx.queue.list !== "function") return null;
  const commands = await ctx.queue.list({ limit: 50 });
  return commands.find((command) =>
    command.mode === "thread_handoff"
    && command.status === "running"
    && command.codexSessionId === handoff.threadId
  ) || null;
}

async function cancelHandoffTasks(ctx, threadId) {
  if (!threadId || typeof ctx.queue.list !== "function" || typeof ctx.queue.cancel !== "function") return [];
  const commands = await ctx.queue.list({ limit: 200 });
  const activeStatuses = new Set(["pending", "running"]);
  const matches = commands.filter((command) =>
    command.mode === "thread_handoff"
    && command.codexSessionId === threadId
    && activeStatuses.has(command.status)
  );
  const cancelled = [];
  for (const command of matches) {
    const result = await ctx.queue.cancel(command.id, "handoff disabled by user");
    if (result) cancelled.push(result);
  }
  return cancelled;
}

async function cancelInactiveHandoffTasks(ctx) {
  const handoff = await readHandoff({ dataDir: ctx.config.dataDir });
  const activeThreadId = handoff?.threadId || "";
  if (typeof ctx.queue.list !== "function" || typeof ctx.queue.cancel !== "function") return [];
  const commands = await ctx.queue.list({ limit: 200 });
  const activeStatuses = new Set(["pending", "running"]);
  const matches = commands.filter((command) =>
    command.mode === "thread_handoff"
    && activeStatuses.has(command.status)
    && (!activeThreadId || command.codexSessionId !== activeThreadId)
  );
  const cancelled = [];
  for (const command of matches) {
    const result = await ctx.queue.cancel(command.id, "handoff inactive");
    if (result) cancelled.push(result);
  }
  return cancelled;
}

function buildHandoffGuidancePrompt(text, runningCommand) {
  return [
    "[Supplemental guidance received while the previous Feishu/Lark turn was still running]",
    "Treat this as additional guidance for the same Codex conversation. Apply it after reconciling any work already completed by the previous turn. Do not restart from scratch unless the user asks.",
    runningCommand?.id ? `Previous running task: ${runningCommand.id}` : "",
    "",
    "User guidance:",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatHandoffStatus(handoff) {
  if (!handoff?.active) return "Codex Lark Remote handoff: off";
  return [
    "Codex Lark Remote handoff: active",
    `Mode: ${handoff.mode || "resume"}`,
    `Thread: ${handoff.threadId}`,
    handoff.name ? `Name: ${handoff.name}` : "",
    handoff.cwd ? `Cwd: ${handoff.cwd}` : "",
    "Send a normal Feishu message to continue this Codex thread.",
    "Use /codex handoff off to stop.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCommandVisibility(config) {
  const enabled = config.handoff?.showCommands === true;
  return [
    `Command display: ${enabled ? "on" : "off"}`,
    enabled
      ? "Normal commands and one-line output summaries will be sent to Feishu/Lark."
      : "Normal commands and Output are hidden. Risky commands are still shown with a warning.",
    "",
    "Use /codex commands on or /codex commands off.",
  ].join("\n");
}

function isAuthorized(req, token) {
  const header = req.headers.authorization || "";
  return header === `Bearer ${token}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = chunks.length === 0 ? "" : Buffer.concat(chunks).toString("utf8");
  return { body: raw ? JSON.parse(raw) : {}, raw };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(`${JSON.stringify(body)}\n`);
}

async function writeState(dataDir, state) {
  await ensureDir(dataDir);
  await fs.writeFile(stateFilePath(dataDir), `${JSON.stringify(state, null, 2)}\n`);
}

function publicUrl(config) {
  return process.env.CODEX_LARK_PUBLIC_URL || config.publicUrl || "";
}

function normalizeLarkBody(body, config) {
  if (body?.encrypt) {
    return decryptLarkPayload(body.encrypt, config.lark?.encryptKey || process.env.CODEX_LARK_ENCRYPT_KEY || "");
  }
  return body;
}

function rememberLarkMessage(ctx, messageId) {
  if (!messageId) return false;
  if (!ctx.seenMessageIds) ctx.seenMessageIds = new Map();
  if (ctx.seenMessageIds.has(messageId)) return true;

  ctx.seenMessageIds.set(messageId, Date.now());
  if (ctx.seenMessageIds.size > 1000) {
    const stale = [...ctx.seenMessageIds.entries()]
      .sort((left, right) => left[1] - right[1])
      .slice(0, 200);
    for (const [id] of stale) ctx.seenMessageIds.delete(id);
  }
  return false;
}

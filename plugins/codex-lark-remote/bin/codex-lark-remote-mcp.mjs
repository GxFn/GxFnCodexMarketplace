#!/usr/bin/env node
import readline from "node:readline";
import { applyCodexContext } from "../src/codex-context.mjs";
import { formatConfigUpdate, updateRuntimeConfig } from "../src/config-writer.mjs";
import { loadConfig, readPackageVersion } from "../src/config.mjs";
import { diagnoseLarkRemote, formatDiagnostics, formatHandoff } from "../src/diagnostics.mjs";
import { LarkNotifier } from "../src/notifier.mjs";
import { sanitizeBridgeStatus } from "../src/sanitize.mjs";
import { formatMissingLarkCredentials, hasLarkAppCredentials } from "../src/setup-guide.mjs";
import { bridgeFetch, bridgeStatus, readBridgeState, startBridgeProcess, stopBridgeProcess } from "../src/supervisor.mjs";

const tools = [
  {
    name: "codex_lark_configure",
    description: "Write or update ~/.codex-lark-remote/config.json from Feishu/Lark setup details supplied in the Codex chat. Returns a sanitized summary and never prints secrets.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string", description: "Optional data directory override." },
        configPath: { type: "string", description: "Optional config file path override." },
        publicUrl: { type: "string", description: "Advanced: public callback URL." },
        defaultRepo: { type: "string", description: "Advanced: default repo key for isolated tasks." },
        lark: {
          type: "object",
          properties: {
            appId: { type: "string" },
            appSecret: { type: "string" },
            verificationToken: { type: "string" },
            encryptKey: { type: "string" },
            allowedUsers: { type: "array", items: { type: "string" } },
            transport: { type: "string", enum: ["websocket", "webhook"] },
            websocket: { type: "boolean" },
          },
        },
        repos: {
          type: "object",
          description: "Advanced: repo map for isolated tasks.",
          additionalProperties: {
            type: "object",
            properties: {
              path: { type: "string" },
              remote: { type: "string" },
              baseBranch: { type: "string" },
              testCommand: { type: "string" },
            },
          },
        },
        runner: { type: "object" },
        handoff: { type: "object" },
        takeover: { type: "object" },
        startup: { type: "object" },
        intent: { type: "object" },
        policy: { type: "object" },
      },
    },
  },
  {
    name: "codex_lark_status",
    description: "Return Codex Lark Remote bridge, queue, and runner status.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string", description: "Optional data directory override." },
        configPath: { type: "string", description: "Optional config file path override." },
      },
    },
  },
  {
    name: "codex_lark_check_auth",
    description: "Check whether configured Feishu/Lark app credentials can acquire a tenant access token. Does not print secrets.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_diagnose",
    description: "Return a sanitized readiness checklist for continuing the current Codex conversation from Feishu/Lark.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        checkAuth: { type: "boolean", description: "Also call Feishu/Lark auth API. Defaults to false." },
        json: { type: "boolean", description: "Return raw JSON instead of a compact text checklist." },
      },
    },
  },
  {
    name: "codex_lark_start",
    description: "Start the local Codex Lark Remote bridge after Feishu/Lark app credentials are configured.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_handoff",
    description: "Attach this Codex conversation to the local Codex Lark Remote bridge by storing local routing state. Existing chat history is not sent to Feishu/Lark; future Feishu/Lark messages and Codex replies may pass through the configured bot. Requires explicit user consent.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        threadId: { type: "string", description: "Optional explicit Codex thread/session id. When omitted, Codex request metadata is used; the tool does not guess by workspace path." },
        cwd: { type: "string", description: "Optional workspace cwd used when resolving the current thread." },
        checkAuth: { type: "boolean", description: "Also call Feishu/Lark auth API. Defaults to false." },
        confirmedLocalBridgeHandoff: {
          type: "boolean",
          description: "Set true only after the user explicitly approved storing local thread routing for this conversation so Feishu/Lark can continue it through the local bridge.",
        },
      },
    },
  },
  {
    name: "codex_lark_prepare_takeover",
    description: "Prepare Feishu/Lark-driven takeover. This starts the bridge and stores local routing state; allowed Feishu/Lark users choose the project and window to inspect or take over.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        cwd: { type: "string", description: "Optional workspace cwd used when resolving takeover targets." },
        confirmedLocalBridgeHandoff: {
          type: "boolean",
          description: "Set true only after the user explicitly approved storing local takeover routing scope for this project.",
        },
      },
    },
  },
  {
    name: "codex_lark_takeover_targets",
    description: "List Codex windows for a chosen project cwd. Feishu/Lark normally starts from the project list, then enters a project before choosing a window.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        cwd: { type: "string" },
        limit: { type: "number", default: 10 },
      },
    },
  },
  {
    name: "codex_lark_takeover",
    description: "Select or execute takeover for a Codex window. By default this should be driven from Feishu/Lark card actions; Codex can use it for diagnostics or manual control.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
        selector: { type: "string", description: "Target option number, thread id prefix, or title fragment." },
        threadId: { type: "string" },
        optionIndex: { type: "number" },
        execute: { type: "boolean", description: "When true, execute takeover. When false, only select/view the target." },
      },
    },
  },
  {
    name: "codex_lark_stop",
    description: "Stop the local Codex Lark Remote bridge process.",
    inputSchema: {
      type: "object",
      properties: {
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_task",
    description: "Advanced: return one queued Codex Lark Remote item by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_history",
    description: "Advanced: return recent queued Codex Lark Remote items.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_send",
    description: "Advanced: create a queued Codex Lark Remote item manually through the running bridge.",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        repoKey: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_cancel",
    description: "Advanced: cancel a pending, running, or waiting_review queued item.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
  {
    name: "codex_lark_approve",
    description: "Advanced: approve a gated action such as test, commit, or push.",
    inputSchema: {
      type: "object",
      required: ["id", "action"],
      properties: {
        id: { type: "string" },
        action: { type: "string", enum: ["test", "commit", "push", "review"] },
        dataDir: { type: "string" },
        configPath: { type: "string" },
      },
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
let chain = Promise.resolve();

rl.on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(() => handleLine(line));
});

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
    const result = await handleRequest(request);
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: request?.id ?? null,
        error: { code: -32000, message: error.message },
      })}\n`,
    );
  }
}

async function handleRequest(request) {
  if (request.method === "notifications/initialized") return null;
  if (request.method === "initialize") {
    const version = await readPackageVersion();
    return response(request.id, {
      protocolVersion: request.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "codex-lark-remote", version },
    });
  }
  if (request.method === "tools/list") return response(request.id, { tools });
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    return response(request.id, await callTool(name, args, request));
  }
  return response(request.id, {});
}

async function callTool(name, args, request = {}) {
  if (name === "codex_lark_configure") {
    return textContent(formatConfigUpdate(await updateRuntimeConfig(args)));
  }
  if (name === "codex_lark_start") {
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) return textContent(formatMissingLarkCredentials(config));
    await ensureBridge(args);
    return textContent(formatDiagnostics(await diagnoseLarkRemote(args)));
  }
  if (name === "codex_lark_handoff") {
    if (args.confirmedLocalBridgeHandoff !== true) {
      return textContent(formatHandoffConsentRequired());
    }
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return textContent(formatHandoff(await diagnoseLarkRemote(args)));
    }
    const handoffArgs = applyCodexContext(args, request);
    if (!handoffArgs.threadId) {
      return textContent(formatMissingThreadContext());
    }
    const bridge = await ensureBridge(handoffArgs);
    const state = bridge.state || await readBridgeState(handoffArgs);
    if (!state?.url || !state?.token) {
      return textContent("Codex Lark Remote bridge is not running. Use codex_lark_start first.");
    }
    await bridgeFetch(state, "/bridge/handoff", {
      method: "POST",
      body: {
        threadId: handoffArgs.threadId,
        threadPath: handoffArgs.threadPath,
        cwd: handoffArgs.cwd,
        requireExplicitThread: true,
        activatedBy: "mcp",
      },
    });
    return textContent(formatHandoff(await diagnoseLarkRemote(handoffArgs)));
  }
  if (name === "codex_lark_prepare_takeover") {
    if (args.confirmedLocalBridgeHandoff !== true) {
      return textContent(formatTakeoverConsentRequired());
    }
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return textContent(formatHandoff(await diagnoseLarkRemote(args)));
    }
    const takeoverArgs = applyCodexContext(args, request);
    if (!takeoverArgs.cwd) {
      return textContent("Codex Lark Remote cannot prepare takeover because the current workspace cwd is unavailable.");
    }
    const bridge = await ensureBridge(takeoverArgs);
    const state = bridge.state || await readBridgeState(takeoverArgs);
    await bridgeFetch(state, "/bridge/takeover/scope", {
      method: "POST",
      body: {
        threadId: takeoverArgs.threadId,
        threadPath: takeoverArgs.threadPath,
        cwd: takeoverArgs.cwd,
        startedBy: "mcp",
      },
    });
    return textContent([
      "Codex Lark Remote takeover control is ready.",
      `Started from: ${takeoverArgs.cwd}`,
      "",
      "From Feishu/Lark, send /codex windows to choose a Codex project, then choose a window to observe or take over.",
    ].join("\n"));
  }
  if (name === "codex_lark_stop") {
    return textContent(formatJson(await stopBridge(args)));
  }
  if (name === "codex_lark_status") {
    return textContent(formatStatus(await bridgeStatus(args)));
  }
  if (name === "codex_lark_check_auth") {
    const config = await loadConfig(args);
    const notifier = new LarkNotifier(config.lark || {});
    return textContent(formatJson(await notifier.checkAuth()));
  }
  if (name === "codex_lark_diagnose") {
    const diagnostics = await diagnoseLarkRemote(args);
    return textContent(args.json ? formatJson(diagnostics) : formatDiagnostics(diagnostics));
  }

  const state = await readBridgeState(args);
  if (!state?.url || !state?.token) {
    const config = await loadConfig(args);
    if (!hasLarkAppCredentials(config)) {
      return {
        isError: true,
        content: [{ type: "text", text: formatMissingLarkCredentials(config) }],
      };
    }
    return {
      isError: true,
      content: [{ type: "text", text: "Codex Lark Remote bridge is not running. Use codex_lark_start first." }],
    };
  }

  if (name === "codex_lark_history") {
    const limit = Number(args.limit || 20);
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks?limit=${limit}`)));
  }
  if (name === "codex_lark_send") {
    return textContent(
      formatJson(
        await bridgeFetch(state, "/bridge/tasks", {
          method: "POST",
          body: { prompt: args.prompt, repoKey: args.repoKey },
        }),
      ),
    );
  }
  if (name === "codex_lark_takeover_targets") {
    const queryParams = new URLSearchParams();
    if (args.limit) queryParams.set("limit", String(Number(args.limit)));
    if (args.cwd) queryParams.set("cwd", args.cwd);
    const query = queryParams.toString() ? `?${queryParams}` : "";
    const result = await bridgeFetch(state, `/bridge/takeover/targets${query}`);
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "codex_lark_takeover") {
    const result = await bridgeFetch(state, args.execute === true ? "/bridge/takeover/execute" : "/bridge/takeover/select", {
      method: "POST",
      body: {
        selector: args.selector,
        threadId: args.threadId,
        optionIndex: args.optionIndex,
      },
    });
    return textContent(result.text || formatJson(result.data));
  }
  if (name === "codex_lark_task") {
    return textContent(formatJson(await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}`)));
  }
  if (name === "codex_lark_cancel") {
    return textContent(
      formatJson(
        await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}/cancel`, {
          method: "POST",
        }),
      ),
    );
  }
  if (name === "codex_lark_approve") {
    return textContent(
      formatJson(
        await bridgeFetch(state, `/bridge/tasks/${encodeURIComponent(args.id)}/approve`, {
          method: "POST",
          body: { action: args.action || "review" },
        }),
      ),
    );
  }
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

async function ensureBridge(args) {
  const config = await loadConfig(args);
  if (!hasLarkAppCredentials(config)) {
    return {
      running: false,
      blocked: true,
      config,
      message: formatMissingLarkCredentials(config),
    };
  }

  const current = await bridgeStatus(args);
  if (current.running) return current;

  const spawned = await startBridgeProcess(args);
  if (!spawned.running) {
    return {
      ...spawned,
      message: spawned.message || "Bridge is not running",
    };
  }
  return spawned;
}

async function stopBridge(args) {
  return stopBridgeProcess(args);
}

function formatStatus(status) {
  if (status.data?.text) return status.data.text;
  return formatJson(sanitizeBridgeStatus(status));
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}

function formatHandoffConsentRequired() {
  return [
    "Codex Lark Remote handoff requires explicit consent.",
    "",
    "This stores local routing state for the current Codex thread in the local Codex Lark Remote bridge. Existing chat history is not sent to Feishu/Lark. Future Feishu/Lark messages and Codex replies may pass through your configured bot while handoff is active.",
    "",
    "If you consent, reply in this Codex chat with:",
    "I approve Codex Lark Remote local bridge handoff for this conversation.",
  ].join("\n");
}

function formatTakeoverConsentRequired() {
  return [
    "Codex Lark Remote takeover preparation requires explicit consent.",
    "",
    "This starts or reuses the local Codex Lark Remote bridge and stores local takeover routing state. It does not send existing chat history to Feishu/Lark, and it does not attach this Codex window as the takeover target. Allowed Feishu/Lark users will choose a project, then choose a window, and must confirm before takeover.",
    "",
    "If you consent, reply in this Codex chat with:",
    "I approve Codex Lark Remote takeover preparation for this project.",
  ].join("\n");
}

function formatMissingThreadContext() {
  return [
    "Codex Lark Remote cannot safely bind this window.",
    "",
    "The Codex host did not provide the current conversation thread id or exact session path to the plugin call. To avoid routing Feishu/Lark messages into another Codex window that happens to share the same workspace path, handoff was not started.",
    "",
    "Refresh or update Codex/plugin support for per-window MCP metadata, then start handoff from the exact Codex conversation you want Feishu/Lark to continue.",
  ].join("\n");
}

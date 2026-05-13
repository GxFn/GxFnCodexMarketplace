import { createRequire } from "node:module";
import path from "node:path";
import { nowIso } from "./config.mjs";

export class LarkWebSocketReceiver {
  constructor({ config = {}, onEvent, sdkLoader = loadLarkSdk, logger = console } = {}) {
    this.config = config;
    this.onEvent = onEvent;
    this.sdkLoader = sdkLoader;
    this.logger = logger;
    this.client = null;
    this.connected = false;
    this.starting = false;
    this.lastEventAt = "";
    this.lastError = "";
    this.message = "";
  }

  async start() {
    if (!larkWebSocketEnabled(this.config)) {
      this.message = "WebSocket disabled";
      return this.status();
    }
    if (this.connected) {
      this.message = "Already connected";
      return this.status();
    }
    if (this.starting) {
      this.message = "Connection in progress";
      return this.status();
    }

    const appId = this.config.lark?.appId || process.env.CODEX_LARK_APP_ID || "";
    const appSecret = this.config.lark?.appSecret || process.env.CODEX_LARK_APP_SECRET || "";
    if (!appId || !appSecret) {
      this.message = "Missing Lark appId/appSecret";
      return this.status();
    }

    this.starting = true;
    this.lastError = "";
    try {
      const lark = await this.sdkLoader();
      const forward = async (data) => {
        this.lastEventAt = nowIso();
        try {
          await this.onEvent?.(data);
        } catch (error) {
          this.lastError = error.message;
          this.logger?.error?.(`[codex-lark-remote] Lark event handler failed: ${error.message}`);
        }
      };
      const dispatcher = new lark.EventDispatcher({}).register({
        "im.message.receive_v1": async (data) => {
          await forward(data);
        },
        "card.action.trigger": async (data) => {
          await forward(markCardActionEvent(data));
        },
      });

      this.client = new lark.WSClient({
        appId,
        appSecret,
        loggerLevel: this.config.lark?.websocketLoggerLevel ?? lark.LoggerLevel?.error ?? 0,
        autoReconnect: true,
      });
      await withTimeout(
        this.client.start({ eventDispatcher: dispatcher }),
        Number(this.config.lark?.websocketStartTimeoutMs || 10000),
        "WebSocket start timed out",
      );
      this.connected = true;
      this.message = "Connected via WebSocket";
    } catch (error) {
      this.client = null;
      this.connected = false;
      this.lastError = error.message;
      this.message = `WebSocket start failed: ${error.message}`;
    } finally {
      this.starting = false;
    }
    return this.status();
  }

  stop() {
    if (this.client?.close) {
      try {
        this.client.close();
      } catch {
        // Closing is best-effort; the bridge process may already be exiting.
      }
    }
    this.client = null;
    this.connected = false;
    this.starting = false;
    this.message = "Stopped";
    return this.status();
  }

  status() {
    return {
      enabled: larkWebSocketEnabled(this.config),
      connected: this.connected,
      starting: this.starting,
      message: this.message,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
    };
  }
}

function markCardActionEvent(data) {
  if (data?.header?.event_type || data?.type === "card.action.trigger") return data;
  return {
    ...data,
    header: {
      ...(data?.header || {}),
      event_type: "card.action.trigger",
    },
  };
}

export function larkWebSocketEnabled(config = {}) {
  const transport = config.lark?.transport || "websocket";
  return transport !== "webhook" && config.lark?.websocket !== false;
}

export async function loadLarkSdk() {
  try {
    return await import("@larksuiteoapi/node-sdk");
  } catch (error) {
    const sdk = requireFromPathNodeModules("@larksuiteoapi/node-sdk");
    if (sdk) return sdk;
    throw error;
  }
}

function requireFromPathNodeModules(specifier) {
  for (const entry of String(process.env.PATH || "").split(path.delimiter)) {
    const normalized = path.normalize(entry);
    if (!normalized.endsWith(`${path.sep}node_modules${path.sep}.bin`)) continue;
    try {
      const nodeModules = path.dirname(normalized);
      return createRequire(path.join(nodeModules, "codex-lark-remote-loader.cjs"))(specifier);
    } catch {
      // Try the next PATH entry. npx exposes --package dependencies this way.
    }
  }
  return null;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

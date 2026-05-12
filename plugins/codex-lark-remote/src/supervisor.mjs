import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { bridgeLogFilePath, loadConfig, readPackageVersion, stateFilePath } from "./config.mjs";
import { formatMissingLarkCredentials, hasLarkAppCredentials } from "./setup-guide.mjs";

export async function readBridgeState(options = {}) {
  const config = await loadConfig(options);
  try {
    return JSON.parse(await fs.readFile(stateFilePath(config.dataDir), "utf8"));
  } catch {
    return null;
  }
}

export async function bridgeStatus(options = {}) {
  const config = await loadConfig(options);
  const expectedVersion = await readPackageVersion();
  const state = await readBridgeState(options);
  if (!state?.url || !state?.token) {
    return { running: false, message: "Bridge is not running", config };
  }
  try {
    const data = await bridgeFetch(state, "/bridge/status");
    const runningVersion = data.data?.version || state.version || "";
    if (runningVersion !== expectedVersion) {
      return {
        running: false,
        restartRequired: true,
        state,
        config,
        ...data,
        message: runningVersion
          ? `Bridge version ${runningVersion} does not match plugin version ${expectedVersion}`
          : `Bridge version is unknown; plugin version is ${expectedVersion}`,
      };
    }
    return { running: true, state, config, ...data };
  } catch (error) {
    await removeBridgeState(config);
    return { running: false, config, message: `Removed stale bridge state: ${error.message}` };
  }
}

export async function startBridgeProcess(options = {}) {
  const config = await loadConfig(options);
  if (!hasLarkAppCredentials(config)) {
    return {
      running: false,
      blocked: true,
      config,
      message: formatMissingLarkCredentials(config),
    };
  }

  const current = await bridgeStatus(options);
  if (current.running) return current;
  if (current.restartRequired && current.state?.url) {
    await stopBridgeProcess(options).catch(() => {});
  }

  const bridgeUrl = new URL("../bin/codex-lark-bridge.mjs", import.meta.url);
  const logPath = bridgeLogFilePath(config.dataDir);
  const logFd = fsSync.openSync(logPath, "a");
  fsSync.writeSync(logFd, `\n[${new Date().toISOString()}] starting Codex Lark Remote bridge\n`);
  const child = spawn(process.execPath, [bridgeUrl.pathname, "--port", "0"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      CODEX_LARK_DATA_DIR: config.dataDir,
      ...(options.configPath ? { CODEX_LARK_CONFIG: options.configPath } : {}),
    },
  });
  child.unref();
  fsSync.closeSync(logFd);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    await delay(200);
    const status = await bridgeStatus(options);
    if (status.running) return status;
  }
  return { running: false, message: "Bridge start timed out", config };
}

export async function stopBridgeProcess(options = {}) {
  const config = await loadConfig(options);
  const state = await readBridgeState(options);
  if (!state?.url || !state?.token) return { success: true, message: "Bridge is not running" };
  try {
    const result = await bridgeFetch(state, "/bridge/stop", { method: "POST" });
    const stopped = await waitForProcessExit(state.pid);
    await removeBridgeState(config);
    if (stopped) return { ...result, stopped: true };
    if (state.pid) {
      process.kill(state.pid, "SIGTERM");
      return { ...result, stopped: await waitForProcessExit(state.pid), signalled: true };
    }
    return { ...result, stopped: false };
  } catch (error) {
    await removeBridgeState(config);
    return { success: true, message: `Removed stale bridge state: ${error.message}` };
  }
}

async function waitForProcessExit(pid, timeoutMs = 5000) {
  if (!pid) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await delay(100);
  }
  return !isProcessAlive(pid);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function removeBridgeState(config) {
  await fs.rm(stateFilePath(config.dataDir), { force: true }).catch(() => {});
}

export async function bridgeFetch(state, route, options = {}) {
  const response = await fetch(`${state.url}${route}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${state.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

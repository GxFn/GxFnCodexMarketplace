import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync, writeFileSync, } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PACKAGE_ROOT } from '../shared/package-root.js';
import { ensureDaemonDirs, getPackageVersion, readDaemonState, removeDaemonState, resolveDaemonPaths, } from './DaemonState.js';
export class DaemonSupervisor {
    async status(projectRootInput) {
        const projectRoot = resolve(projectRootInput);
        const paths = resolveDaemonPaths(projectRoot);
        const state = readDaemonState(paths.statePath);
        const pidAlive = state?.pid ? isProcessAlive(state.pid) : false;
        if (!state) {
            return this.#statusResult(paths, 'stopped', false, null, false, null, 'daemon is not started');
        }
        if (!pidAlive) {
            return this.#statusResult(paths, 'stale', false, state, false, null, 'daemon pid is not alive');
        }
        const health = await fetchDaemonHealth(state);
        if (isMatchingHealth(state, health)) {
            return this.#statusResult(paths, 'ready', true, state, true, health);
        }
        return this.#statusResult(paths, 'stale', false, state, true, health, 'daemon process is alive but health identity did not match');
    }
    async start(options) {
        const projectRoot = resolve(options.projectRoot);
        const paths = resolveDaemonPaths(projectRoot);
        ensureDaemonDirs(paths);
        const existing = await this.status(projectRoot);
        if (existing.ready && !options.restart) {
            return existing;
        }
        return this.#withLock(paths, options.waitUntilReadyMs ?? 10_000, async () => {
            const afterLock = await this.status(projectRoot);
            if (afterLock.ready && !options.restart) {
                return afterLock;
            }
            if (afterLock.state?.pid && afterLock.pidAlive) {
                await this.#terminateProcess(afterLock.state.pid, 5000);
            }
            removeDaemonState(paths, { includeLock: false });
            const port = options.port ?? 0;
            const host = options.host || '127.0.0.1';
            const entry = join(PACKAGE_ROOT, 'dist', 'bin', 'daemon-server.js');
            if (!existsSync(entry)) {
                throw new Error(`Daemon server entry not found: ${entry}. Run npm run build first.`);
            }
            const logFd = openSync(paths.logPath, 'a');
            const child = spawn(process.execPath, [entry], {
                cwd: projectRoot,
                detached: true,
                env: {
                    ...process.env,
                    ALEMBIC_API_SERVER: '1',
                    ALEMBIC_DAEMON_MODE: '1',
                    ALEMBIC_DAEMON_HOST: host,
                    ALEMBIC_DAEMON_PORT: String(port),
                    ALEMBIC_DAEMON_STATE_PATH: paths.statePath,
                    ALEMBIC_PROJECT_DIR: projectRoot,
                    ALEMBIC_QUIET: process.env.ALEMBIC_QUIET || '1',
                },
                stdio: ['ignore', logFd, logFd],
            });
            closeSync(logFd);
            child.unref();
            const childPid = child.pid ?? null;
            writeFileSync(paths.pidPath, `${childPid ?? ''}\n`, { mode: 0o600 });
            const ready = await waitForReady(paths, options.waitUntilReadyMs ?? 10_000);
            if (!ready.ready) {
                const childAlive = childPid ? isProcessAlive(childPid) : false;
                if (!childAlive) {
                    removeDaemonState(paths, { includeLock: false });
                    return this.#statusResult(paths, 'failed', false, null, false, null, `daemon failed to become ready; see ${paths.logPath}`);
                }
                return this.#statusResult(paths, 'starting', false, null, true, null, ready.message || `daemon is still starting; see ${paths.logPath}`);
            }
            return ready;
        });
    }
    async stop(options) {
        const projectRoot = resolve(options.projectRoot);
        const paths = resolveDaemonPaths(projectRoot);
        const state = readDaemonState(paths.statePath);
        if (state?.pid && isProcessAlive(state.pid)) {
            await this.#terminateProcess(state.pid, options.waitMs ?? 5000);
        }
        removeDaemonState(paths);
        return this.#statusResult(paths, 'stopped', false, null, false, null, 'daemon stopped');
    }
    async ensure(options) {
        const current = await this.status(options.projectRoot);
        if (current.ready) {
            return current;
        }
        return this.start(options);
    }
    async #withLock(paths, waitMs, fn) {
        const startedAt = Date.now();
        while (true) {
            try {
                mkdirSync(paths.lockDir, { mode: 0o700 });
                writeFileSync(join(paths.lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }, null, 2)}\n`);
                break;
            }
            catch (error) {
                if (error.code !== 'EEXIST') {
                    throw error;
                }
                const ready = await this.status(paths.projectRoot);
                if (ready.ready) {
                    return ready;
                }
                if (Date.now() - startedAt > waitMs) {
                    if (isStaleLock(paths.lockDir)) {
                        rmSync(paths.lockDir, { recursive: true, force: true });
                        continue;
                    }
                    throw new Error(`Timed out waiting for daemon lock: ${paths.lockDir}`);
                }
                await sleep(200);
            }
        }
        try {
            return await fn();
        }
        finally {
            rmSync(paths.lockDir, { recursive: true, force: true });
        }
    }
    async #terminateProcess(pid, waitMs) {
        try {
            process.kill(pid, 'SIGTERM');
        }
        catch {
            return;
        }
        const startedAt = Date.now();
        while (Date.now() - startedAt < waitMs) {
            if (!isProcessAlive(pid)) {
                return;
            }
            await sleep(100);
        }
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch {
            /* already gone */
        }
    }
    #statusResult(paths, status, ready, state, pidAlive, health, message) {
        return {
            status,
            ready,
            projectRoot: paths.projectRoot,
            dataRoot: paths.dataRoot,
            projectId: paths.projectId,
            statePath: paths.statePath,
            pidPath: paths.pidPath,
            lockDir: paths.lockDir,
            logPath: paths.logPath,
            state,
            pidAlive,
            health,
            message,
        };
    }
}
async function waitForReady(paths, waitMs) {
    const supervisor = new DaemonSupervisor();
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
        const status = await supervisor.status(paths.projectRoot);
        if (status.ready) {
            return status;
        }
        await sleep(200);
    }
    return supervisor.status(paths.projectRoot);
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function isStaleLock(lockDir) {
    try {
        const stat = statSync(lockDir);
        return Date.now() - stat.mtimeMs > 30_000;
    }
    catch {
        return true;
    }
}
async function fetchDaemonHealth(state) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
        const response = await fetch(`${state.url}/api/v1/daemon/health`, {
            signal: controller.signal,
        });
        if (!response.ok) {
            return null;
        }
        return (await response.json());
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
function isMatchingHealth(state, health) {
    const data = (health?.data || {});
    return (health?.success === true &&
        data.projectRoot === state.projectRoot &&
        data.dataRoot === state.dataRoot &&
        data.projectId === state.projectId &&
        data.version === getPackageVersion() &&
        data.databasePath === state.databasePath &&
        data.schemaMigrationVersion === state.schemaMigrationVersion &&
        data.mode === 'daemon');
}

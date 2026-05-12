import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PACKAGE_ROOT } from '../shared/package-root.js';
import { WorkspaceResolver } from '../shared/WorkspaceResolver.js';
export const DAEMON_STATE_SCHEMA_VERSION = 1;
export function getPackageVersion() {
    try {
        const raw = readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8');
        const pkg = JSON.parse(raw);
        return pkg.version || '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
export function resolveDaemonPaths(projectRoot) {
    const resolver = WorkspaceResolver.fromProject(projectRoot);
    return {
        projectRoot: resolver.projectRoot,
        dataRoot: resolver.dataRoot,
        projectId: resolver.projectId,
        runtimeDir: resolver.runtimeDir,
        statePath: join(resolver.runtimeDir, 'daemon.json'),
        pidPath: join(resolver.runtimeDir, 'daemon.pid'),
        lockDir: join(resolver.runtimeDir, 'daemon.lock'),
        logPath: join(resolver.runtimeDir, 'daemon.log'),
        jobsDir: join(resolver.runtimeDir, 'jobs'),
    };
}
export function ensureDaemonDirs(paths) {
    mkdirSync(paths.runtimeDir, { recursive: true });
    mkdirSync(paths.jobsDir, { recursive: true });
}
export function readDaemonState(statePath) {
    if (!existsSync(statePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
        if (parsed.schemaVersion !== DAEMON_STATE_SCHEMA_VERSION ||
            typeof parsed.token !== 'string' ||
            parsed.token.length === 0) {
            return null;
        }
        return parsed;
    }
    catch {
        return null;
    }
}
export function writeDaemonState(statePath, state) {
    mkdirSync(dirname(statePath), { recursive: true });
    const tmpPath = `${statePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmpPath, statePath);
}
export function removeDaemonState(paths, options = {}) {
    rmSync(paths.statePath, { force: true });
    rmSync(paths.pidPath, { force: true });
    if (options.includeLock !== false) {
        rmSync(paths.lockDir, { recursive: true, force: true });
    }
}

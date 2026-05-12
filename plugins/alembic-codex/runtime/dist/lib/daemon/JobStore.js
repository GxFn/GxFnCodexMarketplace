import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, } from 'node:fs';
import { basename, join } from 'node:path';
import { resolveDaemonPaths } from './DaemonState.js';
const JOB_ID_RE = /^[a-zA-Z0-9_-]+$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const ALLOWED_STATUS_TRANSITIONS = {
    queued: new Set(['queued', 'running', 'completed', 'failed', 'cancelled']),
    running: new Set(['running', 'completed', 'failed', 'cancelled']),
    completed: new Set(['completed']),
    failed: new Set(['failed']),
    cancelled: new Set(['cancelled']),
};
export class JobStore {
    dataRoot;
    jobsDir;
    projectId;
    projectRoot;
    constructor(options) {
        const paths = resolveDaemonPaths(options.projectRoot);
        this.projectRoot = paths.projectRoot;
        this.dataRoot = paths.dataRoot;
        this.projectId = paths.projectId;
        this.jobsDir = paths.jobsDir;
        mkdirSync(this.jobsDir, { recursive: true, mode: 0o700 });
    }
    create(input) {
        const now = new Date().toISOString();
        const job = {
            id: createJobId(input.kind),
            kind: input.kind,
            status: 'queued',
            source: input.source || 'system',
            actor: input.actor,
            channelId: input.channelId,
            client: input.client,
            createdByTool: input.createdByTool,
            projectRoot: this.projectRoot,
            dataRoot: this.dataRoot,
            projectId: this.projectId,
            request: input.request || {},
            sessionId: input.sessionId,
            createdAt: now,
            updatedAt: now,
        };
        this.#write(job);
        return job;
    }
    get(id) {
        if (!isSafeJobId(id)) {
            return null;
        }
        const filePath = this.#jobPath(id);
        if (!existsSync(filePath)) {
            return null;
        }
        try {
            const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
            return parsed?.id === id ? parsed : null;
        }
        catch {
            return null;
        }
    }
    list(options = {}) {
        if (!existsSync(this.jobsDir)) {
            return [];
        }
        const limit = Math.max(1, Math.min(options.limit || 50, 200));
        const jobs = readdirSync(this.jobsDir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => this.get(basename(name, '.json')))
            .filter((job) => Boolean(job))
            .filter((job) => !options.kind || job.kind === options.kind)
            .filter((job) => !options.status || job.status === options.status)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        return jobs.slice(0, limit);
    }
    markRunning(id) {
        const current = this.get(id);
        if (!current) {
            return null;
        }
        if (current.status === 'running') {
            return current;
        }
        if (current.status !== 'queued') {
            return null;
        }
        return this.update(id, {
            status: 'running',
            startedAt: new Date().toISOString(),
        });
    }
    complete(id, result, extra = {}) {
        return this.update(id, {
            status: 'completed',
            result,
            error: undefined,
            bootstrapSessionId: extra.bootstrapSessionId,
            completedAt: new Date().toISOString(),
        });
    }
    fail(id, error) {
        return this.update(id, {
            status: 'failed',
            error: toDaemonJobError(error),
            completedAt: new Date().toISOString(),
        });
    }
    cancel(id, reason = 'Cancelled') {
        return this.update(id, {
            status: 'cancelled',
            error: { message: reason },
            completedAt: new Date().toISOString(),
        });
    }
    markActiveInterrupted(options) {
        const activeJobs = this.#readAll()
            .filter((job) => job.status === 'queued' || job.status === 'running')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const interrupted = [];
        for (const job of activeJobs) {
            const updated = this.update(job.id, {
                status: 'failed',
                error: {
                    ...(options.code ? { code: options.code } : {}),
                    message: options.reason,
                },
                completedAt: new Date().toISOString(),
            });
            if (updated?.status === 'failed') {
                interrupted.push(updated);
            }
        }
        return interrupted;
    }
    update(id, patch) {
        const current = this.get(id);
        if (!current) {
            return null;
        }
        if (isTerminalStatus(current.status)) {
            return current;
        }
        const requestedStatus = patch.status || current.status;
        if (!ALLOWED_STATUS_TRANSITIONS[current.status].has(requestedStatus)) {
            return current;
        }
        const next = {
            ...current,
            ...patch,
            id: current.id,
            kind: current.kind,
            projectRoot: current.projectRoot,
            dataRoot: current.dataRoot,
            projectId: current.projectId,
            createdAt: current.createdAt,
            request: patch.request || current.request,
            updatedAt: new Date().toISOString(),
        };
        this.#write(next);
        return next;
    }
    #jobPath(id) {
        return join(this.jobsDir, `${id}.json`);
    }
    #readAll() {
        if (!existsSync(this.jobsDir)) {
            return [];
        }
        return readdirSync(this.jobsDir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => this.get(basename(name, '.json')))
            .filter((job) => Boolean(job));
    }
    #write(job) {
        mkdirSync(this.jobsDir, { recursive: true, mode: 0o700 });
        const filePath = this.#jobPath(job.id);
        const tmpPath = `${filePath}.${process.pid}.tmp`;
        writeFileSync(tmpPath, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
        renameSync(tmpPath, filePath);
    }
}
export function isSafeJobId(id) {
    return JOB_ID_RE.test(id);
}
export function isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
}
function createJobId(kind) {
    return `${kind}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}
function toDaemonJobError(error) {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
        };
    }
    return { message: String(error) };
}

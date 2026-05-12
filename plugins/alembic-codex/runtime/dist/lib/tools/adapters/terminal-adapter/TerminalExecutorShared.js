import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { sandboxExec } from '#sandbox/SandboxExecutor.js';
import { buildSandboxProfile } from '#sandbox/SandboxPolicy.js';
import { recordTerminalAudit } from './TerminalAudit.js';
export const execFileAsync = promisify(execFile);
export function execFileWithInput(bin, args, input, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        let settled = false;
        let killed = false;
        let timedOut = false;
        const finish = (callback) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeout);
            options.signal?.removeEventListener('abort', abort);
            callback();
        };
        const abort = () => {
            killed = true;
            child.kill('SIGTERM');
        };
        const timeout = setTimeout(() => {
            timedOut = true;
            killed = true;
            child.kill('SIGTERM');
        }, options.timeout);
        options.signal?.addEventListener('abort', abort, { once: true });
        const capture = (target, chunk) => {
            target.push(Buffer.from(chunk));
            if (Buffer.concat(target).byteLength > options.maxBuffer) {
                killed = true;
                child.kill('SIGTERM');
            }
        };
        child.stdout?.on('data', (chunk) => capture(stdout, chunk));
        child.stderr?.on('data', (chunk) => capture(stderr, chunk));
        child.on('error', (err) => finish(() => reject(err)));
        child.on('close', (code) => {
            const stdoutText = Buffer.concat(stdout).toString('utf8');
            const stderrText = Buffer.concat(stderr).toString('utf8');
            if (code === 0 && !timedOut && !options.signal?.aborted) {
                finish(() => resolve({ stdout: stdoutText, stderr: stderrText }));
                return;
            }
            const error = new Error(stderrText || `Process exited with code ${code}`);
            error.code = code ?? 1;
            error.killed = killed;
            error.stdout = stdoutText;
            error.stderr = stderrText;
            finish(() => reject(error));
        });
        child.stdin?.end(input);
    });
}
export function statusForFailure(request, failure) {
    return request.context.abortSignal?.aborted ? 'aborted' : failure.killed ? 'timeout' : 'error';
}
export async function recordAndReturn(request, envelope) {
    await recordTerminalAudit(request, envelope);
    return envelope;
}
export function getTerminalSessionManager(request, fallback) {
    try {
        const candidate = request.context.services.get('terminalSessionManager');
        if (isTerminalSessionManager(candidate)) {
            return candidate;
        }
    }
    catch {
        return fallback;
    }
    return fallback;
}
export function scriptAuditData(script) {
    return {
        shell: script.shell,
        scriptHash: script.scriptHash,
        verificationHash: createHash('sha256').update(script.script).digest('hex'),
        lineCount: script.lineCount,
        byteLength: script.byteLength,
    };
}
export function shellAuditData(shell) {
    return {
        shell: shell.shell,
        commandHash: shell.commandHash,
        verificationHash: createHash('sha256').update(shell.command).digest('hex'),
        lineCount: shell.lineCount,
        byteLength: shell.byteLength,
    };
}
function isTerminalSessionManager(value) {
    return (!!value &&
        typeof value === 'object' &&
        typeof value.acquire === 'function' &&
        typeof value.snapshot === 'function' &&
        typeof value.list === 'function' &&
        typeof value.close === 'function' &&
        typeof value.cleanup === 'function');
}
/**
 * sandbox-exec 感知的 execFileAsync 替代。
 * 当提供 sandboxInput 且沙箱未 disabled 时，命令在 macOS Seatbelt 沙箱中运行。
 */
export async function sandboxedExecFile(bin, args, options, sandboxInput) {
    if (!sandboxInput) {
        const r = await execFileAsync(bin, args, options);
        return { stdout: r.stdout, stderr: r.stderr };
    }
    const profile = buildSandboxProfile({
        network: sandboxInput.network,
        filesystem: sandboxInput.filesystem,
        cwd: options.cwd,
        projectRoot: sandboxInput.projectRoot,
        timeoutMs: options.timeout,
        maxOutputBytes: options.maxBuffer,
        env: sandboxInput.env,
    });
    if (profile.mode === 'disabled') {
        const r = await execFileAsync(bin, args, options);
        return {
            stdout: r.stdout,
            stderr: r.stderr,
            sandbox: {
                mode: 'disabled',
                sandboxed: false,
                networkDenied: false,
                filesystemMode: sandboxInput.filesystem,
                envStripped: 0,
            },
        };
    }
    const result = await sandboxExec({
        bin,
        args,
        cwd: options.cwd,
        env: (options.env ?? {}),
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        signal: options.signal,
    }, profile);
    const sandboxMeta = {
        mode: profile.mode,
        sandboxed: result.sandboxed,
        degradeReason: result.degradeReason,
        violations: result.violations,
        networkDenied: !profile.network.allow,
        filesystemMode: sandboxInput.filesystem,
        envStripped: profile.environment.strip.length,
    };
    if (result.exitCode !== 0) {
        const error = new Error(result.stderr || `Process exited with code ${result.exitCode}`);
        error.code = result.exitCode;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        throw Object.assign(error, { _sandboxMeta: sandboxMeta });
    }
    return { stdout: result.stdout, stderr: result.stderr, sandbox: sandboxMeta };
}
/**
 * sandbox-exec 感知的 execFileWithInput 替代。
 * PTY stdin 模式在沙箱中运行。
 */
export async function sandboxedExecFileWithInput(bin, args, input, options, sandboxInput) {
    if (!sandboxInput) {
        return execFileWithInput(bin, args, input, options);
    }
    const profile = buildSandboxProfile({
        network: sandboxInput.network,
        filesystem: sandboxInput.filesystem,
        cwd: options.cwd,
        projectRoot: sandboxInput.projectRoot,
        timeoutMs: options.timeout,
        maxOutputBytes: options.maxBuffer,
        env: sandboxInput.env,
    });
    if (profile.mode === 'disabled') {
        const r = await execFileWithInput(bin, args, input, options);
        return {
            stdout: r.stdout,
            stderr: r.stderr,
            sandbox: {
                mode: 'disabled',
                sandboxed: false,
                networkDenied: false,
                filesystemMode: sandboxInput.filesystem,
                envStripped: 0,
            },
        };
    }
    const result = await sandboxExec({
        bin,
        args,
        cwd: options.cwd,
        env: (options.env ?? {}),
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        signal: options.signal,
        stdin: input,
    }, profile);
    const sandboxMeta = {
        mode: profile.mode,
        sandboxed: result.sandboxed,
        degradeReason: result.degradeReason,
        violations: result.violations,
        networkDenied: !profile.network.allow,
        filesystemMode: sandboxInput.filesystem,
        envStripped: profile.environment.strip.length,
    };
    if (result.exitCode !== 0) {
        const error = new Error(result.stderr || `Process exited with code ${result.exitCode}`);
        error.code = result.exitCode;
        error.killed = false;
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        throw Object.assign(error, { _sandboxMeta: sandboxMeta });
    }
    return { stdout: result.stdout, stderr: result.stderr, sandbox: sandboxMeta };
}

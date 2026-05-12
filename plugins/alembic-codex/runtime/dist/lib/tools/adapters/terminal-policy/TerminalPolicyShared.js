import { createHash } from 'node:crypto';
import path from 'node:path';
export const DENIED_BINS = new Set([
    'sudo',
    'su',
    'shutdown',
    'reboot',
    'halt',
    'mkfs',
    'dd',
    'passwd',
    'killall',
]);
export const SHELL_BINS = new Set(['sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'osascript']);
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_SCRIPT_BYTES = 64 * 1024;
export const MAX_SHELL_COMMAND_BYTES = 16 * 1024;
export const MAX_PTY_STDIN_BYTES = 16 * 1024;
const MAX_ENV_KEYS = 32;
const MAX_ENV_VALUE_LENGTH = 4096;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const PROTECTED_ENV_KEYS = new Set(['CI', 'GIT_PAGER', 'GIT_TERMINAL_PROMPT', 'LESS', 'PAGER']);
const SENSITIVE_ENV_NAME_PATTERN = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE_KEY)/i;
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function normalizeEnv(value, toolName = 'terminal_run') {
    if (value === undefined || value === null) {
        return { ok: true, env: {} };
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: `${toolName} env must be an object of string values` };
    }
    const input = value;
    const keys = Object.keys(input);
    if (keys.length > MAX_ENV_KEYS) {
        return { ok: false, error: `${toolName} env can include at most ${MAX_ENV_KEYS} keys` };
    }
    const env = {};
    for (const key of keys) {
        if (!ENV_NAME_PATTERN.test(key)) {
            return { ok: false, error: `${toolName} env key "${key}" is invalid` };
        }
        if (PROTECTED_ENV_KEYS.has(key)) {
            return { ok: false, error: `${toolName} env key "${key}" is controlled by policy` };
        }
        const envValue = input[key];
        if (typeof envValue !== 'string') {
            return { ok: false, error: `${toolName} env value for "${key}" must be a string` };
        }
        if (envValue.length > MAX_ENV_VALUE_LENGTH) {
            return { ok: false, error: `${toolName} env value for "${key}" is too large` };
        }
        env[key] = envValue;
    }
    return { ok: true, env };
}
export function envKeys(env) {
    return Object.keys(env).sort();
}
export function sensitiveEnvKeys(env) {
    return envKeys(env).filter((key) => SENSITIVE_ENV_NAME_PATTERN.test(key));
}
export function resolveCwd(requested, projectRoot) {
    const root = path.resolve(projectRoot);
    const resolved = requested
        ? path.resolve(path.isAbsolute(requested) ? requested : path.join(root, requested))
        : root;
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return { ok: false, error: `terminal cwd "${requested}" is outside project root` };
    }
    return { ok: true, path: resolved };
}
export function normalizeTimeout(requested, manifestTimeout) {
    const base = Number.isFinite(manifestTimeout) && manifestTimeout > 0 ? manifestTimeout : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(requested) || !requested || requested <= 0) {
        return base;
    }
    return Math.min(requested, base);
}
export function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
export function containsShellMeta(value) {
    return /[;&|<>`]|\$\(/.test(value);
}
export function isNetworkMode(value) {
    return value === 'none' || value === 'allowlisted' || value === 'open';
}
export function isFilesystemMode(value) {
    return value === 'read-only' || value === 'project-write' || value === 'workspace-write';
}
export function isInteractivityMode(value) {
    return value === 'never' || value === 'allowed';
}
export function countScriptLines(script) {
    return script.length === 0 ? 0 : script.split(/\r\n|\r|\n/).length;
}
export function basename(bin) {
    return bin.split('/').filter(Boolean).at(-1) || bin;
}
export function formatCommandPreview(bin, args) {
    return [bin, ...args].map(quotePreviewArg).join(' ');
}
export function isRecursiveForceRemove(args) {
    return args.some((arg) => /^-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*$/.test(arg));
}
export function detectDangerousShellPayload(payload, rulePrefix, toolName) {
    const checks = [
        {
            rule: `${rulePrefix}-privilege-escalation`,
            reason: `Privilege escalation commands are blocked in ${toolName}`,
            pattern: /(^|\s)(sudo|su)\b/m,
        },
        {
            rule: `${rulePrefix}-destructive-bin`,
            reason: `Destructive system executables are blocked in ${toolName}`,
            pattern: /(^|\s)(dd|mkfs|shutdown|reboot|halt|passwd|killall)\b/m,
        },
        {
            rule: `${rulePrefix}-rm-recursive-force`,
            reason: `Recursive force remove is blocked in ${toolName}`,
            pattern: /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\b|\brm\s+-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*\b/m,
        },
        {
            rule: `${rulePrefix}-remote-shell-pipe`,
            reason: `Piping remote content into a shell is blocked in ${toolName}`,
            pattern: /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh|fish)\b/m,
        },
        {
            rule: `${rulePrefix}-eval`,
            reason: `eval is blocked in ${toolName}`,
            pattern: /(^|\s)eval\s+/m,
        },
        {
            rule: `${rulePrefix}-fork-bomb`,
            reason: `Fork-bomb-like shell function syntax is blocked in ${toolName}`,
            pattern: /:\s*\(\s*\)\s*\{/m,
        },
    ];
    for (const check of checks) {
        if (check.pattern.test(payload)) {
            return { rule: check.rule, reason: check.reason };
        }
    }
    return null;
}
export function buildShellPayloadPolicyInput(args, options) {
    if (typeof args.command !== 'string' || args.command.trim().length === 0) {
        return { ok: false, error: `${options.toolName} requires a non-empty string "command"` };
    }
    const byteLength = Buffer.byteLength(args.command, 'utf8');
    if (byteLength > options.maxBytes) {
        return {
            ok: false,
            error: `${options.toolName} command can be at most ${options.maxBytes} bytes`,
        };
    }
    if (args.shell !== undefined && args.shell !== 'sh' && args.shell !== '/bin/sh') {
        return { ok: false, error: `${options.toolName} shell must be "sh" or "/bin/sh"` };
    }
    const env = normalizeEnv(args.env, options.toolName);
    if (!env.ok) {
        return { ok: false, error: env.error };
    }
    const cwd = resolveCwd(typeof args.cwd === 'string' ? args.cwd : undefined, options.projectRoot);
    if (!cwd.ok) {
        return { ok: false, error: cwd.error };
    }
    if (args.interactive !== undefined && !isInteractivityMode(args.interactive)) {
        return {
            ok: false,
            error: `${options.toolName} interactive must be "never" or "allowed"`,
        };
    }
    return {
        ok: true,
        input: {
            command: args.command,
            commandHash: sha256(args.command),
            lineCount: countScriptLines(args.command),
            byteLength,
            shell: '/bin/sh',
            env: env.env,
            cwd: cwd.path,
            projectRoot: options.projectRoot,
            timeoutMs: normalizeTimeout(typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined, options.manifestTimeoutMs),
            network: isNetworkMode(args.network) ? args.network : 'none',
            filesystem: isFilesystemMode(args.filesystem) ? args.filesystem : 'read-only',
            interactive: isInteractivityMode(args.interactive)
                ? args.interactive
                : options.defaultInteractive,
        },
    };
}
export function normalizePtyDimension(value, fallback, name) {
    if (value === undefined || value === null) {
        return { ok: true, value: fallback };
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 500) {
        return { ok: false, error: `terminal_pty ${name} must be an integer from 1 to 500` };
    }
    return { ok: true, value };
}
function quotePreviewArg(value) {
    if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}

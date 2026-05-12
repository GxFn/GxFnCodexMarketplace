import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { RESOURCES_DIR } from '../../shared/package-root.js';
const execFileAsync = promisify(execFile);
const MAX_WINDOW_TITLE_LENGTH = 200;
export class MacSystemAdapter {
    kind = 'macos-adapter';
    #platform;
    #screenshotBinaryPath;
    #execFile;
    constructor(options = {}) {
        this.#platform = options.platform ?? process.platform;
        this.#screenshotBinaryPath =
            options.screenshotBinaryPath ?? path.join(RESOURCES_DIR, 'native-ui', 'screenshot');
        this.#execFile = options.execFile ?? execFileAsync;
    }
    async execute(request) {
        const startedAt = new Date();
        const startedMs = Date.now();
        try {
            const result = await this.#execute(request);
            return envelopeForMacResult(request, startedAt, startedMs, result.status, result.content, result.artifacts);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return envelopeForMacResult(request, startedAt, startedMs, 'error', {
                success: false,
                error: { code: 'MACOS_ADAPTER_ERROR', message },
            });
        }
    }
    async #execute(request) {
        switch (request.manifest.id) {
            case 'mac_system_info':
                return { status: 'success', content: this.#systemInfo() };
            case 'mac_permission_status':
                return { status: 'success', content: this.#permissionStatus(request) };
            case 'mac_window_list':
                return await this.#windowList(request);
            case 'mac_screenshot':
                return await this.#screenshot(request);
            default:
                return macBlocked(`Unknown macOS capability "${request.manifest.id}"`, 'UNKNOWN_MACOS_CAPABILITY');
        }
    }
    #systemInfo() {
        return {
            success: true,
            data: {
                platform: this.#platform,
                isMacOS: this.#platform === 'darwin',
                arch: os.arch(),
                release: os.release(),
                version: typeof os.version === 'function' ? os.version() : null,
                hostname: os.hostname(),
            },
        };
    }
    #permissionStatus(request) {
        const requested = normalizePermission(request.args.permission);
        const permissions = requested === 'all' ? ['screen-recording', 'accessibility', 'automation'] : [requested];
        return {
            success: true,
            data: {
                platform: this.#platform,
                permissions: permissions.map((permission) => this.#describePermission(permission)),
                policy: {
                    checkedWithoutPrompt: true,
                    promptsUser: false,
                    bypassesTcc: false,
                },
            },
        };
    }
    #describePermission(permission) {
        if (this.#platform !== 'darwin') {
            return {
                permission,
                status: 'unavailable',
                reason: 'macOS permissions are only available on darwin.',
            };
        }
        if (permission === 'screen-recording' && !fs.existsSync(this.#screenshotBinaryPath)) {
            return {
                permission,
                status: 'unavailable',
                reason: 'ScreenCaptureKit helper is not built.',
            };
        }
        return {
            permission,
            status: 'unknown',
            reason: 'This adapter does not prompt for or bypass TCC permissions.',
        };
    }
    async #windowList(request) {
        const unavailable = this.#requireMacScreenshotBinary();
        if (unavailable) {
            return unavailable;
        }
        const output = await this.#runScreenshotBinary(request, ['--list-windows']);
        const windows = parseJsonArray(output.stdout);
        const artifact = writeJsonArtifact(request, 'windows.json', windows);
        return {
            status: 'success',
            content: {
                success: true,
                data: {
                    total: windows.length,
                    artifact: artifactSummary(artifact),
                    privacy: {
                        titlesIncludedOnlyInArtifact: true,
                        containsWindowTitles: true,
                    },
                },
            },
            artifacts: [artifact],
        };
    }
    async #screenshot(request) {
        const unavailable = this.#requireMacScreenshotBinary();
        if (unavailable) {
            return unavailable;
        }
        const format = normalizeImageFormat(request.args.format);
        const scale = normalizeScale(request.args.scale);
        const windowTitle = normalizeWindowTitle(request.args.windowTitle);
        const outputPath = createArtifactPath(request, `screenshot.${format === 'png' ? 'png' : 'jpg'}`);
        const helperOutputPath = path.join(os.tmpdir(), `alembic-${request.context.callId}-screenshot.${format === 'png' ? 'png' : 'jpg'}`);
        const args = ['--output', helperOutputPath, '--format', format, '--scale', String(scale)];
        if (windowTitle) {
            args.push('--window', windowTitle);
        }
        const output = await this.#runScreenshotBinary(request, args);
        const image = fs.readFileSync(helperOutputPath);
        writeArtifactFile(request, outputPath, image);
        try {
            fs.unlinkSync(helperOutputPath);
        }
        catch {
            // Best-effort cleanup; artifact has already been materialized through the adapter.
        }
        const result = parseJsonObject(output.stdout);
        const artifact = imageArtifact(request, outputPath, format, image.length);
        return {
            status: 'success',
            content: {
                success: true,
                data: {
                    width: result.width,
                    height: result.height,
                    format,
                    bytes: result.bytes,
                    scale,
                    windowTitleMatched: Boolean(windowTitle),
                    artifact: artifactSummary(artifact),
                },
            },
            artifacts: [artifact],
        };
    }
    #requireMacScreenshotBinary() {
        if (this.#platform !== 'darwin') {
            return macBlocked('macOS adapter capability is only available on darwin.', 'MACOS_UNAVAILABLE');
        }
        if (!fs.existsSync(this.#screenshotBinaryPath)) {
            return macBlocked('ScreenCaptureKit helper is not built.', 'MACOS_HELPER_MISSING');
        }
        return null;
    }
    async #runScreenshotBinary(request, args) {
        try {
            return await this.#execFile(this.#screenshotBinaryPath, args, {
                timeout: request.manifest.execution.timeoutMs,
                signal: request.context.abortSignal,
            });
        }
        catch (err) {
            throw macExecError(err);
        }
    }
}
function normalizePermission(value) {
    return value === 'screen-recording' ||
        value === 'accessibility' ||
        value === 'automation' ||
        value === 'all'
        ? value
        : 'all';
}
function normalizeImageFormat(value) {
    return value === 'png' || value === 'jpeg' ? value : 'jpeg';
}
function normalizeScale(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1;
    }
    return Math.min(1, Math.max(0.1, value));
}
function normalizeWindowTitle(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().slice(0, MAX_WINDOW_TITLE_LENGTH);
}
function parseJsonArray(value) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new Error('macOS helper returned non-array window list output');
    }
    return parsed;
}
function parseJsonObject(value) {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('macOS helper returned non-object screenshot output');
    }
    return parsed;
}
function writeJsonArtifact(request, fileName, value) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    const absolutePath = createArtifactPath(request, fileName);
    writeArtifactFile(request, absolutePath, content);
    return {
        id: `${request.context.callId}:${path.parse(fileName).name}`,
        kind: 'resource',
        uri: pathToFileURL(absolutePath).href,
        mimeType: 'application/json',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
    };
}
function imageArtifact(request, absolutePath, format, sizeBytes) {
    return {
        id: `${request.context.callId}:screenshot`,
        kind: 'image',
        uri: pathToFileURL(absolutePath).href,
        mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
        sizeBytes,
    };
}
function artifactSummary(artifact) {
    return {
        id: artifact.id,
        kind: artifact.kind,
        uri: artifact.uri,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
    };
}
function createArtifactTarget(request, fileName) {
    const writeZone = getWriteZone(request);
    if (writeZone) {
        return {
            writeZone,
            target: writeZone.runtime(`artifacts/tools/${request.context.callId}/${fileName}`),
        };
    }
    return {
        writeZone: null,
        target: {
            absolute: path.join(request.context.projectRoot, '.asd', 'artifacts', 'tools', request.context.callId, fileName),
        },
    };
}
function createArtifactPath(request, fileName) {
    return createArtifactTarget(request, fileName).target.absolute;
}
function writeArtifactFile(request, absolutePath, content) {
    const writeZoneTarget = createArtifactTarget(request, path.basename(absolutePath));
    if (writeZoneTarget.writeZone && writeZoneTarget.target.absolute === absolutePath) {
        writeZoneTarget.writeZone.writeFile(writeZoneTarget.target, content);
        return;
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
}
function getWriteZone(request) {
    try {
        const candidate = request.context.services.get('writeZone');
        if (candidate &&
            typeof candidate === 'object' &&
            typeof candidate.runtime === 'function' &&
            typeof candidate.writeFile === 'function') {
            return candidate;
        }
    }
    catch {
        return null;
    }
    return null;
}
function macBlocked(message, code) {
    return {
        status: 'blocked',
        content: {
            success: false,
            error: { code, message },
        },
    };
}
function macExecError(err) {
    const error = err;
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const message = extractHelperError(stderr || stdout) || stringOrDefault(error.message, 'macOS helper failed');
    const wrapped = new Error(message);
    wrapped.code = error.code;
    return wrapped;
}
function extractHelperError(value) {
    if (!value.trim()) {
        return '';
    }
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
            return parsed.error;
        }
    }
    catch {
        return value.trim();
    }
    return value.trim();
}
function stringOrDefault(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
}
function envelopeForMacResult(request, startedAt, startedMs, status, structuredContent, artifacts = []) {
    const success = structuredContent.success !== false && status === 'success';
    const message = extractMessage(structuredContent) ||
        (success ? 'macOS capability completed.' : 'macOS capability failed.');
    return {
        ok: success,
        toolId: request.manifest.id,
        callId: request.context.callId,
        parentCallId: request.context.parentCallId,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedMs,
        status,
        text: message,
        structuredContent,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        diagnostics: {
            degraded: false,
            fallbackUsed: false,
            warnings: success
                ? []
                : [{ code: 'macos_adapter_error', message, tool: request.manifest.id }],
            timedOutStages: [],
            blockedTools: status === 'blocked' ? [{ tool: request.manifest.id, reason: message }] : [],
            truncatedToolCalls: 0,
            emptyResponses: 0,
            aiErrorCount: 0,
            gateFailures: status === 'blocked' ? [{ stage: 'execute', action: 'macos-policy', reason: message }] : [],
        },
        trust: {
            source: 'macos',
            sanitized: true,
            containsUntrustedText: request.manifest.externalTrust?.outputContainsUntrustedText ?? false,
            containsSecrets: Boolean(artifacts.length),
        },
    };
}
function extractMessage(content) {
    const error = content.error;
    if (typeof error?.message === 'string') {
        return error.message;
    }
    if (typeof content.message === 'string') {
        return content.message;
    }
    return null;
}
export default MacSystemAdapter;

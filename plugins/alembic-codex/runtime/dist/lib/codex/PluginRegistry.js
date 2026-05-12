import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCodexRuntimeContext } from './RuntimeContext.js';
export const CODEX_REQUIRED_SKILLS = [
    'alembic',
    'alembic-create',
    'alembic-devdocs',
    'alembic-guard',
    'alembic-recipes',
    'alembic-structure',
];
export function loadCodexPluginRegistry(context = resolveCodexRuntimeContext()) {
    const manifestPath = join(context.pluginRoot, '.codex-plugin', 'plugin.json');
    const mcpPath = join(context.pluginRoot, '.mcp.json');
    const readmePath = join(context.pluginRoot, 'README.md');
    const manifest = readJsonObject(manifestPath);
    const mcpJson = readJsonObject(mcpPath);
    const server = asPlainRecord(asPlainRecord(mcpJson.value?.mcpServers)?.alembic);
    const args = Array.isArray(server?.args)
        ? server.args.filter((arg) => typeof arg === 'string')
        : [];
    const manifestInterface = asPlainRecord(manifest.value?.interface);
    return {
        channel: readJsonObject(context.channelPath),
        context,
        marketplace: readJsonObject(context.marketplacePath),
        mcp: {
            args,
            env: asPlainRecord(server?.env),
            json: mcpJson,
            server,
        },
        plugin: {
            assets: collectManifestAssetPaths(manifestInterface),
            manifest,
            readme: existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '',
            readmePath,
            root: context.pluginRoot,
        },
    };
}
export function readJsonObject(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return {
            ok: Boolean(parsed && typeof parsed === 'object'),
            path: filePath,
            value: asPlainRecord(parsed),
        };
    }
    catch {
        return { ok: false, path: filePath, value: null };
    }
}
export function collectManifestAssetPaths(manifestInterface) {
    const assets = [
        asString(manifestInterface?.composerIcon),
        asString(manifestInterface?.logo),
        ...(Array.isArray(manifestInterface?.screenshots)
            ? manifestInterface.screenshots.map((value) => asString(value))
            : []),
    ];
    return assets.filter((asset) => Boolean(asset));
}
export function asPlainRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function asString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

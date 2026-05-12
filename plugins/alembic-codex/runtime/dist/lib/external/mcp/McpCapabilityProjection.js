import { TOOL_GATEWAY_MAP } from './tools.js';
export function buildMcpToolCapabilities(tools, options = {}) {
    const context = createMcpProjectionContext(options);
    const manifests = tools.map((tool) => buildMcpToolCapability(tool, context));
    return { manifests };
}
function buildMcpToolCapability(tool, context) {
    const gateway = TOOL_GATEWAY_MAP[tool.name];
    const sideEffect = Boolean(gateway);
    const isAdmin = tool.tier === 'admin';
    const trust = resolveMcpToolTrust(tool, context);
    return {
        id: tool.name,
        title: tool.name,
        kind: 'mcp-tool',
        description: tool.description || tool.name,
        owner: 'mcp',
        lifecycle: 'active',
        surfaces: ['mcp'],
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        risk: {
            sideEffect,
            dataAccess: 'project',
            writeScope: sideEffect ? 'data-root' : 'none',
            network: 'none',
            credentialAccess: 'none',
            requiresHumanConfirmation: sideEffect ? 'on-risk' : 'never',
            owaspTags: sideEffect ? ['excessive-agency'] : [],
        },
        execution: {
            adapter: 'mcp',
            timeoutMs: 60_000,
            maxOutputBytes: 256_000,
            abortMode: 'cooperative',
            cachePolicy: 'none',
            concurrency: sideEffect ? 'single' : 'parallel-safe',
            artifactMode: 'inline',
        },
        governance: {
            gatewayAction: gateway?.action || (gateway?.resolver ? `dynamic:${tool.name}` : undefined),
            gatewayResource: gateway?.resource || (gateway?.resolver ? 'dynamic' : undefined),
            auditLevel: sideEffect ? 'checkOnly' : 'none',
            policyProfile: isAdmin ? 'admin' : sideEffect ? 'write' : 'read',
            approvalPolicy: 'auto',
            allowedRoles: isAdmin
                ? ['admin', 'developer', 'owner']
                : ['admin', 'developer', 'owner', 'agent', 'external_agent', 'contributor', 'visitor'],
            allowInComposer: !sideEffect,
            allowInRemoteMcp: true,
            allowInNonInteractive: !sideEffect,
        },
        externalTrust: {
            source: 'mcp-server',
            serverId: trust.serverId,
            trusted: trust.trusted,
            reason: trust.reason,
            outputContainsUntrustedText: trust.outputContainsUntrustedText,
            allowlisted: trust.allowlisted,
            registration: trust.registration,
        },
        evals: {
            required: false,
            cases: [],
        },
    };
}
function createMcpProjectionContext(options) {
    const defaultServerId = options.defaultServerId || 'alembic-local';
    const servers = new Map();
    servers.set(defaultServerId, {
        serverId: defaultServerId,
        source: 'bundled',
        trusted: true,
        reason: 'Bundled Alembic MCP server declaration',
        outputContainsUntrustedText: true,
    });
    for (const server of options.servers || []) {
        servers.set(server.serverId, server);
    }
    return {
        defaultServerId,
        servers,
        trustedServerIds: new Set(options.trustedServerIds || []),
    };
}
function resolveMcpToolTrust(tool, context) {
    const serverId = tool.serverId || context.defaultServerId;
    const registration = context.servers.get(serverId) ||
        {
            serverId,
            source: tool.serverSource || 'unknown',
        };
    const allowlisted = registration.source === 'bundled' ||
        registration.trusted === true ||
        context.trustedServerIds.has(serverId);
    const explicitToolTrust = tool.trust?.trusted;
    const trusted = explicitToolTrust ?? allowlisted;
    const reason = tool.trust?.reason ||
        registration.reason ||
        (trusted
            ? `MCP server "${serverId}" is trusted by registration policy`
            : `MCP server "${serverId}" is not allowlisted`);
    return {
        serverId,
        trusted,
        reason,
        outputContainsUntrustedText: registration.outputContainsUntrustedText ?? true,
        allowlisted,
        registration: {
            source: registration.source,
            configPath: registration.configPath,
            declaredBy: registration.declaredBy,
        },
    };
}

/**
 * UnifiedToolCatalog — 统一工具目录 (单源真相)
 *
 * 合并 `CapabilityCatalog`（manifest 查询）和 `ToolRegistry`（handler 查询）。
 * 继承 `CapabilityCatalog` 以保持对 `ToolRouter` 的兼容。
 *
 * 内部存储 `ToolDefinitionV2`，对外暴露：
 *   - getManifest(id) — 返回 ToolCapabilityManifest（兼容 GovernanceEngine）
 *   - getHandler(id) — 返回 handler function
 *   - getInternalTool(id) — 兼容 InternalToolHandlerStore
 *   - toToolSchemas(ids?, model?) — 支持 per-model 描述覆盖
 *
 * @module tools/catalog/UnifiedToolCatalog
 */
import { CapabilityCatalog } from '#tools/catalog/CapabilityCatalog.js';
function v2ToManifest(def) {
    const surfaces = [
        'runtime',
    ];
    if (def.governance.allowInRemoteMcp) {
        surfaces.push('mcp');
    }
    if (!def.risk.sideEffect) {
        surfaces.push('http');
    }
    return {
        id: def.id,
        title: def.title,
        kind: def.kind,
        description: def.description,
        owner: 'core',
        lifecycle: 'active',
        surfaces,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        risk: def.risk,
        execution: def.execution,
        governance: def.governance,
        evals: {
            required: def.risk.sideEffect || def.governance.policyProfile !== 'read',
            cases: [],
        },
    };
}
function v2ToSchemaProjection(def, model) {
    const override = model ? matchModelOverride(def, model) : undefined;
    return {
        name: def.id,
        description: override?.description ?? def.description,
        parameters: override?.inputSchema ?? def.inputSchema,
    };
}
function matchModelOverride(def, model) {
    if (!def.modelOverrides) {
        return undefined;
    }
    for (const [pattern, override] of Object.entries(def.modelOverrides)) {
        if (matchGlob(model, pattern)) {
            return override;
        }
    }
    return undefined;
}
function matchGlob(value, pattern) {
    if (pattern === '*') {
        return true;
    }
    const starIdx = pattern.indexOf('*');
    if (starIdx < 0) {
        return value === pattern;
    }
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    return (value.startsWith(prefix) &&
        value.endsWith(suffix) &&
        value.length >= prefix.length + suffix.length);
}
export class UnifiedToolCatalog extends CapabilityCatalog {
    #defs = new Map();
    #temporary = new Map();
    #router = null;
    constructor(defs = []) {
        super([]);
        this.registerV2All(defs);
    }
    // ── Router binding (replaces ToolRegistry.setRouter/getRouter) ──
    setRouter(router) {
        this.#router = router;
    }
    getRouter() {
        return this.#router;
    }
    // ── V2 Registration ──
    registerV2(def) {
        if (this.#defs.has(def.id)) {
            throw new Error(`Tool '${def.id}' already registered in UnifiedToolCatalog`);
        }
        this.#defs.set(def.id, def);
        // Also register as CapabilityManifest for backward compatibility
        super.register(v2ToManifest(def));
    }
    registerV2All(defs) {
        for (const def of defs) {
            this.registerV2(def);
        }
    }
    // ── Temporary tools (Forge) ──
    registerTemporary(def) {
        this.#temporary.set(def.id, def);
        this.#defs.set(def.id, def);
        try {
            super.register(v2ToManifest(def));
        }
        catch {
            // Already registered — update via unregister + re-register
            super.unregister(def.id);
            super.register(v2ToManifest(def));
        }
    }
    unregisterTemporary(id) {
        this.#temporary.delete(id);
        this.#defs.delete(id);
        return super.unregister(id);
    }
    // ── Handler Access ──
    getHandler(id) {
        return this.#defs.get(id)?.handler ?? null;
    }
    getDefinitionV2(id) {
        return this.#defs.get(id) ?? null;
    }
    // ── InternalToolHandlerStore compatibility ──
    getInternalTool(name) {
        const def = this.#defs.get(name);
        if (!def) {
            return null;
        }
        return {
            name: def.id,
            description: def.description,
            parameters: def.inputSchema,
            metadata: {
                owner: 'core',
                lifecycle: 'active',
                sideEffect: def.risk.sideEffect,
                policyProfile: def.governance.policyProfile,
                auditLevel: def.governance.auditLevel,
            },
            handler: def.handler,
        };
    }
    hasInternalTool(name) {
        return this.#defs.has(name);
    }
    // ── ForgedInternalToolStore compatibility ──
    projectForgedTool(tool) {
        if (this.#defs.has(tool.name) && !this.#temporary.has(tool.name)) {
            throw new Error(`Forged tool "${tool.name}" conflicts with an existing internal tool. Use a unique forge namespace.`);
        }
        const v2Def = {
            id: tool.name,
            title: tool.name,
            description: `[Forged:${tool.forgeMode}] ${tool.description}`,
            kind: 'internal-tool',
            inputSchema: tool.parameters ?? { type: 'object', properties: {} },
            handler: tool.handler,
            risk: {
                sideEffect: true,
                dataAccess: 'project',
                writeScope: 'project',
                network: 'none',
                credentialAccess: 'none',
                requiresHumanConfirmation: 'never',
                owaspTags: [],
            },
            governance: {
                policyProfile: 'write',
                auditLevel: 'full',
                approvalPolicy: 'auto',
                allowedRoles: ['developer'],
                allowInComposer: false,
                allowInRemoteMcp: false,
                allowInNonInteractive: true,
            },
            execution: {
                adapter: 'internal',
                timeoutMs: 30_000,
                maxOutputBytes: 100_000,
                abortMode: 'cooperative',
                cachePolicy: 'none',
                concurrency: 'single',
                artifactMode: 'inline',
            },
        };
        this.registerTemporary(v2Def);
    }
    revokeForgedTool(name) {
        return this.unregisterTemporary(name);
    }
    // ── Per-model Schema Projection ──
    /**
     * Override parent's toToolSchemas to support per-model description overrides.
     * When `model` is provided, tool descriptions are matched against modelOverrides.
     */
    toToolSchemasForModel(ids, model) {
        const manifests = this.list({ ids });
        return manifests.map((manifest) => {
            const def = this.#defs.get(manifest.id);
            if (def && model) {
                return v2ToSchemaProjection(def, model);
            }
            return {
                name: manifest.id,
                description: manifest.description,
                parameters: manifest.inputSchema,
            };
        });
    }
    // ── Lazy Loading: lightweight / mixed schema projection ──
    /** Tools that have been "expanded" (used by the agent — full schema shown). */
    #expandedToolIds = new Set();
    /** Mark a tool as expanded (called after the tool is used in a round). */
    markExpanded(toolId) {
        this.#expandedToolIds.add(toolId);
    }
    /** Mark multiple tools as expanded. */
    markExpandedAll(toolIds) {
        for (const id of toolIds) {
            this.#expandedToolIds.add(id);
        }
    }
    /** Reset expanded state (e.g. between pipeline stages). */
    resetExpanded() {
        this.#expandedToolIds.clear();
    }
    /**
     * Lightweight schema: name + one-line description only (no parameters).
     * Used for tools the agent hasn't touched yet to reduce token overhead.
     */
    toLightweightSchemas(ids) {
        return this.list({ ids }).map((manifest) => ({
            name: manifest.id,
            description: manifest.description.split('\n')[0].slice(0, 120),
            parameters: { type: 'object', properties: {} },
        }));
    }
    /**
     * Mixed schema projection:
     *   - Expanded tools → full schema (with optional model override)
     *   - Not-yet-used tools → lightweight (name + description only)
     *
     * This reduces the total token cost of tool schemas from ~50-80% to ~20-30%
     * in large toolsets (30+ tools).
     *
     * @param ids - Allowed tool IDs
     * @param model - Current model name for per-model overrides
     * @param firstRound - If true, all tools get full schema (first iteration)
     */
    toMixedSchemas(ids, model, firstRound = false) {
        if (firstRound) {
            return this.toToolSchemasForModel(ids, model);
        }
        const manifests = this.list({ ids });
        return manifests.map((manifest) => {
            if (this.#expandedToolIds.has(manifest.id)) {
                const def = this.#defs.get(manifest.id);
                if (def && model) {
                    return v2ToSchemaProjection(def, model);
                }
                return {
                    name: manifest.id,
                    description: manifest.description,
                    parameters: manifest.inputSchema,
                };
            }
            return {
                name: manifest.id,
                description: manifest.description.split('\n')[0].slice(0, 120),
                parameters: { type: 'object', properties: {} },
            };
        });
    }
    // ── Inspection ──
    get v2Size() {
        return this.#defs.size;
    }
    get expandedCount() {
        return this.#expandedToolIds.size;
    }
    listV2Ids() {
        return [...this.#defs.keys()];
    }
}
export default UnifiedToolCatalog;

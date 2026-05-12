/**
 * ToolForge — 工具锻造主编排器
 *
 * 三级锻造策略：
 *   Reuse (0ms)   → 直接重用注册表中已有工具
 *   Compose (10ms) → 通过 DynamicComposer 组合已有原子工具
 *   Generate (5s)  → LLM 生成工具代码 → SandboxRunner 验证 → 注册
 *
 * 瀑布逻辑：reuse → compose → generate，首个成功即返回。
 */
import Logger from '#infra/logging/Logger.js';
import { DynamicComposer } from './DynamicComposer.js';
import { SandboxRunner } from './SandboxRunner.js';
import { TemporaryToolRegistry } from './TemporaryToolRegistry.js';
import { ToolRequirementAnalyzer } from './ToolRequirementAnalyzer.js';
/* ────────────────────── Class ────────────────────── */
export class ToolForge {
    #registry;
    #analyzer;
    #composer;
    #sandbox;
    #tempRegistry;
    #signalBus;
    #capabilityCatalog;
    #workflowRegistry;
    #logger = Logger.getInstance();
    #defaultTtlMs;
    #compositionSpecBuilder;
    constructor(registry, options = {}) {
        this.#registry = registry;
        this.#signalBus = options.signalBus ?? null;
        this.#capabilityCatalog = options.capabilityCatalog ?? null;
        this.#workflowRegistry = options.workflowRegistry ?? null;
        this.#defaultTtlMs = options.defaultTtlMs ?? 30 * 60 * 1000;
        this.#compositionSpecBuilder = options.compositionSpecBuilder;
        this.#analyzer = new ToolRequirementAnalyzer(createRequirementDirectory(registry, this.#capabilityCatalog));
        this.#composer = new DynamicComposer(registry);
        this.#sandbox = new SandboxRunner();
        this.#tempRegistry = new TemporaryToolRegistry(registry, {
            signalBus: this.#signalBus ?? undefined,
            onRevokeTemporary: (tool) => {
                if (tool.forgeMode === 'compose') {
                    this.#workflowRegistry?.unregister(tool.name);
                }
                this.#capabilityCatalog?.unregister(tool.name);
            },
        });
    }
    /* ────────── Public API ────────── */
    /**
     * 锻造工具 — 瀑布流：reuse → compose → generate
     */
    async forge(request) {
        const requirement = {
            intent: request.intent,
            action: request.action,
            target: request.target,
            constraints: request.constraints,
        };
        // Step 1: 需求分析
        const analysis = this.#analyzer.analyze(requirement);
        this.#logger.info(`ToolForge: analysis for "${request.intent}" → mode=${analysis.mode}, confidence=${analysis.confidence}`);
        // Step 2: 按推荐模式尝试，失败则降级
        const result = (await this.#tryReuse(analysis, requirement)) ??
            (await this.#tryCompose(analysis, requirement)) ??
            (await this.#tryGenerate(analysis, requirement, request.codeGenerator));
        if (result) {
            this.#emitSignal('forge_complete', {
                mode: result.mode,
                tool: result.toolName,
                analysis,
            });
            return result;
        }
        // 全部失败
        return {
            success: false,
            mode: 'generate',
            analysis,
            error: 'All forge modes exhausted. Cannot satisfy tool requirement.',
        };
    }
    /**
     * 获取临时工具注册表（暴露给 Pipeline 集成用）
     */
    get temporaryRegistry() {
        return this.#tempRegistry;
    }
    /**
     * 获取分析器
     */
    get analyzer() {
        return this.#analyzer;
    }
    /**
     * 销毁 Forge（清理临时工具和定时器）
     */
    dispose() {
        this.#tempRegistry.dispose();
    }
    /* ────────── Forge Modes ────────── */
    async #tryReuse(analysis, _requirement) {
        if (analysis.mode !== 'reuse' || !analysis.matchedTool) {
            // 即便分析推荐 compose/generate，也尝试检查直接匹配
            if (analysis.matchedTool && this.#registry.has(analysis.matchedTool)) {
                return {
                    success: true,
                    mode: 'reuse',
                    toolName: analysis.matchedTool,
                    analysis,
                };
            }
            return null;
        }
        if (!this.#registry.has(analysis.matchedTool)) {
            return null;
        }
        this.#logger.debug(`ToolForge: reuse existing tool "${analysis.matchedTool}"`);
        return {
            success: true,
            mode: 'reuse',
            toolName: analysis.matchedTool,
            analysis,
        };
    }
    async #tryCompose(analysis, requirement) {
        if (!analysis.composableTools || analysis.composableTools.length < 2) {
            return null;
        }
        // 如果有外部 spec builder，使用它
        const spec = this.#compositionSpecBuilder?.(analysis, requirement);
        if (!spec) {
            // 默认构建 sequential 组合
            const defaultSpec = this.#buildDefaultCompositionSpec(analysis, requirement);
            if (!defaultSpec) {
                return null;
            }
            return this.#executeComposition(defaultSpec, analysis);
        }
        return this.#executeComposition(spec, analysis);
    }
    #buildDefaultCompositionSpec(analysis, requirement) {
        const tools = analysis.composableTools;
        if (!tools || tools.length < 2) {
            return null;
        }
        const composedName = `composed_${requirement.action}_${requirement.target}`;
        return {
            name: composedName,
            description: `Auto-composed tool for: ${requirement.intent}`,
            steps: tools.map((tool) => ({
                tool,
                args: (prevResult) => {
                    if (typeof prevResult === 'object' && prevResult !== null) {
                        return prevResult;
                    }
                    return {};
                },
            })),
            mergeStrategy: 'sequential',
        };
    }
    async #executeComposition(spec, analysis) {
        const result = this.#composer.compose(spec);
        if (!result.success || !result.handler) {
            this.#logger.debug(`ToolForge: composition failed — ${result.error}`);
            return null;
        }
        const temporaryTool = {
            name: spec.name,
            description: spec.description,
            parameters: spec.parameters ?? {},
            handler: result.handler,
            forgeMode: 'compose',
        };
        this.#tempRegistry.registerTemporary(temporaryTool, this.#defaultTtlMs, {
            projectIntoInternalToolStore: false,
        });
        try {
            this.#registerWorkflowCapability(spec, result.handler);
        }
        catch (err) {
            this.#tempRegistry.revoke(spec.name);
            throw err;
        }
        this.#logger.info(`ToolForge: composed tool "${spec.name}" from ${spec.steps.length} steps`);
        return {
            success: true,
            mode: 'compose',
            toolName: spec.name,
            analysis,
        };
    }
    #registerWorkflowCapability(spec, handler) {
        if (!this.#workflowRegistry || !this.#capabilityCatalog) {
            return;
        }
        this.#workflowRegistry.register({
            id: spec.name,
            description: spec.description,
            parameters: spec.parameters ?? {},
            handler,
        });
        this.#capabilityCatalog.register(buildWorkflowManifest(spec));
    }
    #registerGeneratedCapability(tool) {
        if (!this.#capabilityCatalog) {
            throw new Error(`Generated tool "${tool.name}" cannot be registered without CapabilityCatalog.`);
        }
        this.#capabilityCatalog.register(buildGeneratedToolManifest(tool));
    }
    async #tryGenerate(analysis, requirement, codeGenerator) {
        if (!codeGenerator) {
            this.#logger.debug('ToolForge: generate mode skipped (no codeGenerator provided)');
            return null;
        }
        if (!this.#capabilityCatalog) {
            return {
                success: false,
                mode: 'generate',
                analysis,
                error: 'Generate mode requires CapabilityCatalog so forged tools can be routed by manifest.',
            };
        }
        // 调用 LLM 生成工具
        const generated = await codeGenerator(requirement);
        if (!generated) {
            return null;
        }
        // 安全检查
        const safety = this.#sandbox.checkSafety(generated.code);
        if (!safety.passed) {
            this.#logger.warn(`ToolForge: generated code failed safety check — ${safety.violations.join(', ')}`);
            return {
                success: false,
                mode: 'generate',
                analysis,
                error: `Safety violations: ${safety.violations.join(', ')}`,
            };
        }
        // 沙箱测试
        if (generated.testCases.length > 0) {
            const testResult = await this.#sandbox.run(generated.code, generated.testCases);
            if (!testResult.success) {
                const failures = testResult.testResults
                    .filter((t) => !t.passed)
                    .map((t) => t.description)
                    .join(', ');
                this.#logger.warn(`ToolForge: generated code failed tests — ${failures}`);
                return {
                    success: false,
                    mode: 'generate',
                    analysis,
                    error: `Test failures: ${failures}`,
                };
            }
        }
        // 构建 handler 包装
        const handler = this.#sandbox.createHandler(generated.code);
        try {
            this.#registerGeneratedCapability(generated);
            // 注册为临时工具
            this.#tempRegistry.registerTemporary({
                name: generated.name,
                description: generated.description,
                parameters: generated.parameters,
                handler,
                forgeMode: 'generate',
            }, this.#defaultTtlMs);
        }
        catch (err) {
            this.#capabilityCatalog?.unregister(generated.name);
            this.#tempRegistry.revoke(generated.name);
            throw err;
        }
        this.#logger.info(`ToolForge: generated and registered tool "${generated.name}"`);
        return {
            success: true,
            mode: 'generate',
            toolName: generated.name,
            analysis,
        };
    }
    /* ────────── Signal ────────── */
    #emitSignal(action, data) {
        if (this.#signalBus) {
            this.#signalBus.send('forge', 'ToolForge', 1, {
                metadata: { action, ...data },
            });
        }
    }
}
function buildGeneratedToolManifest(tool) {
    return {
        id: tool.name,
        title: tool.name,
        kind: 'internal-tool',
        description: tool.description,
        owner: 'agent-forge',
        lifecycle: 'experimental',
        surfaces: ['runtime'],
        inputSchema: tool.parameters,
        risk: {
            sideEffect: true,
            dataAccess: 'project',
            writeScope: 'project',
            network: 'none',
            credentialAccess: 'none',
            requiresHumanConfirmation: 'on-risk',
            owaspTags: ['excessive-agency'],
        },
        execution: {
            adapter: 'internal',
            timeoutMs: 30_000,
            maxOutputBytes: 16_000,
            abortMode: 'preStart',
            cachePolicy: 'none',
            concurrency: 'single',
            artifactMode: 'inline',
        },
        governance: {
            auditLevel: 'full',
            policyProfile: 'write',
            approvalPolicy: 'explain-then-run',
            allowedRoles: ['owner', 'admin', 'developer', 'external_agent'],
            allowInComposer: false,
            allowInRemoteMcp: false,
            allowInNonInteractive: false,
        },
        evals: { required: true, cases: [] },
    };
}
function buildWorkflowManifest(spec) {
    return {
        id: spec.name,
        title: spec.name,
        kind: 'workflow',
        description: spec.description,
        owner: 'agent-forge',
        lifecycle: 'experimental',
        surfaces: ['runtime', 'internal'],
        inputSchema: spec.parameters ?? {},
        risk: {
            sideEffect: true,
            dataAccess: 'workspace',
            writeScope: 'workspace',
            network: 'allowlisted',
            credentialAccess: 'masked',
            requiresHumanConfirmation: 'on-risk',
            owaspTags: ['excessive-agency'],
        },
        execution: {
            adapter: 'workflow',
            timeoutMs: 120_000,
            maxOutputBytes: 64_000,
            abortMode: 'cooperative',
            cachePolicy: 'none',
            concurrency: 'single',
            artifactMode: 'inline',
        },
        governance: {
            auditLevel: 'full',
            policyProfile: 'write',
            approvalPolicy: 'explain-then-run',
            allowedRoles: ['admin', 'developer'],
            allowInComposer: false,
            allowInRemoteMcp: false,
            allowInNonInteractive: false,
        },
        evals: {
            required: false,
            cases: [],
        },
    };
}
function createRequirementDirectory(registry, catalog) {
    if (catalog) {
        return {
            has(name) {
                return catalog.has(name);
            },
            list() {
                return catalog.list().map((manifest) => manifest.id);
            },
        };
    }
    return {
        has(name) {
            return registry.has(name);
        },
        list() {
            return [];
        },
    };
}

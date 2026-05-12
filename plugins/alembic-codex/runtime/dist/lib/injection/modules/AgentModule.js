/**
 * AgentModule — Agent 架构服务注册
 *
 * 负责注册:
 *   - agentService, toolRegistry, toolForge, skillHooks
 *   - feedbackStore, recommendationPipeline, recommendationMetrics
 */
import { AgentProfileCompiler, AgentProfileRegistry, AgentRunCoordinator, AgentRuntimeBuilder, AgentService, AgentStageFactoryRegistry, SystemRunContextFactory, } from '#agent/service/index.js';
import { resolveDataRoot, resolveProjectRoot } from '#shared/resolveProjectRoot.js';
import { DashboardOperationAdapter } from '#tools/adapters/DashboardOperationAdapter.js';
import { DASHBOARD_OPERATION_HANDLERS, DASHBOARD_OPERATION_MANIFESTS, } from '#tools/adapters/DashboardOperations.js';
import { MacSystemAdapter } from '#tools/adapters/MacSystemAdapter.js';
import { MAC_SYSTEM_CAPABILITY_MANIFESTS } from '#tools/adapters/MacSystemCapabilities.js';
import { SkillAdapter } from '#tools/adapters/SkillAdapter.js';
import { SKILL_CAPABILITY_MANIFESTS } from '#tools/adapters/SkillCapabilities.js';
import { TerminalAdapter } from '#tools/adapters/TerminalAdapter.js';
import { InMemoryTerminalSessionManager } from '#tools/adapters/TerminalSessionManager.js';
import { TERMINAL_CAPABILITY_MANIFESTS } from '#tools/adapters/terminal-capabilities/index.js';
import { WorkflowAdapter } from '#tools/adapters/WorkflowAdapter.js';
import { UnifiedToolCatalog } from '#tools/catalog/UnifiedToolCatalog.js';
import { LightweightRouter } from '#tools/core/LightweightRouter.js';
import { ToolContextFactory } from '#tools/v2/adapter/ToolContextFactory.js';
import { V2CapabilityCatalog } from '#tools/v2/adapter/V2CapabilityCatalog.js';
import { V2ToolRouterAdapter } from '#tools/v2/adapter/V2ToolRouterAdapter.js';
import { WorkflowRegistry } from '#tools/workflow/WorkflowRegistry.js';
import { ToolForge } from '../../agent/forge/ToolForge.js';
import { buildMcpToolCapabilities, } from '../../external/mcp/McpCapabilityProjection.js';
import { McpToolAdapter } from '../../external/mcp/McpToolAdapter.js';
import { McpToolDiscovery } from '../../external/mcp/McpToolDiscovery.js';
import { AIRecallStrategy } from '../../service/skills/AIRecallStrategy.js';
import { FeedbackStore } from '../../service/skills/FeedbackStore.js';
import { RecommendationMetrics } from '../../service/skills/RecommendationMetrics.js';
import { RecommendationPipeline } from '../../service/skills/RecommendationPipeline.js';
import { RuleRecallStrategy } from '../../service/skills/RuleRecallStrategy.js';
import { SkillHooks } from '../../service/skills/SkillHooks.js';
export function register(c) {
    // ── V2 Tool System ─────────────────────────────────────────────────
    // capabilityCatalog: V2CapabilityCatalog 直接从 TOOL_REGISTRY 生成 schema
    c.singleton('capabilityCatalog', () => new V2CapabilityCatalog());
    // V2 ToolContextFactory: 长生命周期，持有 DeltaCache/SearchCache/Compressor
    c.singleton('v2ToolContextFactory', (ct) => new ToolContextFactory({
        container: ct,
        projectRoot: resolveProjectRoot(ct),
    }));
    // toolRouter: V2ToolRouterAdapter 实现 ToolRouterContract
    c.singleton('toolRouter', (ct) => new V2ToolRouterAdapter({
        contextFactory: ct.get('v2ToolContextFactory'),
    }));
    // toolRegistry: 非 Agent 表面 (Dashboard/Terminal/Skill/Mac/MCP) 的工具注册
    c.singleton('toolRegistry', (ct) => {
        const catalog = new UnifiedToolCatalog();
        for (const m of [
            ...DASHBOARD_OPERATION_MANIFESTS,
            ...TERMINAL_CAPABILITY_MANIFESTS,
            ...SKILL_CAPABILITY_MANIFESTS,
            ...MAC_SYSTEM_CAPABILITY_MANIFESTS,
        ]) {
            catalog.register(m);
        }
        // MCP tools
        const mcpDeclarations = ct.get('mcpToolDeclarations');
        if (mcpDeclarations.length > 0) {
            const { manifests: mcpManifests } = buildMcpToolCapabilities(mcpDeclarations);
            for (const m of mcpManifests) {
                if (!catalog.has(m.id)) {
                    catalog.register(m);
                }
            }
        }
        const mcpExecutor = ct.singletons.mcpToolExecutor ??
            (async (_name, _args) => {
                throw new Error('MCP tool executor not configured');
            });
        catalog.setRouter(new LightweightRouter({
            catalog,
            adapters: [
                new DashboardOperationAdapter(DASHBOARD_OPERATION_HANDLERS),
                new TerminalAdapter({
                    sessionManager: ct.get('terminalSessionManager'),
                }),
                new SkillAdapter(),
                new MacSystemAdapter(),
                new WorkflowAdapter(ct.get('workflowRegistry')),
                new McpToolAdapter(mcpExecutor),
            ],
            projectRoot: resolveProjectRoot(ct),
            dataRoot: resolveDataRoot(ct),
            services: ct,
        }));
        return catalog;
    });
    c.singleton('workflowRegistry', () => new WorkflowRegistry());
    c.singleton('terminalSessionManager', () => new InMemoryTerminalSessionManager());
    c.singleton('mcpToolDeclarations', (ct) => {
        try {
            const discovery = new McpToolDiscovery();
            return discovery.discover(resolveProjectRoot(ct));
        }
        catch {
            return [];
        }
    });
    c.singleton('toolForge', (ct) => {
        const catalog = ct.get('toolRegistry');
        const signalBus = ct.singletons.signalBus;
        return new ToolForge(catalog, {
            signalBus,
            capabilityCatalog: ct.get('capabilityCatalog'),
            workflowRegistry: ct.get('workflowRegistry'),
        });
    });
    c.singleton('agentProfileRegistry', () => new AgentProfileRegistry(), { aiDependent: false });
    c.singleton('agentStageFactoryRegistry', () => new AgentStageFactoryRegistry(), {
        aiDependent: false,
    });
    c.singleton('agentProfileCompiler', (ct) => new AgentProfileCompiler({
        profileRegistry: ct.get('agentProfileRegistry'),
        stageFactoryRegistry: ct.get('agentStageFactoryRegistry'),
    }), { aiDependent: false });
    c.singleton('agentRunCoordinator', () => new AgentRunCoordinator(), { aiDependent: false });
    c.singleton('systemRunContextFactory', (ct) => new SystemRunContextFactory({
        aiProvider: (ct.singletons.aiProvider || null),
    }), { aiDependent: true });
    c.singleton('agentRuntimeBuilder', (ct) => new AgentRuntimeBuilder({
        container: ct,
        toolRegistry: ct.get('toolRegistry'),
        toolRouter: ct.get('toolRouter'),
        aiProvider: ct.singletons.aiProvider || null,
        projectRoot: resolveProjectRoot(ct),
        dataRoot: resolveDataRoot(ct),
    }), { aiDependent: true });
    c.singleton('agentService', (ct) => new AgentService({
        runtimeBuilder: ct.get('agentRuntimeBuilder'),
        profileCompiler: ct.get('agentProfileCompiler'),
        runCoordinator: ct.get('agentRunCoordinator'),
    }), { aiDependent: true });
    c.singleton('skillHooks', () => {
        const hooks = new SkillHooks();
        hooks.load().catch(() => {
            /* skill hooks load is best-effort */
        });
        return hooks;
    });
    // ── Recommendation 子系统 ──
    c.singleton('feedbackStore', (ct) => {
        const dataRoot = resolveDataRoot(ct);
        const wz = ct.singletons.writeZone;
        return new FeedbackStore(dataRoot, wz);
    });
    c.singleton('recommendationPipeline', (ct) => {
        const feedbackStore = ct.get('feedbackStore');
        const skillHooks = ct.get('skillHooks');
        const pipeline = new RecommendationPipeline({ feedbackStore, skillHooks });
        // 注册召回策略
        pipeline.addStrategy(new RuleRecallStrategy());
        // AI 策略 — SignalCollector 可能尚未初始化，使用延迟绑定
        const aiStrategy = new AIRecallStrategy(null);
        pipeline.addStrategy(aiStrategy);
        // 在 singletons 上保存 aiStrategy 引用，供后续绑定 SignalCollector
        ct.singletons._aiRecallStrategy = aiStrategy;
        return pipeline;
    });
    c.singleton('recommendationMetrics', (ct) => {
        const feedbackStore = ct.get('feedbackStore');
        return new RecommendationMetrics(feedbackStore);
    });
}

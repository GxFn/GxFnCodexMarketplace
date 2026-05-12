/**
 * AI API 路由
 * AI 提供商管理、摘要、翻译、对话、工作区 LLM 配置
 */
import express from 'express';
import { runScanAgentTask, runTranslationJson, } from '#agent/service/index.js';
import { ConversationStore } from '../../agent/context/ConversationStore.js';
import { PRESETS } from '../../agent/profiles/presets.js';
import { taskCheckAndSubmit, taskDiscoverAllRelations, taskFullEnrich, taskGuardFullScan, taskQualityAudit, } from '../../agent/tasks/AgentTaskHandlers.js';
import { createProvider } from '../../external/ai/AiFactory.js';
import { getModelRegistry } from '../../external/ai/registry/ModelRegistry.js';
import { PROVIDER_CONFIGS } from '../../external/ai/registry/ProviderConfig.js';
import Logger from '../../infrastructure/logging/Logger.js';
import { getRealtimeService } from '../../infrastructure/realtime/RealtimeService.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { ValidationError } from '../../shared/errors/index.js';
import { resolveDataRoot, resolveProjectRoot } from '../../shared/resolveProjectRoot.js';
import { AiChatBody, AiConfigBody, AiFormatUsageGuideBody, AiLangBody, AiStreamBody, AiSummarizeBody, AiTaskBody, AiToolBody, AiTranslateBody, AiWorkspaceConfigBody, } from '../../shared/schemas/http-requests.js';
import { collectAiRuntimeOverrideDiff, isAiRuntimeConfigReady, maskAiRuntimeConfig, PROVIDER_KEY_ENV, WorkspaceSettingsStore, } from '../../shared/WorkspaceSettingsStore.js';
import { validate } from '../middleware/validate.js';
import { createStreamSession, getStreamSession } from '../utils/sse-sessions.js';
import { sendToolEnvelopeResponse } from '../utils/tool-envelope-response.js';
export { httpStatusForToolEnvelope, sendToolEnvelopeResponse, } from '../utils/tool-envelope-response.js';
const router = express.Router();
const logger = Logger.getInstance();
const AI_CONFIG_GATEWAY_ACTION = 'update:config';
const AI_CONFIG_GATEWAY_RESOURCE = 'ai_config';
export function createHttpChatAgentRunInput(req, options) {
    const source = options.source || 'http-chat';
    return {
        profile: { preset: 'chat' },
        message: {
            content: options.prompt,
            history: options.history || [],
            sessionId: options.conversationId || undefined,
            metadata: {
                lang: options.lang,
                stream: options.stream || false,
            },
        },
        context: {
            source,
            lang: options.lang,
            actor: {
                role: req.resolvedRole || 'user',
                user: req.resolvedUser || req.ip || 'http-user',
                sessionId: options.conversationId || undefined,
            },
        },
        presentation: { stream: options.stream || false },
        execution: {
            onProgress: options.onProgress || null,
        },
    };
}
/** 获取 DI 容器 */
function getContainer() {
    return getServiceContainer();
}
/** 检查 AI Provider 是否可用（非 mock），不可用则抛 ValidationError */
function requireAiReady() {
    const container = getContainer();
    const manager = container.singletons?._aiProviderManager;
    if (manager?.isMock) {
        throw new ValidationError('AI Provider 未配置，当前为 Mock 模式。请先在 Alembic Dashboard 的 AI Settings 中配置 API Key。');
    }
    return container;
}
function hasDeveloperRole(req) {
    return ['admin', 'developer', 'owner'].includes(req.resolvedRole || '');
}
function requireDeveloperRole(req, res) {
    if (hasDeveloperRole(req)) {
        return true;
    }
    res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: '需要 developer 权限才能修改 AI 配置' },
    });
    return false;
}
export async function ensureAiConfigUpdateAllowed(req, res, gateway, updates = {}) {
    if (!gateway?.checkOnly) {
        res.status(503).json({
            success: false,
            error: {
                code: 'GATEWAY_UNAVAILABLE',
                message: 'AI 配置写入需要 Gateway 权限检查，但 Gateway 不可用',
            },
        });
        return false;
    }
    const result = await gateway.checkOnly({
        actor: req.resolvedRole || 'anonymous',
        action: AI_CONFIG_GATEWAY_ACTION,
        resource: AI_CONFIG_GATEWAY_RESOURCE,
        data: {
            keys: Object.keys(updates),
            _ip: req.ip,
            _userAgent: req.headers['user-agent'] || '',
            _resolvedUser: req.resolvedUser || undefined,
        },
        session: req.headers['x-session-id'],
    });
    if (result.success) {
        return true;
    }
    res.status(result.error?.statusCode || 403).json({
        success: false,
        error: {
            code: result.error?.code || 'GATEWAY_DENIED',
            message: result.error?.message || 'AI 配置写入未通过 Gateway 权限检查',
            requestId: result.requestId,
        },
    });
    return false;
}
export async function ensureDirectToolAllowed(capabilityCatalog, tool, _req, res, _gateway) {
    const manifest = capabilityCatalog.getManifest?.(tool) || null;
    if (!manifest) {
        return true;
    }
    if (manifest.surfaces.includes('http')) {
        return true;
    }
    const reason = manifest.risk.sideEffect ? '具有副作用' : '未声明 http 暴露面';
    res.status(403).json({
        success: false,
        error: {
            code: 'TOOL_NOT_DIRECTLY_CALLABLE',
            message: `工具 "${tool}" ${reason}，不能通过 HTTP 直通入口调用`,
        },
    });
    return false;
}
// ═══════════════════════════════════════════════════════
//  UI 语言偏好 — 前端 ↔ 服务端同步
// ═══════════════════════════════════════════════════════
/**
 * GET /api/v1/ai/lang
 * 获取当前默认 UI 语言（由系统环境变量初始化，前端可覆盖）
 */
router.get('/lang', async (req, res) => {
    const container = getContainer();
    res.json({ success: true, data: { lang: container.getLang() || 'zh' } });
});
/**
 * POST /api/v1/ai/lang
 * 更新默认 UI 语言（前端切语言时同步到服务端）
 */
router.post('/lang', validate(AiLangBody), async (req, res) => {
    const { lang } = req.body;
    const container = getContainer();
    container.setLang(lang);
    logger.info(`UI language preference updated to "${lang}"`);
    res.json({ success: true, data: { lang } });
});
/**
 * GET /api/v1/ai/providers
 * 获取可用的 AI 提供商列表（增强版 — 含模型能力、约束、连接状态）
 */
router.get('/providers', async (req, res) => {
    const registry = getModelRegistry();
    const container = getServiceContainer();
    const manager = container.singletons?._aiProviderManager;
    const activeProvider = manager?.name || process.env.ALEMBIC_AI_PROVIDER || '';
    const activeModel = manager?.model || process.env.ALEMBIC_AI_MODEL || '';
    const providers = [
        ...PROVIDER_CONFIGS.map((cfg) => {
            const hasKey = cfg.keyEnvVar ? !!process.env[cfg.keyEnvVar] : true;
            const models = registry.listByProvider(cfg.id).map((m) => ({
                id: m.apiModelId,
                name: m.displayName,
                contextWindow: m.contextWindow,
                maxOutputTokens: m.maxOutputTokens,
                deprecated: !!m.deprecated,
                capabilities: m.capabilities,
                reasoning: {
                    supported: m.reasoning.supported,
                    mode: m.reasoning.mode,
                    defaultEffort: m.reasoning.defaultEffort,
                    effortLevels: m.reasoning.effortLevels,
                },
            }));
            return {
                id: cfg.id,
                label: cfg.displayName,
                defaultModel: registry.get(cfg.defaultModelId)?.apiModelId ?? cfg.defaultModelId.split(':')[1],
                models,
                hasKey,
                isActive: cfg.id === activeProvider,
                keyEnvVar: cfg.keyEnvVar,
                baseUrl: cfg.baseUrl,
            };
        }),
        {
            id: 'mock',
            label: 'Mock (测试)',
            defaultModel: 'mock-l3',
            models: [],
            hasKey: true,
            isActive: activeProvider === 'mock',
            keyEnvVar: '',
            baseUrl: '',
        },
    ];
    res.json({
        success: true,
        data: {
            providers,
            active: { provider: activeProvider, model: activeModel },
        },
    });
});
/**
 * POST /api/v1/ai/probe
 * 探测指定 Provider 的连通性（发送简单 ping 请求）
 * Body: { provider: string, apiKey?: string }
 */
router.post('/probe', async (req, res) => {
    const { provider: providerName, apiKey } = req.body;
    if (!providerName) {
        return void res
            .status(400)
            .json({ success: false, error: { message: 'provider is required' } });
    }
    try {
        const opts = { provider: providerName.toLowerCase() };
        if (apiKey) {
            opts.apiKey = apiKey;
        }
        const provider = createProvider(opts);
        const start = Date.now();
        await provider.probe();
        const latencyMs = Date.now() - start;
        res.json({
            success: true,
            data: {
                provider: providerName,
                status: 'connected',
                latencyMs,
                model: provider.model,
            },
        });
    }
    catch (err) {
        const errMsg = err.message || 'Unknown error';
        const statusCode = err.status;
        res.json({
            success: true,
            data: {
                provider: providerName,
                status: 'error',
                error: errMsg,
                statusCode,
            },
        });
    }
});
/**
 * GET /api/v1/ai/config
 * 获取当前 AI 配置（优先从 AiProviderManager 读取）
 */
router.get('/config', async (req, res) => {
    const container = getServiceContainer();
    const manager = container.singletons?._aiProviderManager;
    res.json({
        success: true,
        data: { provider: manager.name, model: manager.model, isMock: manager.isMock },
    });
});
/**
 * POST /api/v1/ai/config
 * 更新 AI 配置（切换提供商/模型）— 通过 AiProviderManager 统一热切换
 */
router.post('/config', validate(AiConfigBody), async (req, res) => {
    const { provider, model } = req.body;
    // 创建新的 provider 实例验证配置有效
    let newProvider;
    try {
        newProvider = createProvider({
            provider: provider.toLowerCase(),
            model: model || undefined,
        });
    }
    catch (error) {
        throw new ValidationError(`Invalid provider: ${error.message}`);
    }
    // 通过 reloadAiProvider → AiProviderManager.switchProvider() 统一热切换
    const container = getServiceContainer();
    container.reloadAiProvider(newProvider);
    logger.info('AI provider switched via AiProviderManager', {
        provider: provider.toLowerCase(),
        model: newProvider.model,
    });
    res.json({
        success: true,
        data: {
            provider: provider.toLowerCase(),
            model: newProvider.model,
            name: newProvider.name,
        },
    });
});
/**
 * POST /api/v1/ai/mock/cleanup
 * 清理 Mock 模式产生的候选数据
 */
router.post('/mock/cleanup', async (_req, res) => {
    const container = getContainer();
    const knowledgeService = container.get('knowledgeService');
    const knowledgeRepo = container.get('knowledgeRepository');
    // 查找所有 mock 来源的候选
    const mockSources = ['mock-bootstrap', 'mock-pipeline'];
    let totalDeleted = 0;
    for (const source of mockSources) {
        const ids = await knowledgeRepo.findIdsBySource(source);
        for (const id of ids) {
            try {
                await knowledgeService.delete(id, { userId: 'system:mock-cleanup' });
                totalDeleted++;
            }
            catch {
                logger.debug(`Mock cleanup: failed to delete ${id}`);
            }
        }
    }
    // 清理 bootstrap 来源的 semantic_memories
    try {
        const memoryRepo = container.get('memoryRepository');
        if (memoryRepo) {
            await memoryRepo.clearBootstrapMemories();
        }
    }
    catch {
        // memoryRepository 可能未注册
    }
    logger.info(`Mock cleanup completed: ${totalDeleted} entries deleted`);
    const rt = getRealtimeService();
    if (rt) {
        rt.broadcastEvent('mock-cleanup-completed', { deleted: totalDeleted });
    }
    res.json({
        success: true,
        data: { deleted: totalDeleted },
    });
});
/**
 * POST /api/v1/ai/summarize
 * AI 摘要生成
 */
router.post('/summarize', validate(AiSummarizeBody), async (req, res) => {
    const { code, language } = req.body;
    const container = requireAiReady();
    const agentService = container.get('agentService');
    const systemRunContextFactory = container.get('systemRunContextFactory');
    const result = await runScanAgentTask({
        agentService,
        systemRunContextFactory,
        label: 'code',
        task: 'summarize',
        lang: language,
        files: [{ name: 'code', content: code, language }],
        onParseError: () => logger.warn('AI summarize failed to parse fallback JSON'),
    });
    if (result?.error) {
        throw new ValidationError(result.error);
    }
    res.json({ success: true, data: result });
});
/**
 * POST /api/v1/ai/translate
 * AI 翻译（中文 → 英文）
 */
router.post('/translate', validate(AiTranslateBody), async (req, res) => {
    const { summary, usageGuide } = req.body;
    if (!summary && !usageGuide) {
        return void res.json({
            success: true,
            data: { summaryEn: '', usageGuideEn: '' },
        });
    }
    try {
        const container = requireAiReady();
        const agentService = container.get('agentService');
        const result = await runTranslationJson({
            agentService,
            summary,
            usageGuide,
            onParseError: () => logger.warn('AI translate failed to parse JSON, returning fallback'),
        });
        if (result?.error) {
            // AI 不可用，降级返回原文
            logger.warn('AI translate tool returned error', { error: result.error });
            return void res.json({
                success: true,
                data: { summaryEn: summary || '', usageGuideEn: usageGuide || '' },
                warning: result.error,
            });
        }
        res.json({ success: true, data: result });
    }
    catch (err) {
        logger.warn('AI translate failed, returning original text', {
            error: err.message,
        });
        res.json({
            success: true,
            data: { summaryEn: summary || '', usageGuideEn: usageGuide || '' },
            warning: `Translation failed: ${err.message}`,
        });
    }
});
/**
 * POST /api/v1/ai/chat
 * AI 对话（RAG 模式，结合项目知识库）
 *
 * 增强特性 (Engine Migration):
 *   - 对话持久化 (ConversationStore)
 *   - ContextWindow 上下文窗口管理
 *   - Token 用量持久化
 *   - SSE 流式最终回答 (text:start/delta/end)
 *   - MemoryCoordinator 记忆提取
 */
router.post('/chat', validate(AiChatBody), async (req, res) => {
    const { prompt, history, lang, conversationId } = req.body;
    const container = requireAiReady();
    const agentService = container.get('agentService');
    // ── 对话持久化: 从 ConversationStore 加载历史 ──
    let convStore = null;
    let effectiveHistory = history;
    let effectiveConvId = conversationId || null;
    try {
        const dataRoot = resolveDataRoot(container);
        convStore = new ConversationStore(dataRoot);
        if (effectiveConvId) {
            effectiveHistory = convStore.load(effectiveConvId);
            convStore.append(effectiveConvId, { role: 'user', content: prompt });
        }
        else {
            effectiveConvId = convStore.create({ category: 'user', title: prompt.slice(0, 50) });
            convStore.append(effectiveConvId, { role: 'user', content: prompt });
        }
    }
    catch {
        /* ConversationStore 不可用时静默降级 */
    }
    const result = await agentService.run(createHttpChatAgentRunInput(req, {
        prompt,
        history: effectiveHistory,
        lang,
        conversationId: effectiveConvId,
        onProgress: (event) => {
            // SSE 流式进度 (如果前端通过 SSE 建立了连接)
            try {
                const sessionId = req.body.sseSessionId;
                if (sessionId) {
                    const session = getStreamSession(sessionId);
                    if (session) {
                        session.send(event);
                    }
                }
            }
            catch {
                /* SSE 不可用时静默 */
            }
        },
    }));
    // ── 持久化 assistant 回复 ──
    if (convStore && effectiveConvId && result.reply) {
        try {
            convStore.append(effectiveConvId, { role: 'assistant', content: result.reply });
        }
        catch {
            /* 静默降级 */
        }
    }
    // ── Token 用量持久化 ──
    try {
        const tokenStore = container.get('tokenUsageStore');
        if (tokenStore && result.usage) {
            const aiProvider = container.singletons?.aiProvider;
            tokenStore.record({
                source: 'user',
                dimension: undefined,
                provider: aiProvider?.name ?? undefined,
                model: aiProvider?.model ?? undefined,
                inputTokens: result.usage.inputTokens || 0,
                outputTokens: result.usage.outputTokens || 0,
                durationMs: result.usage.durationMs || 0,
                toolCalls: result.toolCalls.length,
                sessionId: effectiveConvId,
            });
            // 通知前端 token 用量变化
            try {
                const realtime = getRealtimeService();
                realtime?.broadcastTokenUsageUpdated?.();
            }
            catch {
                /* optional */
            }
        }
    }
    catch {
        /* token logging should never break execution */
    }
    res.json({
        success: true,
        data: {
            reply: result.reply,
            toolCalls: result.toolCalls,
            iterations: result.usage.iterations || null,
            conversationId: effectiveConvId,
            tokenUsage: {
                input: result.usage.inputTokens,
                output: result.usage.outputTokens,
            },
        },
    });
});
/**
 * POST /api/v1/ai/agent/tool
 * 程序化直接调用 Agent 工具（跳过 ReAct 循环）
 * Body: { tool: string, params: object }
 */
router.post('/agent/tool', validate(AiToolBody), async (req, res) => {
    const { tool, params } = req.body;
    const container = requireAiReady();
    const capabilityCatalog = container.get('capabilityCatalog');
    if (!(await ensureDirectToolAllowed(capabilityCatalog, tool, req, res))) {
        return;
    }
    const toolRouter = container.get('toolRouter');
    const result = await toolRouter.execute({
        toolId: tool,
        args: params,
        surface: 'http',
        actor: {
            role: req.resolvedRole || 'anonymous',
            user: req.resolvedUser || undefined,
            sessionId: req.headers['x-session-id'],
        },
        source: { kind: 'http', name: '/api/v1/ai/agent/tool' },
        runtime: createHttpToolRuntimeContext(container),
    });
    sendToolEnvelopeResponse(res, result);
});
/**
 * POST /api/v1/ai/agent/task
 * 执行预定义任务流（查重提交 / 批量关系发现 / 批量补全）
 * Body: { task: string, params: object }
 *
 * 支持两种任务类型:
 *   1. ToolRegistry 注册的工具 (直接通过 toolName 调用)
 *   2. AgentTaskHandlers 的 5 个预定义任务流
 */
const DAG_TASK_HANDLERS = {
    check_and_submit: taskCheckAndSubmit,
    discover_all_relations: taskDiscoverAllRelations,
    full_enrich: taskFullEnrich,
    quality_audit: taskQualityAudit,
    guard_full_scan: taskGuardFullScan,
};
router.post('/agent/task', validate(AiTaskBody), async (req, res) => {
    const { task, params } = req.body;
    const container = requireAiReady();
    const capabilityCatalog = container.get('capabilityCatalog');
    const toolRouter = container.get('toolRouter');
    // 优先尝试 DAG 任务
    const dagHandler = DAG_TASK_HANDLERS[task];
    if (dagHandler) {
        const aiProvider = container.singletons?.aiProvider;
        const taskContext = {
            invokeToolEnvelope: (name, p) => toolRouter.execute({
                toolId: name,
                args: p,
                surface: 'system',
                actor: { role: 'chat_agent', user: 'agent-task' },
                source: { kind: 'system', name: '/api/v1/ai/agent/task' },
                runtime: createHttpToolRuntimeContext(container),
            }),
            aiProvider,
            container,
            logger,
        };
        const result = await dagHandler(taskContext, params);
        return void res.json({ success: true, data: result });
    }
    // 回退到 Agent 工具执行
    if (!(await ensureDirectToolAllowed(capabilityCatalog, task, req, res))) {
        return;
    }
    const result = await toolRouter.execute({
        toolId: task,
        args: params,
        surface: 'http',
        actor: {
            role: req.resolvedRole || 'anonymous',
            user: req.resolvedUser || undefined,
            sessionId: req.headers['x-session-id'],
        },
        source: { kind: 'http', name: '/api/v1/ai/agent/task' },
        runtime: createHttpToolRuntimeContext(container),
    });
    sendToolEnvelopeResponse(res, result);
});
/**
 * GET /api/v1/ai/agent/capabilities
 * 获取 Agent 能力清单（工具列表 + 任务列表）
 */
router.get('/agent/capabilities', async (req, res) => {
    const container = getContainer();
    const capabilityCatalog = container.get('capabilityCatalog');
    const tools = capabilityCatalog.toToolSchemas();
    const presets = Object.entries(PRESETS).map(([name, p]) => ({
        name,
        description: p.description,
        capabilities: p.capabilities,
        strategy: p.strategy?.type || 'single',
    }));
    res.json({
        success: true,
        data: {
            tools,
            presets,
            tasks: [
                { name: 'check_and_submit', description: '提交候选前自动查重 + 质量预评' },
                { name: 'discover_all_relations', description: '批量发现 Recipe 之间的知识图谱关系' },
                { name: 'full_enrich', description: '批量 AI 语义补全候选字段' },
                { name: 'quality_audit', description: '批量质量审计全部 Recipe，标记低分项' },
                { name: 'guard_full_scan', description: '用全部 Guard 规则扫描指定代码，生成完整报告' },
            ],
        },
    });
});
function createHttpToolRuntimeContext(container) {
    return {
        aiProvider: container.singletons?.aiProvider || null,
        dataRoot: resolveDataRoot(container),
        logger,
    };
}
/**
 * POST /api/v1/ai/format-usage-guide
 * 格式化 usageGuide 文本（纯文本处理，不涉及 AI 调用）
 * 注：虽非 AI 功能，但前端从 /ai/ 路径调用，保留以维持 API 兼容
 */
router.post('/format-usage-guide', validate(AiFormatUsageGuideBody), async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return void res.json({ success: true, data: { formatted: '' } });
    }
    // 简单文本格式化处理
    let formatted = text.trim();
    // 确保段落间有空行
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    // 确保代码块格式
    formatted = formatted.replace(/```(\w+)?\n/g, '\n```$1\n');
    res.json({ success: true, data: { formatted } });
});
// ═══════════════════════════════════════════════════════
//  工作区 LLM 配置读写
// ═══════════════════════════════════════════════════════
function getWorkspaceSettingsStore() {
    const container = getServiceContainer();
    return WorkspaceSettingsStore.fromProject(resolveProjectRoot(container));
}
function readLlmConfig() {
    const store = getWorkspaceSettingsStore();
    const settingsConfig = store.readAiConfig();
    const processConfig = collectAiRuntimeOverrideDiff(settingsConfig.runtimeValues, process.env);
    const rawVars = {
        ...settingsConfig.runtimeValues,
        ...processConfig,
    };
    const vars = maskAiRuntimeConfig(rawVars);
    const hasSettings = settingsConfig.hasSettingsFile || settingsConfig.hasSecretsFile;
    const hasProcessConfig = Object.keys(processConfig).length > 0;
    return {
        vars,
        hasSettingsFile: settingsConfig.hasSettingsFile,
        hasSecretsFile: settingsConfig.hasSecretsFile,
        settingsPath: settingsConfig.settingsPath,
        secretsPath: settingsConfig.secretsPath,
        configSource: hasProcessConfig
            ? 'runtime-overrides'
            : hasSettings
                ? 'workspace-settings'
                : 'empty',
        llmReady: isAiRuntimeConfigReady(rawVars),
    };
}
/**
 * GET /api/v1/ai/workspace-config
 * 读取工作区 LLM 配置。
 */
router.get('/workspace-config', async (_req, res) => {
    res.json({ success: true, data: readLlmConfig() });
});
/**
 * POST /api/v1/ai/workspace-config
 * 写入 / 更新工作区 LLM 配置。
 *
 * Body: { provider, model, apiKey, proxy? }
 */
router.post('/workspace-config', validate(AiWorkspaceConfigBody), async (req, res) => {
    if (!requireDeveloperRole(req, res)) {
        return;
    }
    const { provider, model, apiKey, proxy, reasoningEffort, embedProvider, embedModel, embedBaseUrl, embedApiKey, providerKeys, } = req.body;
    const updates = {
        ALEMBIC_AI_PROVIDER: provider,
    };
    if (model) {
        updates.ALEMBIC_AI_MODEL = model;
    }
    if (proxy) {
        updates.ALEMBIC_AI_PROXY = proxy;
    }
    if (reasoningEffort) {
        updates.ALEMBIC_AI_REASONING_EFFORT = reasoningEffort;
    }
    const providerKeyMap = {
        ...PROVIDER_KEY_ENV,
    };
    // 多 provider key 同时保存
    if (providerKeys && typeof providerKeys === 'object') {
        for (const [pid, key] of Object.entries(providerKeys)) {
            const envKey = providerKeyMap[pid];
            if (envKey && key) {
                updates[envKey] = String(key);
            }
        }
    }
    // 兼容旧模式: 单个 apiKey 写入当前 provider 的 env key
    const keyName = providerKeyMap[provider];
    if (keyName && apiKey) {
        updates[keyName] = apiKey;
    }
    if (embedProvider) {
        updates.ALEMBIC_EMBED_PROVIDER = embedProvider;
        if (embedModel) {
            updates.ALEMBIC_EMBED_MODEL = embedModel;
        }
        if (embedBaseUrl) {
            updates.ALEMBIC_EMBED_BASE_URL = embedBaseUrl;
        }
        if (embedApiKey) {
            updates.ALEMBIC_EMBED_API_KEY = embedApiKey;
        }
    }
    const container = getServiceContainer();
    const gateway = container.get('gateway');
    if (!(await ensureAiConfigUpdateAllowed(req, res, gateway, updates))) {
        return;
    }
    const store = getWorkspaceSettingsStore();
    store.writeAiConfig(updates);
    logger.info('LLM workspace config updated', { provider, model });
    // 同步到当前进程环境变量（热生效）
    for (const [k, v] of Object.entries(updates)) {
        process.env[k] = String(v);
    }
    // 尝试热切换 AI Provider（通过 AiProviderManager 统一处理）
    try {
        const newProvider = createProvider({
            provider: provider.toLowerCase(),
            model: model || undefined,
        });
        const container = getServiceContainer();
        container.reloadAiProvider(newProvider);
        logger.info('AI provider hot-swapped via AiProviderManager after env update', {
            provider,
            model: newProvider.model,
        });
    }
    catch (err) {
        logger.debug('Hot-swap AI provider failed (will take effect on restart)', {
            error: err.message,
        });
    }
    res.json({ success: true, data: readLlmConfig() });
});
// ═══════════════════════════════════════════════════════
//  SSE Streaming — 流式对话（Session + EventSource 架构）
// ═══════════════════════════════════════════════════════
/**
 * POST /api/v1/ai/chat/stream
 * 启动 AI 对话流 — 创建 session，后台执行 AgentRuntime，立即返回 sessionId
 *
 * 客户端拿到 sessionId 后通过 GET /chat/events/:sessionId (EventSource) 消费事件
 *
 * 协议事件（通过 session 缓冲 + EventSource 交付）:
 *   step:start    — 新推理步骤开始 {step, maxSteps, phase}
 *   step:end      — 推理步骤结束 {step}
 *   tool:start    — 工具调用开始 {id, tool, args}
 *   tool:end      — 工具调用结束 {tool, status, resultSize?, duration?, error?}
 *   text:start    — 文本流开始 {id, role}
 *   text:delta    — 文本分块 {id, delta}
 *   text:end      — 文本流结束 {id}
 *   stream:done   — 会话完成 {text, toolCalls, hasContext}
 *   stream:error  — 会话错误 {message}
 *
 * Body: { prompt: string, history?: Array<{role,content}> }
 * Response: { success: true, sessionId: string }
 */
router.post('/chat/stream', validate(AiStreamBody), async (req, res) => {
    const { prompt, history, lang } = req.body;
    const container = requireAiReady();
    const agentService = container.get('agentService');
    const session = createStreamSession('chat');
    logger.debug('SSE session created', { sessionId: session.sessionId });
    // 立即返回 sessionId（不等待 Agent 执行）
    res.json({ success: true, sessionId: session.sessionId });
    // 后台执行 AgentService — 挂载 onProgress 回调映射到 SSE 事件
    agentService
        .run(createHttpChatAgentRunInput(req, {
        prompt,
        history,
        lang,
        conversationId: session.sessionId,
        source: 'http-stream',
        stream: true,
        onProgress: (event) => {
            // 将 AgentRuntime 内部事件映射到前端 SSE 协议
            switch (event.type) {
                case 'thinking':
                    session.send({
                        type: 'step:start',
                        step: event.iteration,
                        maxSteps: event.maxIterations,
                        phase: 'thinking',
                    });
                    break;
                case 'tool_call':
                    session.send({ type: 'tool:start', tool: event.tool, args: event.args });
                    break;
                case 'tool_end':
                    session.send({
                        type: 'tool:end',
                        tool: event.tool,
                        status: event.status,
                        resultSize: event.resultSize,
                        duration: event.duration,
                        error: event.error,
                    });
                    break;
                default:
                    session.send(event);
            }
        },
    }))
        .then((result) => {
        const replyText = result.reply || '';
        // 发送最终文本
        if (replyText) {
            const textId = `text_${Date.now()}`;
            session.send({ type: 'text:start', id: textId, role: 'assistant' });
            session.send({ type: 'text:delta', id: textId, delta: replyText });
            session.send({ type: 'text:end', id: textId });
        }
        else {
            logger.warn('SSE session: empty reply from AgentRuntime', {
                sessionId: session.sessionId,
                iterations: result.usage.iterations,
                toolCalls: result.toolCalls.length,
            });
        }
        session.end({
            text: replyText || '抱歉，AI 未能生成有效回复。请重试或换个问题。',
            toolCalls: result.toolCalls,
            iterations: result.usage.iterations || 0,
        });
        // ── Token 用量持久化（streaming） ──
        try {
            if (result.usage) {
                const tokenStore = container.get('tokenUsageStore');
                const aiProvider = container.singletons?.aiProvider;
                tokenStore.record({
                    source: 'user',
                    provider: aiProvider?.name ?? undefined,
                    model: aiProvider?.model ?? undefined,
                    inputTokens: result.usage.inputTokens || 0,
                    outputTokens: result.usage.outputTokens || 0,
                    durationMs: result.usage.durationMs || 0,
                    toolCalls: result.toolCalls.length,
                });
                try {
                    const realtime = getRealtimeService();
                    realtime?.broadcastTokenUsageUpdated?.();
                }
                catch {
                    /* ignore */
                }
            }
        }
        catch {
            /* token tracking should never break streaming */
        }
        logger.debug('SSE session completed', {
            sessionId: session.sessionId,
            events: session.buffer.length,
        });
    })
        .catch((err) => {
        logger.warn('SSE session error', {
            sessionId: session.sessionId,
            error: err.message,
        });
        session.error(err.message, 'RUNTIME_ERROR');
    });
});
/**
 * GET /api/v1/ai/chat/events/:sessionId
 * EventSource SSE 端点 — 消费指定 session 的实时事件
 *
 * 流程:
 *   1. 回放 session 缓冲区中已积累的所有事件
 *   2. 如果 session 已完成 → 直接结束流
 *   3. 否则订阅实时事件，直到 stream:done / stream:error
 *
 * 使用原生 EventSource API 消费（浏览器内置 SSE 支持，无缓冲问题）
 */
router.get('/chat/events/:sessionId', (req, res) => {
    const session = getStreamSession(req.params.sessionId);
    if (!session) {
        res.status(404).json({ success: false, error: 'Session not found or expired' });
        return;
    }
    // ─── SSE Headers ───
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (res.socket) {
        res.socket.setNoDelay(true);
        res.socket.setTimeout(0);
    }
    /** 写入一个 SSE data 行 */
    function writeEvent(event) {
        if (res.writableEnded) {
            return;
        }
        const line = `data: ${JSON.stringify(event)}\n\n`;
        res.write(line);
    }
    // 1) 回放缓冲区
    let isDone = false;
    for (const event of session.buffer) {
        writeEvent(event);
        if (event.type === 'stream:done' || event.type === 'stream:error') {
            isDone = true;
        }
    }
    // 2) 如果已完成，直接关闭
    if (isDone || session.completed) {
        res.end();
        return;
    }
    // 3) 订阅实时事件
    const unsubscribe = session.on((event) => {
        writeEvent(event);
        if (event.type === 'stream:done' || event.type === 'stream:error') {
            unsubscribe();
            clearInterval(heartbeat);
            res.end();
        }
    });
    // 心跳保活 (每 15 秒)
    const heartbeat = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(heartbeat);
            return;
        }
        res.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);
    // 客户端断开连接时清理
    res.on('close', () => {
        unsubscribe();
        clearInterval(heartbeat);
    });
});
/**
 * GET /api/v1/ai/token-usage
 * 近 7 日 Token 消耗报告（按日 + 按来源 + 总计）
 */
router.get('/token-usage', async (req, res) => {
    const container = getServiceContainer();
    let tokenStore;
    try {
        tokenStore = container.get('tokenUsageStore');
    }
    catch {
        return void res.json({
            success: true,
            data: {
                daily: [],
                bySource: [],
                summary: {
                    input_tokens: 0,
                    output_tokens: 0,
                    total_tokens: 0,
                    call_count: 0,
                    avg_per_call: 0,
                },
            },
        });
    }
    const report = tokenStore.getLast7DaysReport();
    res.json({ success: true, data: report });
});
export default router;

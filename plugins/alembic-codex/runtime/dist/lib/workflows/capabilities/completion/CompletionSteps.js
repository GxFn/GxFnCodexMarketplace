/**
 * CompletionSteps — Workflow 完成阶段的各步骤实现
 *
 * 包含 Cursor Delivery、交付验证、Panorama 刷新、Wiki 生成
 * 和语义记忆固化，由 WorkflowCompletionFinalizer 按顺序调用。
 */
// ── DeliveryCompletionStep ──
export async function runCursorDelivery({ getServiceContainer, log, }) {
    try {
        const container = await getServiceContainer();
        const pipeline = container.services?.cursorDeliveryPipeline
            ? container.get?.('cursorDeliveryPipeline')
            : undefined;
        if (!pipeline) {
            return;
        }
        const deliveryResult = await pipeline.deliver();
        log.info(`[DimensionComplete] Auto Cursor Delivery complete — ` +
            `A: ${deliveryResult.channelA?.rulesCount || 0} rules, ` +
            `B: ${deliveryResult.channelB?.topicCount || 0} topics, ` +
            `C: ${deliveryResult.channelC?.synced || 0} skills, ` +
            `F: ${deliveryResult.channelF?.filesWritten || 0} agent files`);
    }
    catch (err) {
        log.warn(`[DimensionComplete] Auto CursorDelivery failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
}
// ── DeliveryVerificationStep ──
export async function verifyDelivery({ ctx, log, }) {
    try {
        const { DeliveryVerifier } = await import('#service/bootstrap/DeliveryVerifier.js');
        const { resolveDataRoot, resolveProjectRoot } = await import('#shared/resolveProjectRoot.js');
        const projectRoot = resolveProjectRoot(ctx.container);
        const dataRoot = resolveDataRoot(ctx.container) || projectRoot;
        const verifier = new DeliveryVerifier(projectRoot, dataRoot);
        const verification = verifier.verify();
        if (!verification.allPassed) {
            log.warn('[DimensionComplete] Delivery verification incomplete', {
                failures: verification.failures,
            });
        }
        else {
            log.info('[DimensionComplete] Delivery verification passed — all channels OK');
        }
        return verification;
    }
    catch (err) {
        log.warn(`[DimensionComplete] DeliveryVerifier failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
// ── PanoramaCompletionStep ──
export async function refreshPanorama({ getServiceContainer, log, }) {
    try {
        const container = await getServiceContainer();
        const panoramaService = container.services?.panoramaService
            ? container.get?.('panoramaService')
            : undefined;
        if (!panoramaService || typeof panoramaService.rescan !== 'function') {
            return;
        }
        await panoramaService.rescan();
        const overview = await panoramaService.getOverview();
        log.info(`[DimensionComplete] Panorama refreshed — ${overview.moduleCount} modules, ${overview.gapCount} gaps`);
    }
    catch (err) {
        log.warn(`[DimensionComplete] Panorama refresh failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
}
// ── WikiCompletionStep ──
export async function generateWiki({ getServiceContainer, projectRoot, log, }) {
    try {
        const container = await getServiceContainer();
        const { WikiGenerator } = await import('#service/wiki/WikiGenerator.js');
        const moduleService = container.get?.('moduleService');
        const knowledgeService = container.get?.('knowledgeService');
        if (!moduleService || !knowledgeService) {
            return;
        }
        const wikiDeps = {
            projectRoot,
            moduleService: moduleService,
            knowledgeService: knowledgeService,
            options: { mode: 'bootstrap' },
        };
        const wikiGenerator = new WikiGenerator(wikiDeps);
        const wikiResult = await wikiGenerator.generate();
        log.info(`[DimensionComplete] Auto Wiki generation: ${wikiResult.totalPages || 0} pages`);
    }
    catch (err) {
        log.warn(`[DimensionComplete] Wiki generation failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
}
export async function consolidateSemanticMemory({ ctx, session, dataRoot, log, dependencies = {}, }) {
    try {
        const db = ctx.container.get?.('database') ?? ctx.container.get?.('db');
        if (!isPersistentMemoryDb(db) || !isCompletionSessionStore(session.sessionStore)) {
            return null;
        }
        const semanticMemory = dependencies.createPersistentMemory
            ? await dependencies.createPersistentMemory(db, dataRoot, log)
            : await createDefaultPersistentMemory(db, dataRoot, log);
        const consolidator = dependencies.createConsolidator
            ? await dependencies.createConsolidator(semanticMemory, log)
            : await createDefaultConsolidator(semanticMemory, log);
        const result = await consolidator.consolidate(session.sessionStore, {
            bootstrapSession: session.id,
            clearPrevious: true,
        });
        const total = isWorkflowSemanticMemoryConsolidationResult(result) ? result.total : null;
        log.info(`[DimensionComplete] Semantic Memory consolidation: +${total?.added || 0} ADD, ~${total?.updated || 0} UPDATE`);
        if (isWorkflowSemanticMemoryConsolidationResult(result)) {
            return result;
        }
        return null;
    }
    catch (err) {
        log.warn(`[DimensionComplete] SemanticMemory consolidation failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
async function createDefaultPersistentMemory(db, dataRoot, log) {
    const { PersistentMemory } = await import('#agent/memory/PersistentMemory.js');
    const { MemoryEmbeddingStore } = await import('#agent/memory/MemoryEmbeddingStore.js');
    return new PersistentMemory(db, {
        logger: {
            info: (msg) => log.info(msg),
            warn: (msg) => log.warn(msg),
        },
        embeddingStore: new MemoryEmbeddingStore(dataRoot),
    });
}
async function createDefaultConsolidator(semanticMemory, log) {
    const { EpisodicConsolidator } = await import('#agent/domain/EpisodicConsolidator.js');
    const { PersistentMemory } = await import('#agent/memory/PersistentMemory.js');
    return new EpisodicConsolidator(semanticMemory, {
        logger: {
            info: (msg) => log.info(msg),
        },
    });
}
function isPersistentMemoryDb(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return (typeof candidate.getDb === 'function' ||
        (typeof candidate.prepare === 'function' &&
            typeof candidate.exec === 'function' &&
            typeof candidate.transaction === 'function'));
}
function isCompletionSessionStore(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return (typeof candidate.getCompletedDimensions === 'function' &&
        typeof candidate.getDimensionReport === 'function' &&
        typeof candidate.toJSON === 'function');
}
function isWorkflowSemanticMemoryConsolidationResult(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    if (!candidate.total || typeof candidate.total !== 'object') {
        return false;
    }
    const total = candidate.total;
    return (typeof total.added === 'number' &&
        typeof total.updated === 'number' &&
        typeof total.merged === 'number' &&
        typeof total.skipped === 'number' &&
        typeof candidate.durationMs === 'number');
}

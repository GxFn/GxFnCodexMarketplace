import path from 'node:path';
import { MemoryCoordinator } from '#agent/memory/MemoryCoordinator.js';
import { MemoryEmbeddingStore } from '#agent/memory/MemoryEmbeddingStore.js';
import { PersistentMemory } from '#agent/memory/PersistentMemory.js';
import { SessionStore } from '#agent/memory/SessionStore.js';
import Logger from '#infra/logging/Logger.js';
import { DimensionContext } from '#workflows/capabilities/execution/internal-agent/DimensionContext.js';
import { syncRestoredSessionStoreDigests } from '#workflows/capabilities/persistence/DimensionCheckpoint.js';
const logger = Logger.getInstance();
export async function initializeBootstrapRuntime({ container, projectRoot, dataRoot, primaryLang, allFiles, targetFileMap, depGraphData, astProjectSummary, guardAudit, isIncremental, incrementalPlan, }) {
    const projectGraph = await buildBootstrapProjectGraph({ container, projectRoot });
    logger.info('[Insight-v7] Using unified AgentRuntime pipeline (no legacy Analyst/Producer wrappers)');
    container.singletons._fileCache = allFiles;
    const projectInfo = {
        name: path.basename(projectRoot),
        lang: primaryLang || 'unknown',
        fileCount: allFiles?.length || 0,
    };
    const modules = Object.keys(targetFileMap || {});
    const dimContext = new DimensionContext({
        projectName: projectInfo.name,
        primaryLang: projectInfo.lang,
        fileCount: projectInfo.fileCount,
        targetCount: modules.length,
        modules,
        depGraph: depGraphData ?? undefined,
        astMetrics: astProjectSummary?.projectMetrics ?? undefined,
        guardSummary: guardAudit?.summary ?? undefined,
    });
    const sessionStore = isIncremental && incrementalPlan?.restoredEpisodic
        ? incrementalPlan.restoredEpisodic
        : new SessionStore({
            projectName: projectInfo.name,
            primaryLang: projectInfo.lang,
            fileCount: projectInfo.fileCount,
            modules,
        });
    if (isIncremental && incrementalPlan?.restoredEpisodic) {
        syncRestoredSessionStoreDigests({ sessionStore, dimContext });
    }
    const semanticMemory = createBootstrapSemanticMemory({
        container,
        dataRoot,
    });
    const codeEntityGraphInst = await createBootstrapCodeEntityGraph({
        container,
        projectRoot,
    });
    const memoryCoordinator = new MemoryCoordinator({
        persistentMemory: semanticMemory,
        sessionStore,
        mode: 'bootstrap',
    });
    return {
        projectGraph,
        projectInfo,
        dimContext,
        sessionStore,
        semanticMemory,
        codeEntityGraphInst,
        memoryCoordinator,
    };
}
async function buildBootstrapProjectGraph({ container, projectRoot, }) {
    try {
        const projectGraph = (await container.buildProjectGraph?.(projectRoot, {
            maxFiles: 500,
            timeoutMs: 15_000,
        })) ?? null;
        if (projectGraph) {
            const overview = await projectGraph.getOverview();
            logger.info(`[Insight-v3] ProjectGraph: ${overview.totalClasses} classes, ${overview.totalProtocols} protocols (${overview.buildTimeMs}ms)`);
        }
        return projectGraph;
    }
    catch (e) {
        logger.warn(`[Insight-v3] ProjectGraph build failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}
function createBootstrapSemanticMemory({ container, dataRoot, }) {
    try {
        const db = container.get('database');
        if (!db) {
            return null;
        }
        let embeddingFn;
        try {
            const ep = container.singletons?._embedProvider ?? container.singletons?.aiProvider;
            if (ep && typeof ep.embed === 'function') {
                const provider = ep;
                embeddingFn = async (text) => {
                    const result = await provider.embed(text);
                    return result;
                };
            }
        }
        catch {
            /* EmbedProvider is optional. */
        }
        const semanticMemory = new PersistentMemory(db, {
            logger,
            embeddingFn,
            embeddingStore: new MemoryEmbeddingStore(dataRoot),
        });
        const smStats = semanticMemory.getStats();
        if (smStats.total > 0) {
            logger.info(`[Insight-v3] Loaded ${smStats.total} semantic memories from previous bootstrap ` +
                `(fact: ${smStats.byType.fact || 0}, insight: ${smStats.byType.insight || 0}, preference: ${smStats.byType.preference || 0})`);
        }
        return semanticMemory;
    }
    catch (smErr) {
        logger.warn(`[Insight-v3] SemanticMemory init failed (non-blocking): ${smErr instanceof Error ? smErr.message : String(smErr)}`);
        return null;
    }
}
async function createBootstrapCodeEntityGraph({ container, projectRoot, }) {
    try {
        const { CodeEntityGraph } = await import('#service/knowledge/CodeEntityGraph.js');
        const entityRepo = container.get('codeEntityRepository');
        const edgeRepo = container.get('knowledgeEdgeRepository');
        if (entityRepo && edgeRepo) {
            const codeEntityGraphInst = new CodeEntityGraph(entityRepo, edgeRepo, { projectRoot, logger });
            const topo = await codeEntityGraphInst.getTopology();
            if (topo.totalEntities > 0) {
                logger.info(`[Insight-v3] CodeEntityGraph: ${topo.totalEntities} entities, ${topo.totalEdges} edges`);
            }
            return codeEntityGraphInst;
        }
    }
    catch (cegErr) {
        logger.warn(`[Insight-v3] CodeEntityGraph init failed (non-blocking): ${cegErr instanceof Error ? cegErr.message : String(cegErr)}`);
    }
    return null;
}

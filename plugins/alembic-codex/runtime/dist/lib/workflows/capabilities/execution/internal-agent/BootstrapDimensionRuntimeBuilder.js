import { ExplorationTracker } from '#agent/context/ExplorationTracker.js';
import { computeAnalystBudget } from '#agent/prompts/insight-analyst.js';
import { createSystemRunContext, projectSystemRunContext, } from '#agent/runtime/SystemRunContext.js';
import { getDimensionFocusKeywords } from '#domain/dimension/DimensionSop.js';
import { buildEvidenceStarters } from '#workflows/capabilities/execution/external/EvidenceStarterBuilder.js';
import { buildBootstrapDimensionRunInput, } from '#workflows/capabilities/execution/internal-agent/BootstrapInputBuilders.js';
import { getBootstrapDimensionExistingRecipes, projectBootstrapDimensionRescanContext, projectBootstrapExistingRecipesForPrompt, } from '#workflows/capabilities/execution/internal-agent/BootstrapRescanState.js';
import { DIMENSION_CONFIGS_V3, getFullDimensionConfig, } from '#workflows/capabilities/planning/dimensions/bootstrapDimensionConfigs.js';
export function resolveBootstrapDimensionPlan({ dimId, dimensions, rescanContext, }) {
    const dim = dimensions.find((candidate) => candidate.id === dimId);
    if (!dim) {
        return null;
    }
    const fullConfig = getFullDimensionConfig(dimId);
    const v3Config = DIMENSION_CONFIGS_V3[dimId];
    const dimConfig = fullConfig
        ? {
            ...fullConfig,
            focusKeywords: fullConfig.focusKeywords || [],
        }
        : v3Config
            ? {
                ...v3Config,
                id: dimId,
                label: dim.label,
                guide: dim.guide || '',
                focusKeywords: getDimensionFocusKeywords(dimId, dim.guide || ''),
                skillWorthy: dim.skillWorthy,
                dualOutput: dim.dualOutput,
                skillMeta: dim.skillMeta,
                knowledgeTypes: dim.knowledgeTypes || v3Config.allowedKnowledgeTypes,
            }
            : {
                id: dimId,
                label: dim.label,
                guide: dim.guide || '',
                focusKeywords: getDimensionFocusKeywords(dimId, dim.guide || ''),
                outputType: dim.dualOutput ? 'dual' : dim.skillWorthy ? 'skill' : 'candidate',
                allowedKnowledgeTypes: dim.knowledgeTypes || [],
                skillWorthy: dim.skillWorthy,
                dualOutput: dim.dualOutput,
                skillMeta: dim.skillMeta,
                knowledgeTypes: dim.knowledgeTypes || [],
            };
    const v3OutputType = DIMENSION_CONFIGS_V3[dimId]
        ?.outputType;
    const baseNeedsCandidates = Boolean(v3OutputType ? v3OutputType !== 'skill' : !dimConfig.skillWorthy || dimConfig.dualOutput);
    const dimExistingRecipes = getBootstrapDimensionExistingRecipes({ rescanContext, dimId });
    const rescanExecutionDecision = rescanContext?.executionDecisions[dimId];
    const needsCandidates = rescanExecutionDecision
        ? baseNeedsCandidates &&
            rescanExecutionDecision.mode === 'produce' &&
            rescanExecutionDecision.createBudget > 0
        : baseNeedsCandidates;
    return {
        dim,
        dimConfig,
        needsCandidates,
        dimExistingRecipes,
        hasExistingRecipes: dimExistingRecipes.length > 0,
        prescreenDone: rescanContext?.evolutionPrescreen !== undefined,
        ...(rescanExecutionDecision ? { rescanExecutionDecision } : {}),
    };
}
export function createBootstrapDimensionRuntimeInput({ dimId, plan, memoryCoordinator, systemRunContextFactory, projectInfo, primaryLang, dimContext, sessionStore, semanticMemory, codeEntityGraphInst, projectGraph, panoramaResult, astProjectSummary, guardAudit, depGraphData, callGraphResult, rescanContext, targetFileMap, globalSubmittedTitles, globalSubmittedPatterns, globalSubmittedTriggers, bootstrapDedup, sessionId, allFiles, sessionAbortSignal, }) {
    const { dimConfig, needsCandidates, dimExistingRecipes, hasExistingRecipes, prescreenDone } = plan;
    const analystScopeId = `${dimId}:analyst`;
    memoryCoordinator.createDimensionScope(analystScopeId);
    const effectiveOutputType = needsCandidates ? 'candidate' : dimConfig.outputType || 'analysis';
    const dimensionMeta = {
        id: dimId,
        outputType: effectiveOutputType,
        allowedKnowledgeTypes: dimConfig.allowedKnowledgeTypes || [],
    };
    const contextWindow = systemRunContextFactory.createContextWindow({ isSystem: true });
    const computedBudget = computeAnalystBudget(projectInfo.fileCount || 0, contextWindow.tokenBudget);
    const systemRunContext = createSystemRunContext({
        memoryCoordinator,
        scopeId: analystScopeId,
        activeContext: memoryCoordinator.getActiveContext(analystScopeId),
        contextWindow,
        tracker: ExplorationTracker.resolve({ source: 'system', strategy: 'analyst' }, computedBudget),
        source: 'system',
        outputType: effectiveOutputType,
        dimId,
        dimensionId: dimId,
        dimensionLabel: dimConfig.label,
        projectLanguage: primaryLang || projectInfo.lang || null,
        dimensionMeta,
        sharedState: {
            submittedTitles: globalSubmittedTitles,
            submittedPatterns: globalSubmittedPatterns,
            submittedTriggers: globalSubmittedTriggers,
            _bootstrapDedup: bootstrapDedup,
        },
        extraFields: {
            _computedBudget: computedBudget,
            needsCandidates,
            dimConfig,
            projectInfo,
            dimContext,
            sessionStore,
            semanticMemory,
            codeEntityGraph: codeEntityGraphInst,
            projectGraph,
            panorama: buildPanoramaContext(panoramaResult),
            evidenceStarters: buildEvidenceStarters(plan.dim, {
                astData: astProjectSummary,
                guardAudit,
                depGraphData,
                callGraphResult,
                panoramaResult,
            }),
            rescanContext: projectBootstrapDimensionRescanContext({ rescanContext, dimId }),
            existingRecipes: projectBootstrapExistingRecipesForPrompt(dimExistingRecipes),
            projectOverview: {
                primaryLang: primaryLang || projectInfo.lang || 'unknown',
                fileCount: projectInfo.fileCount || 0,
                modules: Object.keys(targetFileMap || {}),
            },
        },
    });
    const strategyContext = projectSystemRunContext(systemRunContext);
    return {
        analystScopeId,
        runInput: buildBootstrapDimensionRunInput({
            dimId,
            dimConfig,
            needsCandidates,
            hasExistingRecipes,
            prescreenDone,
            sessionId,
            primaryLang,
            projectLang: projectInfo.lang || null,
            allFiles,
            systemRunContext,
            strategyContext,
            memoryCoordinator,
            sessionAbortSignal,
        }),
    };
}
export function buildPanoramaContext(panoramaResult) {
    if (!panoramaResult) {
        return null;
    }
    try {
        const modules = panoramaResult.modules;
        const layers = panoramaResult.layers;
        const gaps = panoramaResult.gaps ?? [];
        const layerNames = (layers?.levels ?? [])
            .map((layer) => `L${layer.level}:${layer.name}`)
            .join(' → ');
        const knownGaps = gaps.slice(0, 5).flatMap((gap) => gap.suggestedFocus ?? []);
        let moduleRole = null;
        let moduleLayer = null;
        let moduleCoupling = null;
        if (modules instanceof Map && modules.size > 0) {
            const firstModule = modules.values().next().value;
            if (firstModule) {
                moduleRole =
                    firstModule.refinedRole ?? firstModule.inferredRole ?? null;
                moduleLayer = firstModule.layer ?? null;
                moduleCoupling = {
                    fanIn: firstModule.fanIn ?? 0,
                    fanOut: firstModule.fanOut ?? 0,
                };
            }
        }
        return {
            moduleRole,
            moduleLayer,
            moduleCoupling,
            knownGaps: [...new Set(knownGaps)],
            layerContext: layerNames || null,
        };
    }
    catch {
        return null;
    }
}

import { resolveRecipeDimensionId } from '#domain/dimension/RecipeDimension.js';
import Logger from '#infra/logging/Logger.js';
import { BootstrapDedup } from '#service/bootstrap/BootstrapDedup.js';
const logger = Logger.getInstance();
export function prepareBootstrapRescanState({ existingRecipes, evolutionPrescreen, executionDecisions, }) {
    const globalSubmittedTitles = new Set();
    const globalSubmittedPatterns = new Set();
    const globalSubmittedTriggers = new Set();
    const bootstrapDedup = new BootstrapDedup();
    const existingRecipesList = Array.isArray(existingRecipes)
        ? existingRecipes
        : null;
    if (existingRecipesList && existingRecipesList.length > 0) {
        for (const recipe of existingRecipesList) {
            if (recipe.title && recipe.status !== 'decaying') {
                globalSubmittedTitles.add(recipe.title.toLowerCase().trim());
            }
            if (recipe.trigger) {
                globalSubmittedTriggers.add(recipe.trigger.toLowerCase().trim());
            }
        }
        logger.info(`[Insight-v3] Rescan mode: seeded ${globalSubmittedTitles.size} titles + ${globalSubmittedTriggers.size} triggers into dedup set`);
    }
    return {
        globalSubmittedTitles,
        globalSubmittedPatterns,
        globalSubmittedTriggers,
        bootstrapDedup,
        existingRecipesList,
        rescanContext: buildBootstrapRescanContext({
            existingRecipesList,
            evolutionPrescreen,
            executionDecisions,
        }),
    };
}
function buildBootstrapRescanContext({ existingRecipesList, evolutionPrescreen, executionDecisions, }) {
    if (!existingRecipesList) {
        return null;
    }
    return {
        existingRecipes: existingRecipesList.filter((recipe) => recipe.status !== 'decaying'),
        decayingRecipes: existingRecipesList.filter((recipe) => recipe.status === 'decaying'),
        occupiedTriggers: existingRecipesList.map((recipe) => recipe.trigger).filter(Boolean),
        executionDecisions: Object.fromEntries((executionDecisions ?? []).map((decision) => [decision.dimensionId, decision])),
        coverageByDim: existingRecipesList.reduce((acc, recipe) => {
            if (recipe.status !== 'decaying') {
                const dim = recipeDimensionKey(recipe);
                acc[dim] = (acc[dim] || 0) + 1;
            }
            return acc;
        }, {}),
        evolutionPrescreen: evolutionPrescreen ?? undefined,
    };
}
export function getBootstrapDimensionExistingRecipes({ rescanContext, dimId, }) {
    return [
        ...(rescanContext?.existingRecipes?.filter((recipe) => recipeDimensionKey(recipe) === dimId) ??
            []),
        ...(rescanContext?.decayingRecipes?.filter((recipe) => recipeDimensionKey(recipe) === dimId) ??
            []),
    ];
}
export function projectBootstrapDimensionRescanContext({ rescanContext, dimId, }) {
    if (!rescanContext) {
        return null;
    }
    const fallbackExisting = rescanContext.coverageByDim[dimId] || 0;
    const fallbackGap = Math.max(0, 5 - fallbackExisting);
    const executionDecision = rescanContext.executionDecisions[dimId];
    const executionMode = executionDecision?.mode ?? (fallbackGap > 0 ? 'produce' : 'skip');
    return {
        existingRecipes: rescanContext.existingRecipes.filter((recipe) => recipeDimensionKey(recipe) === dimId),
        decayingRecipes: rescanContext.decayingRecipes.filter((recipe) => recipeDimensionKey(recipe) === dimId),
        occupiedTriggers: rescanContext.occupiedTriggers,
        gap: executionDecision?.gap ?? fallbackGap,
        createBudget: executionDecision?.createBudget ?? fallbackGap,
        executionMode,
        shouldExecute: executionDecision?.shouldExecute ?? executionMode !== 'skip',
        existing: executionDecision?.existingCount ?? fallbackExisting,
    };
}
function recipeDimensionKey(recipe) {
    return (resolveRecipeDimensionId(recipe) ||
        recipe.dimensionId ||
        recipe.category ||
        recipe.knowledgeType ||
        'unknown');
}
export function projectBootstrapExistingRecipesForPrompt(recipes) {
    return recipes.map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        trigger: recipe.trigger,
        content: recipe.content,
        sourceRefs: recipe.sourceRefs,
        auditHint: recipe.auditScore != null
            ? {
                relevanceScore: recipe.auditScore,
                verdict: recipe.status === 'decaying' ? 'decay' : 'watch',
                evidence: recipe.auditEvidence ?? {},
                decayReasons: recipe.decayReason ? [String(recipe.decayReason)] : [],
            }
            : null,
    }));
}

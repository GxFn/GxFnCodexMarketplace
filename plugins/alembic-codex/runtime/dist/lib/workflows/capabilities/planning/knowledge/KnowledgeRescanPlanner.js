import path from 'node:path';
import { EvolutionPolicy } from '#domain/evolution/EvolutionPolicy.js';
import { buildEvolutionPrescreen, } from '#workflows/capabilities/planning/knowledge/EvolutionPrescreen.js';
import { buildKnowledgeRescanPlan, TARGET_RECIPES_PER_DIMENSION, } from './KnowledgeRescanPlanBuilder.js';
import { projectExternalRescanEvidencePlan, projectInternalRescanGapPlan, projectInternalRescanPromptRecipes, projectInternalRescanPromptRecipesFromParts, } from './RescanEvidenceProjectors.js';
export { buildKnowledgeRescanPlan, projectExternalRescanEvidencePlan, projectInternalRescanGapPlan, projectInternalRescanPromptRecipes, TARGET_RECIPES_PER_DIMENSION, };
export function syncKnowledgeStoreForRescan(opts) {
    try {
        if (opts.container.services && !opts.container.services.knowledgeSyncService) {
            return;
        }
        const syncService = opts.container.get('knowledgeSyncService');
        if (!syncService) {
            return;
        }
        const syncReport = syncService.sync(opts.db, { force: true });
        opts.logger.info(`[${opts.logPrefix}] KnowledgeSyncService sync complete`, {
            synced: syncReport.synced,
            created: syncReport.created,
            updated: syncReport.updated,
        });
    }
    catch (err) {
        opts.logger.warn(`[${opts.logPrefix}] KnowledgeSyncService sync failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * 对保留的 Recipe 进行覆盖分类，为 gap analysis 和 EvolutionPrescreen 提供数据。
 *
 * 进化触发由 RecipeImpactPlanner + EvolutionAgent 管线负责，
 * 本函数仅负责 coverage classification（全量 recipe → verdict）。
 *
 * 数据来源优先级：
 *   1. RecipeImpactPlanner 候选（candidatePlan）— 精确的 diff-based 影响评估
 *   2. SourceRef 桥接表（recipeSourceRefRepository）— active/stale 文件映射
 *   3. Recipe 生命周期（lifecycle）— 兜底分类
 *
 * 评分由 EvolutionPolicy.classifyRelevance() 统一分级（阈值: 80/60/40/20）。
 */
export async function auditRecipesForRescan(opts) {
    const { recipeEntries, allFiles, projectRoot, candidatePlan, container, logger } = opts;
    if (recipeEntries.length === 0) {
        return emptyAuditSummary();
    }
    const filePathSet = buildComparableFilePathSet(allFiles, projectRoot);
    const impactMap = buildImpactMap(candidatePlan);
    let sourceRefRepo = null;
    try {
        sourceRefRepo = container.get('recipeSourceRefRepository');
    }
    catch {
        logger.info('[CoverageClassifier] recipeSourceRefRepository not available, using fallback');
    }
    const staleByRecipe = sourceRefRepo ? buildStaleMap(sourceRefRepo) : null;
    const results = [];
    const counters = { healthy: 0, watch: 0, decay: 0, severe: 0, dead: 0 };
    for (const entry of recipeEntries) {
        const result = classifyRecipe(entry, {
            impactMap,
            staleByRecipe,
            sourceRefRepo,
            filePathSet,
        });
        counters[result.verdict]++;
        results.push(result);
    }
    return {
        totalAudited: recipeEntries.length,
        ...counters,
        results,
        proposalsCreated: 0,
        immediateDeprecated: counters.dead,
    };
}
function buildComparableFilePathSet(allFiles, projectRoot) {
    const paths = new Set();
    for (const file of allFiles) {
        addComparablePath(paths, file.relativePath);
        addComparablePath(paths, file.name);
        addComparablePath(paths, file.path);
        if (file.path && projectRoot && path.isAbsolute(file.path)) {
            addComparablePath(paths, path.relative(projectRoot, file.path));
        }
    }
    return paths;
}
function addComparablePath(paths, value) {
    const normalized = normalizeComparablePath(value);
    if (normalized) {
        paths.add(normalized);
    }
}
function normalizeComparablePath(value) {
    if (!value) {
        return '';
    }
    return path.normalize(value).replace(/\\/g, '/').replace(/^\.\//, '');
}
function buildImpactMap(candidatePlan) {
    const map = new Map();
    if (!candidatePlan) {
        return map;
    }
    for (const c of candidatePlan.candidates) {
        map.set(c.recipeId, {
            reason: c.reason,
            impactScore: c.impactScore,
            affectedFiles: c.affectedFiles,
        });
    }
    return map;
}
function buildStaleMap(repo) {
    const map = new Map();
    try {
        const staleCounts = repo.getStaleCountsByRecipe();
        for (const row of staleCounts) {
            map.set(row.recipeId, {
                active: row.totalCount - row.staleCount,
                stale: row.staleCount,
                total: row.totalCount,
            });
        }
    }
    catch {
        // table may not exist yet
    }
    return map;
}
// ── 单条 Recipe 分类 ────────────────────────────────────
function classifyRecipe(entry, ctx) {
    const decayReasons = [];
    // ── 层 1: RecipeImpactPlanner 精确候选 ──
    const impact = ctx.impactMap.get(entry.id);
    if (impact) {
        const { score, reasons } = impactToScore(impact);
        decayReasons.push(...reasons);
        return buildResult(entry, score, decayReasons, buildImpactEvidence(impact, ctx.filePathSet));
    }
    // ── 层 2: SourceRef 桥接表健康度 ──
    if (ctx.staleByRecipe) {
        const refHealth = ctx.staleByRecipe.get(entry.id);
        if (refHealth) {
            const { score, reasons } = refHealthToScore(refHealth);
            decayReasons.push(...reasons);
            return buildResult(entry, score, decayReasons, buildRefEvidence(refHealth, ctx.filePathSet, entry));
        }
        // recipe 有 SourceRef 记录但全是 active（不在 stale 统计中）
        if (ctx.sourceRefRepo) {
            const refs = ctx.sourceRefRepo.findByRecipeId(entry.id);
            if (refs.length > 0) {
                const activeCount = refs.filter((r) => r.status === 'active').length;
                const ratio = activeCount / refs.length;
                const score = Math.round(ratio * 100);
                if (ratio < 1) {
                    decayReasons.push(`SourceRef ${activeCount}/${refs.length} active`);
                }
                return buildResult(entry, score, decayReasons, {
                    triggerStillMatches: true,
                    symbolsAlive: activeCount,
                    depsIntact: ratio >= 0.5,
                    codeFilesExist: activeCount,
                });
            }
        }
    }
    // ── 层 3: 生命周期兜底 ──
    const { score, reasons } = lifecycleToScore(entry, ctx.filePathSet);
    decayReasons.push(...reasons);
    return buildResult(entry, score, decayReasons, buildLifecycleEvidence(entry, ctx.filePathSet));
}
// ── Impact → Score 映射 ─────────────────────────────────
function impactToScore(impact) {
    const reasons = [];
    switch (impact.reason) {
        case 'source-deleted':
            reasons.push(`all source files deleted: ${impact.affectedFiles.join(', ')}`);
            return { score: 10, reasons };
        case 'source-deleted-partial':
            reasons.push(`partial source deleted: ${impact.affectedFiles.join(', ')}`);
            return { score: 30, reasons };
        case 'source-modified-pattern':
            reasons.push(`source pattern modified (impact: ${(impact.impactScore * 100).toFixed(0)}%)`);
            return { score: Math.round(60 - impact.impactScore * 40), reasons };
        case 'source-missing':
            reasons.push(`SourceRef stale: files no longer found`);
            return { score: 50, reasons };
        default:
            return { score: 70, reasons };
    }
}
// ── RefHealth → Score 映射 ──────────────────────────────
function refHealthToScore(health) {
    const reasons = [];
    if (health.total === 0) {
        return { score: 70, reasons };
    }
    const ratio = health.active / health.total;
    if (health.active === 0) {
        reasons.push(`all ${health.total} SourceRefs stale`);
        return { score: 15, reasons };
    }
    if (ratio < 0.5) {
        reasons.push(`SourceRef ${health.active}/${health.total} active (${(ratio * 100).toFixed(0)}%)`);
        return { score: Math.round(30 + ratio * 40), reasons };
    }
    reasons.push(`SourceRef ${health.active}/${health.total} active`);
    return { score: Math.round(50 + ratio * 30), reasons };
}
// ── Lifecycle 兜底 Score ────────────────────────────────
function lifecycleToScore(entry, filePathSet) {
    const reasons = [];
    const hasSourceFiles = (entry.sourceRefs?.length ?? 0) > 0;
    const existingFiles = hasSourceFiles
        ? (entry.sourceRefs ?? []).filter((ref) => filePathSet.has(normalizeComparablePath(ref))).length
        : 0;
    switch (entry.lifecycle) {
        case 'active':
        case 'evolving':
            if (hasSourceFiles && existingFiles === 0) {
                reasons.push('active recipe but all sourceRefs missing from project');
                return { score: 55, reasons };
            }
            return { score: 90, reasons };
        case 'staging':
            if (hasSourceFiles && existingFiles === 0) {
                reasons.push('staging recipe with missing sourceRefs');
                return { score: 45, reasons };
            }
            return { score: 70, reasons };
        case 'decaying':
            reasons.push('lifecycle already marked as decaying');
            return { score: 35, reasons };
        default:
            return { score: 60, reasons };
    }
}
// ── Evidence 构建器 ─────────────────────────────────────
function buildImpactEvidence(impact, _filePathSet) {
    const isDeleted = impact.reason === 'source-deleted' || impact.reason === 'source-deleted-partial';
    return {
        triggerStillMatches: !isDeleted,
        symbolsAlive: isDeleted ? 0 : 1,
        depsIntact: !isDeleted,
        codeFilesExist: isDeleted ? 0 : impact.affectedFiles.length,
    };
}
function buildRefEvidence(health, _filePathSet, _entry) {
    return {
        triggerStillMatches: health.active > 0,
        symbolsAlive: health.active,
        depsIntact: health.active > 0,
        codeFilesExist: health.active,
    };
}
function buildLifecycleEvidence(entry, filePathSet) {
    const refs = entry.sourceRefs ?? [];
    const existCount = refs.filter((ref) => filePathSet.has(normalizeComparablePath(ref))).length;
    return {
        triggerStillMatches: entry.lifecycle === 'active' || entry.lifecycle === 'evolving',
        symbolsAlive: existCount,
        depsIntact: existCount > 0 || refs.length === 0,
        codeFilesExist: existCount,
    };
}
// ── 共用工具 ────────────────────────────────────────────
function buildResult(entry, rawScore, decayReasons, evidence) {
    const score = Math.max(0, Math.min(100, rawScore));
    const { verdict } = EvolutionPolicy.classifyRelevance(score);
    return {
        recipeId: entry.id,
        title: entry.title,
        relevanceScore: score,
        verdict,
        evidence,
        decayReasons,
    };
}
function emptyAuditSummary() {
    return {
        totalAudited: 0,
        healthy: 0,
        watch: 0,
        decay: 0,
        severe: 0,
        dead: 0,
        results: [],
        proposalsCreated: 0,
        immediateDeprecated: 0,
    };
}
export function buildRescanPrescreen(auditSummary, recipeEntries, dimensions) {
    return buildEvolutionPrescreen(auditSummary, recipeEntries, dimensions);
}
export function planInternalRescanGaps(opts) {
    return projectInternalRescanGapPlan(buildKnowledgeRescanPlan(opts));
}
export function buildExistingRecipesForInternalFill(opts) {
    return projectInternalRescanPromptRecipesFromParts(opts);
}
export function buildExternalRescanEvidencePlan(opts) {
    return projectExternalRescanEvidencePlan(buildKnowledgeRescanPlan(opts));
}

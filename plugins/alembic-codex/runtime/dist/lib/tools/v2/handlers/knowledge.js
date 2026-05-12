/**
 * @module tools/v2/handlers/knowledge
 *
 * 知识管理工具 — Agent 与 Alembic 知识库交互的统一入口。
 * Actions: search, submit, detail, manage
 *
 * 后端: SearchEngine (BM25 + 向量), RecipeProductionGateway, KnowledgeRepository
 */
import path from 'node:path';
import { dimensionTags } from '#domain/dimension/RecipeDimension.js';
import { getSystemInjectedFields } from '#domain/knowledge/FieldSpec.js';
import { estimateTokens, fail, ok } from '../types.js';
export async function handle(action, params, ctx) {
    switch (action) {
        case 'search':
            return handleSearch(params, ctx);
        case 'submit':
            return handleSubmit(params, ctx);
        case 'detail':
            return handleDetail(params, ctx);
        case 'manage':
            return handleManage(params, ctx);
        default:
            return fail(`Unknown knowledge action: ${action}`);
    }
}
/* ================================================================== */
/*  knowledge.search                                                   */
/* ================================================================== */
async function handleSearch(params, ctx) {
    const query = params.query;
    if (!query) {
        return fail('knowledge.search requires query');
    }
    const kind = params.kind ?? 'all';
    const limit = Math.min(params.limit || 10, 50);
    const category = params.category;
    const engine = ctx.searchEngine;
    if (!engine) {
        return fail('Search engine not available');
    }
    try {
        const results = await engine.search(query, { limit, kind, category });
        const items = results.map((r) => ({
            id: r.id,
            title: r.title,
            kind: r.kind,
            score: r.score,
            preview: truncateText(r.content ?? r.description ?? '', 500),
        }));
        const formatted = items
            .map((i) => `[${i.score.toFixed(2)}] ${i.title}\n  ${i.preview}`)
            .join('\n\n');
        return ok({ count: items.length, items }, { tokensEstimate: estimateTokens(formatted) });
    }
    catch (err) {
        return fail(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/* ================================================================== */
/*  knowledge.submit                                                   */
/* ================================================================== */
async function handleSubmit(params, ctx) {
    const gateway = ctx.recipeGateway;
    if (!gateway) {
        return fail('Recipe gateway not available');
    }
    const validationError = validateSubmitParams(params);
    if (validationError) {
        return fail(`Validation failed: ${validationError}`);
    }
    try {
        if (params.title) {
            params.title = stripProjectNamePrefix(String(params.title), ctx.projectRoot);
        }
        const content = params.content;
        const reasoning = params.reasoning;
        const normalizedSources = normalizeStringArray(reasoning?.sources ?? params.sourceRefs ?? params.filePaths);
        const dimMeta = ctx.runtime?.dimensionMeta ?? null;
        const effectiveDimensionId = dimMeta?.id ?? pickString(params.dimensionId) ?? pickString(ctx.runtime?.dimensionScopeId);
        const isBootstrap = !!dimMeta;
        const allowedKnowledgeType = normalizeStringArray(dimMeta?.allowedKnowledgeTypes)[0];
        const effectiveKnowledgeType = allowedKnowledgeType ?? pickString(params.knowledgeType) ?? 'code-pattern';
        const effectiveCategory = pickString(params.category) ?? 'Utility';
        const effectiveLanguage = pickString(params.language) ??
            pickString(ctx.runtime?.projectLanguage) ??
            pickString(ctx.runtime?.lang) ??
            'markdown';
        const rationale = pickString(content.rationale);
        const description = pickString(params.description) ?? '';
        const itemReasoning = {
            ...reasoning,
            whyStandard: pickString(reasoning?.whyStandard) ?? rationale ?? description,
            sources: normalizedSources,
            confidence: typeof reasoning?.confidence === 'number'
                ? reasoning.confidence
                : (params.confidence ?? 0.75),
        };
        const baseTags = normalizeStringArray(params.tags);
        const tags = isBootstrap ? dimensionTags(effectiveDimensionId, baseTags) : baseTags;
        const item = {
            ...params,
            title: params.title,
            description,
            content,
            kind: params.kind,
            trigger: params.trigger,
            whenClause: params.whenClause,
            doClause: params.doClause,
            dontClause: params.dontClause,
            coreCode: pickString(params.coreCode) ?? pickString(content.pattern) ?? '',
            topicHint: pickString(params.topicHint) ?? effectiveCategory,
            headers: normalizeStringArray(params.headers),
            usageGuide: pickString(params.usageGuide) ?? buildDefaultUsageGuide(params),
            tags,
            reasoning: itemReasoning,
            sourceRefs: normalizeStringArray(params.sourceRefs ?? params.filePaths ?? normalizedSources),
            dimensionId: effectiveDimensionId,
            knowledgeType: effectiveKnowledgeType,
            category: effectiveCategory,
            language: effectiveLanguage,
            source: isBootstrap ? 'bootstrap' : 'agent',
            agentNotes: dimMeta
                ? { dimensionId: dimMeta.id, outputType: pickString(dimMeta.outputType) ?? 'candidate' }
                : null,
        };
        const result = await gateway.create({
            source: 'agent-tool',
            items: [item],
            options: {
                supersedes: pickString(params.supersedes),
                existingTitles: ctx.runtime?.submittedTitles ?? undefined,
                existingTriggers: ctx.runtime?.submittedTriggers ?? undefined,
                existingFingerprints: ctx.runtime?.submittedPatterns ?? undefined,
                systemInjectedFields: isBootstrap ? getSystemInjectedFields() : undefined,
                userId: 'agent',
                bootstrapDedup: isBootstrap ? ctx.runtime?.bootstrapDedup : undefined,
            },
        });
        if (result.created.length > 0) {
            if (ctx.sessionStore) {
                ctx.sessionStore.save(`submit:${item.title}`, JSON.stringify({ title: item.title, kind: item.kind }), { tags: ['submission'] });
            }
            return ok({
                status: 'created',
                id: result.created[0].id,
                title: result.created[0].title,
            });
        }
        if (result.duplicates.length > 0) {
            return ok({
                status: 'duplicate_blocked',
                similar: result.duplicates.map((d) => ({
                    title: d.title,
                    similarity: d.score ?? d.similarTo?.[0]?.similarity ?? 0,
                    similarTo: d.similarTo ?? [],
                })),
            });
        }
        if (result.rejected.length > 0) {
            const rejected = result.rejected[0];
            const details = [
                `Rejected: ${rejected.reason}`,
                ...(Array.isArray(rejected.errors) ? rejected.errors : []),
                ...(Array.isArray(rejected.warnings)
                    ? rejected.warnings.map((warning) => `warning: ${warning}`)
                    : []),
            ].join('\n');
            return fail(details);
        }
        if (result.blocked.length > 0) {
            return fail(`Blocked by consolidation: ${result.blocked[0].title ?? 'unknown'}`);
        }
        return ok({ status: 'processed', result });
    }
    catch (err) {
        return fail(`Submit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function pickString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function stripProjectNamePrefix(title, projectRoot) {
    if (!title || !projectRoot) {
        return title;
    }
    const projectName = path.basename(projectRoot);
    if (!projectName || projectName.length < 2) {
        return title;
    }
    const prefix = new RegExp(`^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[的—–-]?\\s*`, 'i');
    const stripped = title.replace(prefix, '');
    return stripped.length > 0 ? stripped : title;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
}
function buildDefaultUsageGuide(params) {
    const whenClause = pickString(params.whenClause) ?? 'When this project pattern applies.';
    const doClause = pickString(params.doClause) ?? 'Follow the documented project pattern.';
    const dontClause = pickString(params.dontClause) ?? 'Avoid contradicting the documented pattern.';
    return `### When\n${whenClause}\n\n### Do\n${doClause}\n\n### Don't\n${dontClause}`;
}
function validateSubmitParams(params) {
    const errors = [];
    const title = params.title;
    const description = params.description;
    const content = params.content;
    const kind = params.kind;
    const trigger = params.trigger;
    const whenClause = params.whenClause;
    const doClause = params.doClause;
    const reasoning = params.reasoning;
    if (!title || title.length < 3 || title.length > 200) {
        errors.push('title must be 3-200 characters');
    }
    if (!description || description.length < 10) {
        errors.push('description must be ≥10 characters');
    }
    if (!content || typeof content !== 'object') {
        errors.push('content must be an object');
    }
    else {
        const md = content.markdown;
        if (!md || md.length < 200) {
            errors.push('content.markdown must be ≥200 characters');
        }
        const rat = content.rationale;
        if (!rat || rat.length < 50) {
            errors.push('content.rationale must be ≥50 characters');
        }
    }
    if (!kind || !['rule', 'pattern', 'fact'].includes(kind)) {
        errors.push('kind must be rule/pattern/fact');
    }
    if (!trigger || trigger.length < 3) {
        errors.push('trigger is required (≥3 chars)');
    }
    if (!whenClause || whenClause.length < 10) {
        errors.push('whenClause is required (≥10 chars)');
    }
    if (!doClause || doClause.length < 10) {
        errors.push('doClause is required (≥10 chars)');
    }
    const sources = reasoning?.sources;
    if (!reasoning ||
        !Array.isArray(sources) ||
        sources.filter((source) => typeof source === 'string' && source.trim().length > 0).length === 0) {
        errors.push('reasoning.sources must be a non-empty array');
    }
    return errors.length > 0 ? errors.join('; ') : null;
}
/* ================================================================== */
/*  knowledge.detail                                                   */
/* ================================================================== */
async function handleDetail(params, ctx) {
    const id = params.id;
    if (!id) {
        return fail('knowledge.detail requires id');
    }
    const repo = ctx.knowledgeRepo;
    if (!repo) {
        return fail('Knowledge repository not available');
    }
    try {
        const recipe = await repo.getById(id);
        if (!recipe) {
            return fail(`Recipe not found: ${id}`);
        }
        const text = JSON.stringify(recipe, null, 2);
        return ok(recipe, { tokensEstimate: estimateTokens(text) });
    }
    catch (err) {
        return fail(`Detail failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
const VALID_OPERATIONS = new Set([
    'approve',
    'reject',
    'publish',
    'deprecate',
    'update',
    'score',
    'validate',
    'evolve',
    'skip_evolution',
]);
const EVOLUTION_SOURCES = new Set([
    'ide-agent',
    'metabolism',
    'decay-scan',
    'consolidation',
    'relevance-audit',
    'file-change',
    'rescan-evolution',
]);
async function handleManage(params, ctx) {
    const operation = params.operation;
    const id = params.id;
    if (!operation || !VALID_OPERATIONS.has(operation)) {
        return fail(`Invalid operation: ${operation}. Valid: ${[...VALID_OPERATIONS].join(', ')}`);
    }
    if (!id) {
        return fail('knowledge.manage requires id');
    }
    const reason = stringValue(params.reason);
    const data = recordValue(params.data);
    if (operation === 'evolve' || operation === 'deprecate' || operation === 'skip_evolution') {
        return handleEvolutionManage(operation, id, reason, data, params, ctx);
    }
    const repo = ctx.knowledgeRepo;
    if (!repo) {
        return fail('Knowledge repository not available');
    }
    try {
        switch (operation) {
            case 'approve':
                await repo.approve(id, reason);
                return ok({ operation, id, status: 'approved' });
            case 'reject':
                await repo.reject(id, reason ?? 'Rejected by agent');
                return ok({ operation, id, status: 'rejected' });
            case 'publish':
                await repo.publish(id);
                return ok({ operation, id, status: 'published' });
            case 'update':
                if (!data) {
                    return fail('knowledge.manage(update) requires data');
                }
                await repo.update(id, data);
                return ok({ operation, id, status: 'updated' });
            case 'score': {
                const score = data?.score ?? 0;
                await repo.score(id, score);
                return ok({ operation, id, status: 'scored', score });
            }
            case 'validate': {
                const validation = await repo.validate(id);
                return ok({ operation, id, status: 'validated', result: validation });
            }
            default:
                return fail(`Unhandled operation: ${operation}`);
        }
    }
    catch (err) {
        return fail(`Manage(${operation}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function handleEvolutionManage(operation, id, reason, data, params, ctx) {
    const gateway = ctx.evolutionGateway;
    if (!gateway?.submit) {
        return fail('Evolution gateway not available');
    }
    const confidence = numberValue(data?.confidence) ??
        numberValue(params.confidence) ??
        (operation === 'deprecate' ? 0.7 : 0.9);
    const source = resolveEvolutionSource(ctx);
    const description = stringValue(data?.description) ??
        stringValue(params.description) ??
        reason ??
        defaultEvolutionDescription(operation);
    const evidence = buildEvolutionEvidence(data, params);
    const action = operation === 'evolve' ? 'update' : operation === 'deprecate' ? 'deprecate' : 'valid';
    try {
        const result = await gateway.submit({
            recipeId: id,
            action,
            source,
            confidence,
            description,
            evidence,
            reason,
            replacedByRecipeId: stringValue(data?.replacedByRecipeId) ??
                stringValue(params.replacedByRecipeId) ??
                stringValue(data?.supersedes) ??
                stringValue(params.supersedes),
        });
        if (result.outcome === 'error') {
            return fail(result.error || `Evolution ${operation} failed`);
        }
        return ok({
            operation,
            id,
            status: evolutionStatus(operation, result.outcome),
            outcome: result.outcome,
            proposalId: result.proposalId,
        });
    }
    catch (err) {
        return fail(`Manage(${operation}) failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function resolveEvolutionSource(ctx) {
    const raw = ctx.runtime?.sharedState?.evolutionProposalSource;
    return typeof raw === 'string' && EVOLUTION_SOURCES.has(raw)
        ? raw
        : 'ide-agent';
}
function defaultEvolutionDescription(operation) {
    if (operation === 'evolve') {
        return 'Evolution Agent proposed an update based on code verification';
    }
    if (operation === 'deprecate') {
        return 'Evolution Agent confirmed the recipe is outdated';
    }
    return 'Evolution Agent verified the recipe remains valid or needs no change';
}
function evolutionStatus(operation, outcome) {
    if (operation === 'skip_evolution') {
        return outcome === 'verified' ? 'evolution_verified' : 'evolution_skipped';
    }
    if (operation === 'deprecate') {
        return outcome === 'immediately-executed' ? 'deprecated' : 'deprecation_proposed';
    }
    return outcome === 'proposal-upgraded' ? 'evolution_proposal_upgraded' : 'evolution_proposed';
}
function buildEvolutionEvidence(data, params) {
    const records = [];
    const rawEvidence = data?.evidence ?? params.evidence;
    if (Array.isArray(rawEvidence)) {
        for (const item of rawEvidence) {
            const record = recordValue(item);
            if (record) {
                records.push(record);
            }
        }
    }
    else {
        const record = recordValue(rawEvidence);
        if (record) {
            records.push(record);
        }
    }
    const inline = collectInlineEvidence(data, params);
    if (Object.keys(inline).length > 0) {
        records.push(inline);
    }
    return records;
}
function collectInlineEvidence(data, params) {
    const record = {};
    for (const key of [
        'type',
        'sourceStatus',
        'currentCode',
        'newLocation',
        'suggestedChanges',
        'confidence',
    ]) {
        const value = data?.[key] ?? params[key];
        if (value !== undefined) {
            record[key] = value;
        }
    }
    return record;
}
function recordValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : undefined;
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function truncateText(text, maxLen) {
    if (text.length <= maxLen) {
        return text;
    }
    return `${text.slice(0, maxLen - 3)}...`;
}

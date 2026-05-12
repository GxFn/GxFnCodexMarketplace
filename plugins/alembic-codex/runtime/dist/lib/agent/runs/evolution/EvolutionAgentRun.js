export async function runEvolutionAudit({ agentService, recipes, projectOverview, dimensionId = 'all', dimensionLabel = '全量进化审计', proposalSource, }) {
    if (recipes.length === 0) {
        return { proposed: 0, deprecated: 0, skipped: 0, toolCalls: 0, iterations: 0, reply: '' };
    }
    const sharedState = {};
    if (proposalSource) {
        sharedState.evolutionProposalSource = proposalSource;
    }
    const strategyContext = {
        existingRecipes: recipes,
        dimensionId,
        dimensionLabel,
        projectOverview,
        sharedState,
    };
    const result = await agentService.run({
        profile: { id: 'evolution-audit' },
        params: { recipes, projectOverview, dimensionId, dimensionLabel },
        message: {
            role: 'internal',
            content: `请验证 ${recipes.length} 条 Recipe 的源码真实性并提交进化决策。`,
            metadata: { task: 'evolution-audit', dimensionId, dimensionLabel },
        },
        context: {
            source: 'system-workflow',
            runtimeSource: 'system',
            strategyContext,
        },
        presentation: { responseShape: 'system-task-result' },
    });
    const audit = projectEvolutionAuditResult({
        reply: result.reply,
        toolCalls: result.toolCalls,
        iterations: result.usage.iterations,
    });
    const decisionIds = collectEvolutionDecisionIds(result.toolCalls, recipes.map((r) => r.id));
    if (decisionIds.size < recipes.length) {
        const pending = recipes.map((r) => r.id).filter((id) => !decisionIds.has(id));
        throw new Error(`Evolution audit incomplete: decisions ${decisionIds.size}/${recipes.length}; pending=${pending.join(', ')}`);
    }
    return audit;
}
export function projectEvolutionAuditResult({ reply, toolCalls, iterations, }) {
    return {
        proposed: countProposalOutcomes(toolCalls),
        deprecated: countImmediateDeprecations(toolCalls),
        skipped: countManageOps(toolCalls, 'skip_evolution'),
        iterations,
        toolCalls: toolCalls.length,
        reply: reply || '',
    };
}
/** V2: knowledge.manage(operation: X, id) 统计；V1 compat: 独立工具名 fallback */
function countManageOps(toolCalls, operation) {
    let count = 0;
    for (const tc of toolCalls) {
        if (!isSuccessfulManageCall(tc)) {
            continue;
        }
        const tool = tc.tool || tc.name;
        if (tool === 'knowledge') {
            const action = tc.args?.action;
            const params = tc.args?.params || tc.args || {};
            const id = params.id || params.recipeId;
            if (action === 'manage' && id && params.operation === operation) {
                count++;
            }
        }
        // V1 compat
        const v1Map = {
            evolve: 'propose_evolution',
            deprecate: 'confirm_deprecation',
            skip_evolution: 'skip_evolution',
        };
        if (tool === v1Map[operation]) {
            count++;
        }
    }
    return count;
}
function isSuccessfulManageCall(tc) {
    if (tc.envelope?.ok === false) {
        return false;
    }
    const result = tc.result;
    if (result && typeof result === 'object' && typeof result.error === 'string') {
        return false;
    }
    return true;
}
function countProposalOutcomes(toolCalls) {
    let count = 0;
    for (const tc of toolCalls) {
        if (!isSuccessfulManageCall(tc) || !isKnowledgeManageCall(tc)) {
            continue;
        }
        const { status, outcome } = readEvolutionToolResult(tc);
        if (outcome) {
            if (outcome === 'proposal-created' || outcome === 'proposal-upgraded') {
                count++;
            }
            continue;
        }
        if (status === 'evolution_proposed' ||
            status === 'evolution_proposal_upgraded' ||
            status === 'deprecation_proposed') {
            count++;
        }
    }
    return count;
}
function countImmediateDeprecations(toolCalls) {
    let count = 0;
    for (const tc of toolCalls) {
        if (!isSuccessfulManageCall(tc) || !isKnowledgeManageCall(tc)) {
            continue;
        }
        const { status, outcome } = readEvolutionToolResult(tc);
        if (outcome) {
            if (outcome === 'immediately-executed') {
                count++;
            }
            continue;
        }
        if (status === 'deprecated') {
            count++;
        }
    }
    return count;
}
function isKnowledgeManageCall(tc) {
    const tool = tc.tool || tc.name;
    const args = tc.args || {};
    const params = args.params || args;
    const operation = params.operation;
    return (tool === 'knowledge' &&
        args.action === 'manage' &&
        (operation === 'evolve' || operation === 'deprecate' || operation === 'skip_evolution'));
}
function readEvolutionToolResult(tc) {
    const result = asRecord(tc.result);
    const data = asRecord(result?.data);
    const source = data || result || {};
    return {
        status: typeof source.status === 'string' ? source.status : '',
        outcome: typeof source.outcome === 'string' ? source.outcome : '',
    };
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : null;
}
export function collectEvolutionDecisionIds(toolCalls, expectedIds = []) {
    const ids = new Set();
    const expected = new Set(expectedIds);
    const mark = (id) => {
        if (typeof id !== 'string' || id.length === 0) {
            return;
        }
        if (expected.size > 0 && !expected.has(id)) {
            return;
        }
        ids.add(id);
    };
    for (const tc of toolCalls) {
        if (!isSuccessfulManageCall(tc)) {
            continue;
        }
        const tool = tc.tool || tc.name;
        const args = tc.args || {};
        if (tool === 'knowledge') {
            const action = args.action;
            const params = args.params || args;
            const operation = params.operation;
            const id = params.id || params.recipeId;
            if (action === 'manage' &&
                id &&
                (operation === 'evolve' || operation === 'deprecate' || operation === 'skip_evolution')) {
                mark(id);
            }
            const supersedes = args.supersedes || params.supersedes;
            if ((action === 'submit' || supersedes) && supersedes) {
                mark(supersedes);
            }
        }
        if (tool === 'propose_evolution' && args.recipeId) {
            mark(args.recipeId);
        }
        if (tool === 'confirm_deprecation' && args.recipeId) {
            mark(args.recipeId);
        }
        if (tool === 'skip_evolution' && args.recipeId) {
            mark(args.recipeId);
        }
    }
    return ids;
}

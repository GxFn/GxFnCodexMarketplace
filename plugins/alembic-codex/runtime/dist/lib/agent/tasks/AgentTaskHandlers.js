/**
 * AgentTaskHandlers — predefined task flows for /api/v1/ai/agent/task.
 *
 * These handlers are not chat runtime logic. They orchestrate direct ToolRouter
 * calls and, for relation discovery, delegate to AgentService.run().
 */
import { runRelationDiscovery } from '../service/index.js';
export async function taskCheckAndSubmit(context, { candidate, projectRoot }) {
    const { aiProvider } = context;
    const duplicates = await invokeTaskTool(context, 'check_duplicate', {
        candidate,
        projectRoot,
        threshold: 0.5,
    });
    const highSim = (duplicates.similar || []).filter((d) => d.similarity >= 0.7);
    let aiVerdict = null;
    if (highSim.length > 0 && aiProvider) {
        const verdictPrompt = `以下新候选代码与已有 Recipe 高度相似，请判断是否真正重复。

新候选:
- Title: ${candidate.title || '(未命名)'}
- Code: ${(candidate.code || '').substring(0, 1000)}

相似 Recipe:
${highSim.map((s) => `- ${s.title} (相似度: ${s.similarity})`).join('\n')}

请回答: DUPLICATE（真正重复）/ SIMILAR（相似但不同，建议保留并标注关系）/ UNIQUE（误判，可放心提交）
只回答一个词。`;
        try {
            const raw = await aiProvider.chat(verdictPrompt, { temperature: 0, maxTokens: 20 });
            aiVerdict = (raw || '').trim().toUpperCase().split(/\s/)[0];
        }
        catch {
            /* optional AI verdict */
        }
    }
    return {
        duplicates: duplicates.similar || [],
        highSimilarity: highSim,
        aiVerdict,
        recommendation: highSim.length === 0
            ? 'safe_to_submit'
            : aiVerdict === 'DUPLICATE'
                ? 'block_duplicate'
                : 'review_suggested',
    };
}
export async function taskDiscoverAllRelations(context, { batchSize = 20 } = {}) {
    const { container } = context;
    const agentService = container.get('agentService');
    const aiManager = container.singletons
        ?._aiProviderManager;
    if (aiManager?.isMock) {
        return { discovered: 0, message: 'AI Provider 未配置（Mock 模式），跳过关系发现。' };
    }
    return runRelationDiscovery({ agentService, batchSize });
}
export async function taskFullEnrich(context, { status = 'pending', maxCount = 50 } = {}) {
    const { container } = context;
    const knowledgeService = container.get('knowledgeService');
    const { items = [], data = [] } = await knowledgeService.list({ lifecycle: status }, { page: 1, pageSize: maxCount });
    const candidates = items.length > 0 ? items : data;
    if (candidates.length === 0) {
        return { enriched: 0, message: 'No candidates to enrich' };
    }
    const needEnrich = candidates.filter((candidate) => {
        const metadata = candidate.metadata || {};
        return !metadata.rationale || !metadata.knowledgeType || !metadata.complexity;
    });
    if (needEnrich.length === 0) {
        return { enriched: 0, message: 'All candidates already enriched' };
    }
    return invokeTaskTool(context, 'enrich_candidate', {
        candidateIds: needEnrich.map((candidate) => candidate.id).slice(0, 20),
    });
}
export async function taskQualityAudit(context, { threshold = 0.6, maxCount = 100 } = {}) {
    const { container } = context;
    const knowledgeService = container.get('knowledgeService');
    const { items = [], data = [] } = await knowledgeService.list({ lifecycle: 'active' }, { page: 1, pageSize: maxCount });
    const recipes = items.length > 0 ? items : data;
    if (recipes.length === 0) {
        return { total: 0, lowQuality: [], message: 'No active recipes' };
    }
    const lowQuality = [];
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const recipe of recipes) {
        const scoreResult = await invokeTaskTool(context, 'quality_score', { recipe });
        if (scoreResult.grade) {
            gradeDistribution[scoreResult.grade] =
                (gradeDistribution[scoreResult.grade] || 0) + 1;
        }
        if (scoreResult.score < threshold) {
            lowQuality.push({
                id: recipe.id,
                title: recipe.title,
                score: scoreResult.score,
                grade: scoreResult.grade,
                dimensions: scoreResult.dimensions,
            });
        }
    }
    lowQuality.sort((a, b) => a.score - b.score);
    return {
        total: recipes.length,
        threshold,
        gradeDistribution,
        lowQualityCount: lowQuality.length,
        lowQuality,
    };
}
export async function taskGuardFullScan(context, { code, language, filePath } = {}) {
    const { aiProvider } = context;
    if (!code) {
        return { error: 'code is required' };
    }
    const checkResult = await invokeTaskTool(context, 'guard_check_code', {
        code,
        language: language || 'unknown',
        scope: 'project',
    });
    let suggestions = null;
    if (checkResult.violationCount > 0 && aiProvider) {
        try {
            const violationSummary = (checkResult.violations || [])
                .slice(0, 5)
                .map((violation) => `- [${violation.severity}] ${violation.message || violation.ruleName} (line ${violation.line || violation.matches?.[0]?.line || '?'})`)
                .join('\n');
            const prompt = `以下代码存在 Guard 规则违规。请为每个违规提供修复建议。

违规列表:
${violationSummary}

代码片段:
\`\`\`${language || ''}
${code.substring(0, 3000)}
\`\`\`

请用 JSON 数组格式返回建议: [{"violation": "...", "suggestion": "...", "fixExample": "..."}]`;
            suggestions =
                (await aiProvider.chatWithStructuredOutput(prompt, {
                    openChar: '[',
                    closeChar: ']',
                    temperature: 0.3,
                })) || [];
        }
        catch {
            /* AI suggestions are optional */
        }
    }
    return {
        filePath: filePath || '(inline)',
        language,
        violationCount: checkResult.violationCount,
        violations: checkResult.violations,
        suggestions,
    };
}
async function invokeTaskTool(context, toolName, params) {
    return projectTaskToolEnvelope(await context.invokeToolEnvelope(toolName, params));
}
function projectTaskToolEnvelope(envelope) {
    if (envelope.structuredContent !== undefined) {
        return envelope.structuredContent;
    }
    return envelope.ok ? { success: true, message: envelope.text } : { error: envelope.text };
}

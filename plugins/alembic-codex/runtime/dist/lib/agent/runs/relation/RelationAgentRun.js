export async function runRelationDiscovery({ agentService, batchSize = 20, }) {
    const result = await agentService.run({
        profile: { id: 'relation-discovery' },
        params: { batchSize },
        message: {
            role: 'internal',
            content: `探索知识库中所有知识条目之间的语义关系。每批分析约 ${batchSize} 条知识。`,
            metadata: { task: 'relation-discovery', batchSize },
        },
        context: {
            source: 'system-workflow',
            runtimeSource: 'system',
        },
        presentation: { responseShape: 'system-task-result' },
    });
    return projectRelationDiscoveryResult(result);
}
export function projectRelationDiscoveryResult(result) {
    const phases = result.phases;
    const synthesizeReply = phases?.synthesize?.reply || result.reply;
    const parsed = parseJsonResponse(synthesizeReply, { analyzed: 0, relations: [] });
    return {
        analyzed: typeof parsed.analyzed === 'number' ? parsed.analyzed : 0,
        relations: Array.isArray(parsed.relations)
            ? parsed.relations
            : [],
        diagnostics: {
            toolCallCount: result.toolCalls.length,
            iterations: result.usage.iterations,
            durationMs: result.usage.durationMs,
            runtimeDiagnostics: result.diagnostics || null,
        },
    };
}
function parseJsonResponse(text, fallback) {
    if (!text) {
        return fallback;
    }
    try {
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            return JSON.parse(codeBlockMatch[1].trim());
        }
        const objMatch = text.match(/(\{[\s\S]*\})/);
        if (objMatch) {
            return JSON.parse(objMatch[1].trim());
        }
        return JSON.parse(text.trim());
    }
    catch {
        return fallback;
    }
}

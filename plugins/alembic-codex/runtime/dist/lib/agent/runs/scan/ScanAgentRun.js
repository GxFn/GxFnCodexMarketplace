import { SCAN_TASK_CONFIGS } from '../../prompts/scan-prompts.js';
import { projectScanRunResult } from './ScanRunProjection.js';
export async function runScanAgentTask({ agentService, systemRunContextFactory, label, files, task = 'extract', lang, comprehensive = false, source = 'system-workflow', onParseError, }) {
    const taskConfig = SCAN_TASK_CONFIGS[task];
    if (!taskConfig) {
        throw new Error(`Unknown scan task: "${task}". Available: ${Object.keys(SCAN_TASK_CONFIGS).join(', ')}`);
    }
    const runLabel = label || 'code';
    const fileCache = toScanFileCache(files);
    const analyzeMaxIter = task === 'summarize' ? 12 : 24;
    const systemCtx = systemRunContextFactory.createSystemContext({
        budget: { maxIterations: analyzeMaxIter },
        trackerStrategy: 'analyst',
        label: `${task}:${runLabel}`,
        lang: lang || undefined,
    });
    const runResult = await agentService.run({
        profile: { id: task === 'summarize' ? 'scan-summarize' : 'scan-extract' },
        params: { task, label: runLabel, comprehensive, files: fileCache },
        message: {
            role: 'internal',
            content: `分析 "${runLabel}" 的 ${fileCache?.length || 0} 个源文件。${comprehensive ? '请进行深度分析。' : ''}`,
            metadata: { label: runLabel, task },
        },
        context: {
            source,
            runtimeSource: 'system',
            lang: lang || null,
            fileCache,
            systemRunContext: systemCtx.systemRunContext,
            strategyContext: systemCtx,
            promptContext: { dimensionScopeId: systemCtx.scopeId },
        },
        presentation: { responseShape: 'system-task-result' },
    });
    return projectScanRunResult({
        label: runLabel,
        task,
        result: runResult,
        fallback: taskConfig.fallback,
        onParseError,
    });
}
export function toScanFileCache(files) {
    if (!files?.length) {
        return null;
    }
    return files.map((file, index) => {
        const name = file.name || file.relativePath || `file-${index + 1}`;
        return {
            relativePath: file.relativePath || name,
            name,
            content: file.content || '',
        };
    });
}

import { inferLang } from './LanguageExtensionBuilder.js';
import { inferFilePriority } from './TargetClassifier.js';
export function buildTargetFileMap(allFiles, contentMaxLines, sort = false) {
    const targetFileMap = {};
    for (const file of allFiles) {
        if (!targetFileMap[file.targetName]) {
            targetFileMap[file.targetName] = [];
        }
        const lines = file.content.split('\n');
        targetFileMap[file.targetName].push({
            name: file.name,
            relativePath: file.relativePath,
            language: inferLang(file.name),
            totalLines: lines.length,
            priority: inferFilePriority(file.name),
            content: lines.slice(0, contentMaxLines).join('\n'),
            truncated: lines.length > contentMaxLines,
        });
    }
    if (sort) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        for (const targetName of Object.keys(targetFileMap)) {
            targetFileMap[targetName].sort((left, right) => (priorityOrder[left.priority] ?? 1) - (priorityOrder[right.priority] ?? 1));
        }
    }
    return targetFileMap;
}

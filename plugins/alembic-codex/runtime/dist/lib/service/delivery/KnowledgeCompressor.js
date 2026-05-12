/** 从 rationale 提取首句（≤120 字符），用于 Channel B 的 Why 行 */
function _extractFirstSentence(rationale) {
    if (!rationale) {
        return '';
    }
    // 优先按句号或换行分割
    const first = rationale.split(/[.\n。！？!?]/)[0]?.trim();
    if (!first) {
        return '';
    }
    return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}
/** 骨架化 coreCode：去注释 + 截断 ≤ maxLines 行 */
function _skeletonize(code, maxLines = 15) {
    if (!code) {
        return '';
    }
    const lines = code
        .split('\n')
        // 去掉纯注释行（// 或 /* 或 * (JSDoc续行) 或 # 开头）
        .filter((l) => !/^\s*(\/\/|\/\*|\*\s|#\s)/.test(l))
        // 去掉空行连续超过 1 行
        .reduce((acc, line) => {
        if (line.trim() === '' && acc.length > 0 && acc[acc.length - 1].trim() === '') {
            return acc; // 跳过连续空行
        }
        acc.push(line);
        return acc;
    }, []);
    if (lines.length <= maxLines) {
        return lines.join('\n');
    }
    return `${lines.slice(0, maxLines).join('\n')}\n// ... (truncated)`;
}
export class KnowledgeCompressor {
    /**
     * Channel A — 一行式规则（含可选 language 前缀）
     *
     * 多语言项目中增加 [language] 前缀，帮助 Agent 判断规则适用性。
     * scope='universal' 或无 language 的规则不加前缀。
     *
     * @param entries KnowledgeEntry 数组 (kind='rule')
     */
    compressToRuleLine(entries) {
        return entries
            .filter((e) => e.doClause) // 无 doClause → 跳过，不猜
            .map((e) => {
            // 可选 language 前缀
            const langPrefix = e.language && e.scope !== 'universal' ? `[${e.language}] ` : '';
            const doText = e.doClause.replace(/\.+$/, ''); // 去尾 .
            let line = `${langPrefix}${doText}`;
            if (e.dontClause) {
                // AI 可能返回 "Don't ..." / "Do not ..." / "Never ..." 开头，去掉冗余前缀后统一为 "Do NOT"
                const stripped = e.dontClause
                    .replace(/^(Don't|Do not|Never)\s+/i, '')
                    .replace(/\.+$/, '');
                line += `. Do NOT ${stripped}`;
            }
            return `- ${line}.`;
        });
    }
    /**
     * Channel B — When/Do/Don't/Why + Template（骨架化）
     * @param entries KnowledgeEntry 数组 (kind='pattern')
     * @returns >}
     */
    compressToWhenDoDont(entries) {
        const seen = new Set();
        return entries
            .filter((e) => e.trigger && e.whenClause && e.doClause) // 缺任一 → 跳过
            .map((e) => {
            let trigger = e.trigger.startsWith('@') ? e.trigger : `@${e.trigger}`;
            // trigger 去重（AI 应保证唯一，但防御性检查）
            if (seen.has(trigger)) {
                let i = 2;
                while (seen.has(`${trigger}-${i}`)) {
                    i++;
                }
                trigger = `${trigger}-${i}`;
            }
            seen.add(trigger);
            // 提取 rationale 首句作 Why 行
            const contentObj = e.content;
            const rationale = contentObj?.rationale || '';
            const why = _extractFirstSentence(rationale);
            return {
                trigger,
                when: e.whenClause || '',
                do: e.doClause || '',
                dont: e.dontClause || '',
                why,
                template: _skeletonize(e.coreCode || ''),
            };
        });
    }
    /**
     * 将 When/Do/Don't/Why 结果格式化为 Markdown 字符串
     * @param compressed compressToWhenDoDont 输出
     * @param [language=''] 代码围栏语言标识
     */
    formatWhenDoDont(compressed, language = '') {
        const lang = language || '';
        return compressed
            .map((item) => {
            const lines = [`### ${item.trigger}`];
            lines.push(`- **When**: ${item.when}`);
            lines.push(`- **Do**: ${item.do}`);
            if (item.dont) {
                const stripped = item.dont.replace(/^(Don't|Do not|Never)\s+/i, '');
                lines.push(`- **Don't**: ${stripped}`);
            }
            if (item.why) {
                lines.push(`- **Why**: ${item.why}`);
            }
            if (item.template) {
                lines.push('');
                lines.push(`\`\`\`${lang}`);
                lines.push(item.template);
                lines.push('```');
            }
            return lines.join('\n');
        })
            .join('\n\n');
    }
    /**
     * Channel B — Fact 条目压缩为 "Know" 行
     *
     * fact 类型没有 trigger/whenClause/doClause 结构，
     * 采用 "Know: {title} — {description}" 的简洁格式，
     * 让 Agent 获取项目事实性知识（技术选型、架构决策等）。
     *
     * @param facts KnowledgeEntry 数组 (kind='fact')
     * @returns >}
     */
    compressToFactLines(facts) {
        return facts
            .filter((e) => e.title)
            .map((e) => {
            const contentObj = e.content;
            const summary = e.description || contentObj?.markdown || '';
            const shortSummary = summary.length > 150 ? `${summary.slice(0, 147)}...` : summary;
            return { title: e.title, summary: shortSummary };
        });
    }
    /**
     * 将 Fact 压缩结果格式化为 Markdown 字符串
     * @param factLines
     */
    formatFactLines(factLines) {
        if (factLines.length === 0) {
            return '';
        }
        const lines = ['', '## Context Facts', ''];
        for (const f of factLines) {
            if (f.summary) {
                lines.push(`- **${f.title}**: ${f.summary}`);
            }
            else {
                lines.push(`- **${f.title}**`);
            }
        }
        return lines.join('\n');
    }
}
export default KnowledgeCompressor;

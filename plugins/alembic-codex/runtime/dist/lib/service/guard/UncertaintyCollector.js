/**
 * UncertaintyCollector — Guard uncertain 三态收集器
 *
 * 当 Guard 各层检测遇到能力边界（AST 不可用、跨文件缺失、正则冲突等）时，
 * 收集 skip 原因并产出结构化的 uncertain 结果。
 *
 * 设计原则:
 *   - uncertain 不是"错误"，是"承认能力边界"
 *   - Guard 不调用 AI，uncertain 是确定性输出
 *   - 保持 <10ms 性能
 */
/* ────────────────────── Collector ────────────────────── */
export class UncertaintyCollector {
    #skippedChecks = [];
    #uncertainResults = [];
    #layerCounts = {
        regex: { total: 0, executed: 0, skipped: 0 },
        codeLevel: { total: 0, executed: 0, skipped: 0 },
        ast: { total: 0, executed: 0, skipped: 0 },
        crossFile: { total: 0, executed: 0, skipped: 0 },
    };
    /** 记录某个规则在某层被跳过 */
    recordSkip(layer, reason, detail, options = {}) {
        const impact = options.impact ?? this.#inferImpact(layer, reason);
        this.#skippedChecks.push({
            layer,
            ruleId: options.ruleId,
            reason,
            detail,
            impact,
        });
        const key = layer === 'code_level' ? 'codeLevel' : layer === 'cross_file' ? 'crossFile' : layer;
        this.#layerCounts[key].skipped++;
    }
    /** 追加一条 uncertain 结果 */
    addUncertain(ruleId, message, layer, reason, detail) {
        this.#uncertainResults.push({ ruleId, message, layer, reason, detail });
    }
    /** 记录各层的检查总数和执行数 */
    recordLayerStats(layer, total, executed) {
        const key = layer === 'code_level' ? 'codeLevel' : layer === 'cross_file' ? 'crossFile' : layer;
        this.#layerCounts[key].total += total;
        this.#layerCounts[key].executed += executed;
    }
    /** 生成能力报告 */
    buildReport() {
        const boundaries = this.#detectBoundaries();
        const totalChecks = this.#layerCounts.regex.total +
            this.#layerCounts.codeLevel.total +
            this.#layerCounts.ast.total +
            this.#layerCounts.crossFile.total;
        const executedChecks = this.#layerCounts.regex.executed +
            this.#layerCounts.codeLevel.executed +
            this.#layerCounts.ast.executed +
            this.#layerCounts.crossFile.executed;
        const checkCoverage = totalChecks > 0 ? Math.round((executedChecks / totalChecks) * 100) : 100;
        return {
            executedChecks: { ...this.#layerCounts },
            skippedChecks: [...this.#skippedChecks],
            boundaries,
            uncertainResults: [...this.#uncertainResults],
            checkCoverage,
        };
    }
    /** 获取 uncertain 结果数量 */
    get uncertainCount() {
        return this.#uncertainResults.length;
    }
    /** 获取 skipped 总数 */
    get skippedCount() {
        return this.#skippedChecks.length;
    }
    /** 重置状态（供多文件审计复用） */
    reset() {
        this.#skippedChecks = [];
        this.#uncertainResults = [];
        this.#layerCounts = {
            regex: { total: 0, executed: 0, skipped: 0 },
            codeLevel: { total: 0, executed: 0, skipped: 0 },
            ast: { total: 0, executed: 0, skipped: 0 },
            crossFile: { total: 0, executed: 0, skipped: 0 },
        };
    }
    /* ── 内部 ── */
    #inferImpact(layer, reason) {
        // AST 和跨文件中的结构化检查更重要
        if (layer === 'ast' && reason === 'ast_unavailable') {
            return 'high';
        }
        if (layer === 'cross_file' && reason === 'file_missing') {
            return 'medium';
        }
        if (reason === 'invalid_regex') {
            return 'medium';
        }
        if (reason === 'layer_conflict') {
            return 'high';
        }
        return 'low';
    }
    #detectBoundaries() {
        const boundaries = [];
        // 按层+原因分组
        const groups = new Map();
        for (const skip of this.#skippedChecks) {
            const key = `${skip.layer}:${skip.reason}`;
            const list = groups.get(key) || [];
            list.push(skip);
            groups.set(key, list);
        }
        for (const [key, skips] of groups) {
            const [layer, reason] = key.split(':');
            const affectedRules = [...new Set(skips.map((s) => s.ruleId).filter(Boolean))];
            if (reason === 'ast_unavailable') {
                boundaries.push({
                    type: 'ast_language_gap',
                    description: `AST 检查因 tree-sitter 不可用被跳过 (${skips.length} 条规则)`,
                    affectedRules,
                    suggestedAction: '确认 tree-sitter 支持该语言，或降级为正则匹配',
                });
            }
            else if (reason === 'file_missing' && layer === 'cross_file') {
                boundaries.push({
                    type: 'cross_file_incomplete',
                    description: `跨文件检查因文件缺失被跳过 (${skips.length} 次)`,
                    affectedRules,
                    suggestedAction: '确保审计时传入完整文件列表',
                });
            }
            else if (reason === 'invalid_regex') {
                boundaries.push({
                    type: 'rule_regex_invalid',
                    description: `${skips.length} 条规则的正则表达式编译失败`,
                    affectedRules,
                    suggestedAction: '修复或替换无效的正则表达式',
                });
            }
            else if (reason === 'layer_conflict') {
                boundaries.push({
                    type: 'scope_unchecked',
                    description: `${skips.length} 个检查结果因层间冲突存疑`,
                    affectedRules,
                    suggestedAction: '人工审核冲突规则',
                });
            }
        }
        return boundaries;
    }
}

/**
 * AiScanService — `alembic ais [Target]` 的核心逻辑
 *
 * 按文件粒度扫描 Target 源码，通过 AgentService.run(scan-extract) 提取 Recipe，
 * 创建后自动发布（PENDING → ACTIVE），无需 Dashboard 人工审核。
 *
 * Agent(LLM) 直接分析代码 + 使用 AST 工具，输出 Recipe 结构化 JSON。
 * 本服务可脱离 MCP 独立在 CLI 运行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runScanAgentTask, } from '../agent/service/index.js';
import Logger from '../infrastructure/logging/Logger.js';
import { LanguageService } from '../shared/LanguageService.js';
export class AiScanService {
    agentService;
    systemRunContextFactory;
    container;
    logger;
    projectRoot;
    /**
     * @param opts.container ServiceContainer 实例
     * @param opts.projectRoot 项目根目录
     */
    constructor({ container, projectRoot, }) {
        this.container = container;
        this.projectRoot = projectRoot;
        this.logger = Logger.getInstance();
        this.agentService = null;
        this.systemRunContextFactory = null;
    }
    /**
     * 扫描指定 Target（或全部 Target）的源文件并提取 Recipe，创建后直接发布
     * @param targetName Target 名称；null 时扫描全部
     * @param opts { maxFiles, dryRun, concurrency }
     * @returns >}
     */
    async scan(targetName, opts = {}) {
        const { maxFiles = 200, dryRun = false } = opts;
        const report = { published: 0, files: 0, errors: [], skipped: 0 };
        // 1. 初始化 AgentService (统一 AgentRuntime 入口)
        try {
            this.agentService = this.container.get('agentService');
            this.systemRunContextFactory = this.container.get('systemRunContextFactory');
            // 通过 AiProviderManager 统一检查 AI 可用性
            const manager = this.container.singletons?._aiProviderManager;
            if (manager.isMock) {
                throw new Error('AI Provider 为 mock 模式');
            }
        }
        catch (err) {
            throw new Error(`AI Provider 不可用: ${err.message}\n请在 Alembic Dashboard 的 AI Settings 中配置 API Key`);
        }
        // 2. 收集源文件
        const files = await this._collectFiles(targetName, maxFiles);
        if (files.length === 0) {
            report.errors.push(targetName ? `Target "${targetName}" 未找到或无源文件` : '未找到任何 SPM Target 源文件');
            return report;
        }
        report.files = files.length;
        const knowledgeService = this.container.get('knowledgeService');
        // 3. 按文件调用 AI 提取 (通过 Agent 统一管道)
        for (const file of files) {
            try {
                const content = fs.readFileSync(file.path, 'utf8');
                const lines = content.split('\n').length;
                // 跳过过小的文件（< 10 行）
                if (lines < 10) {
                    report.skipped++;
                    continue;
                }
                // 截断过大的文件（> 500 行只取前 500 行）
                const truncated = lines > 500
                    ? `${content.split('\n').slice(0, 500).join('\n')}\n// ... (truncated)`
                    : content;
                // 委托统一 AgentService.run(scan-extract) — Agent(LLM) 直接分析
                const extractResult = await runScanAgentTask({
                    agentService: this.agentService,
                    systemRunContextFactory: this.systemRunContextFactory,
                    label: file.targetName,
                    files: [{ name: file.name, relativePath: file.relativePath, content: truncated }],
                    task: 'extract',
                });
                const recipes = extractResult.recipes || [];
                if (!Array.isArray(recipes) || recipes.length === 0) {
                    report.skipped++;
                    continue;
                }
                // 4. 创建并发布 Recipe
                // Agent 已完成: 代码分析 + Recipe JSON 输出
                // 此处仅补充 AiScanService 专属元数据
                for (const recipe of recipes) {
                    if (!recipe.content?.pattern || recipe.content.pattern.length < 20) {
                        continue;
                    }
                    if (dryRun) {
                        report.published++;
                        continue;
                    }
                    try {
                        // AiScanService 专属标记
                        recipe.source = 'ai-scan';
                        recipe.tags = [...new Set([...(recipe.tags || []), 'ai-scan', file.targetName])];
                        recipe.moduleName = file.targetName;
                        // 注意：不设置 sourceFile，由 KnowledgeFileWriter 持久化时自动设置为 md 文件路径
                        if (!recipe.aiInsight && recipe.description) {
                            recipe.aiInsight = recipe.description;
                        }
                        const saved = await knowledgeService.create(recipe, { userId: 'ai-scan' });
                        // 直接发布：PENDING → ACTIVE
                        await knowledgeService.publish(saved.id, { userId: 'ai-scan' });
                        report.published++;
                    }
                    catch (err) {
                        report.errors.push(`${file.name}: recipe publish failed — ${err.message}`);
                    }
                }
            }
            catch (err) {
                report.errors.push(`${file.name}: ${err.message}`);
            }
        }
        return report;
    }
    /** 收集 Target 源文件 */
    async _collectFiles(targetName, maxFiles) {
        const files = [];
        try {
            // 使用 ModuleService（多语言统一入口）
            let service;
            try {
                const { ModuleService } = await import('../service/module/ModuleService.js');
                service = new ModuleService(this.projectRoot);
            }
            catch (e) {
                this.logger.warn(`[AiScanService] ModuleService 加载失败: ${e.message}`);
                return files;
            }
            await service.load();
            const targets = await service.listTargets();
            const filtered = targetName
                ? targets.filter((t) => {
                    const name = typeof t === 'string' ? t : String(t.name ?? '');
                    return name === targetName || name.toLowerCase() === targetName.toLowerCase();
                })
                : targets;
            if (filtered.length === 0 && targetName) {
                return files;
            }
            const seenPaths = new Set();
            for (const t of filtered) {
                const tName = typeof t === 'string' ? t : String(t.name ?? '');
                try {
                    const fileList = await service.getTargetFiles(t);
                    for (const f of fileList) {
                        const fp = (typeof f === 'string' ? f : f.path);
                        if (seenPaths.has(fp)) {
                            continue;
                        }
                        seenPaths.add(fp);
                        files.push({
                            name: f.name || path.basename(fp),
                            path: fp,
                            relativePath: f.relativePath || path.basename(fp),
                            targetName: tName,
                        });
                        if (files.length >= maxFiles) {
                            break;
                        }
                    }
                }
                catch {
                    /* skip target */
                }
                if (files.length >= maxFiles) {
                    break;
                }
            }
        }
        catch (err) {
            this.logger.warn(`SPM file collection failed: ${err.message}, falling back to directory scan`);
            // Fallback: 直接扫描目录
            const srcDirs = ['Sources', 'src', 'lib'];
            for (const dir of srcDirs) {
                const dirPath = path.join(this.projectRoot, dir);
                if (fs.existsSync(dirPath)) {
                    this._walkDir(dirPath, files, maxFiles, dir);
                }
            }
        }
        return files;
    }
    /** 递归扫描目录（fallback） */
    _walkDir(dir, files, maxFiles, targetName) {
        if (files.length >= maxFiles) {
            return;
        }
        const sourceExts = LanguageService.sourceExts;
        const skipDirs = LanguageService.scanSkipDirs;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (files.length >= maxFiles) {
                return;
            }
            if (entry.name.startsWith('.')) {
                continue;
            }
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (skipDirs.has(entry.name)) {
                    continue;
                }
                this._walkDir(fullPath, files, maxFiles, targetName);
            }
            else if (sourceExts.has(path.extname(entry.name).toLowerCase())) {
                files.push({
                    name: entry.name,
                    path: fullPath,
                    relativePath: path.relative(this.projectRoot, fullPath),
                    targetName,
                });
            }
        }
    }
    /** 从文件名推断语言 */
    _inferLanguage(filename) {
        return LanguageService.inferLang(filename);
    }
}
export default AiScanService;

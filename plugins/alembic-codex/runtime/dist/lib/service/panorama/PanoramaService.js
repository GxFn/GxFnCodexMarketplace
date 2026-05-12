/**
 * PanoramaService — 全景服务主入口
 *
 * 提供 4 个 operation:
 *   overview — 项目骨架 + 层级 + token 预算截断
 *   module   — 单模块详情 + Recipe 覆盖率
 *   gaps     — 知识空白区 (有代码无 Recipe)
 *   health   — 全景健康度 (覆盖率 + 耦合度 + 衰退)
 *
 * 模块发现委托给 ModuleDiscoverer（SRP）。
 * 内存缓存 + 24h 过期策略。
 *
 * @module PanoramaService
 */
import { COUNTABLE_LIFECYCLES } from '../../domain/knowledge/Lifecycle.js';
/* ═══ Constants ═══════════════════════════════════════════ */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h
/* ═══ PanoramaService Class ═══════════════════════════════ */
export class PanoramaService {
    #aggregator;
    #edgeRepo;
    #knowledgeRepo;
    #projectRoot;
    #scanner;
    #moduleDiscoverer;
    #signalBus;
    #cache = null;
    #scanPromise = null;
    #lastOverview = null;
    constructor(opts) {
        this.#aggregator = opts.aggregator;
        this.#edgeRepo = opts.edgeRepo;
        this.#knowledgeRepo = opts.knowledgeRepo;
        this.#projectRoot = opts.projectRoot;
        this.#scanner = opts.scanner ?? null;
        this.#moduleDiscoverer =
            opts.moduleDiscoverer ??
                (() => {
                    throw new Error('moduleDiscoverer is required');
                })();
        this.#signalBus = opts.signalBus ?? null;
        // Phase 2: 订阅信号标记缓存失效
        if (this.#signalBus) {
            this.#signalBus.subscribe('guard|lifecycle|usage', () => {
                this.#cache = null;
            });
        }
    }
    /* ─── Public API ────────────────────────────────── */
    /**
     * 获取项目全景概览
     */
    async getOverview() {
        const result = await this.#getOrCompute();
        const isStale = Date.now() - result.computedAt > STALE_THRESHOLD_MS;
        let totalFiles = 0;
        for (const [, mod] of result.modules) {
            totalFiles += mod.fileCount;
        }
        // 使用项目级 recipe 总数，而非 per-module 之和
        // 因为大多数 recipe scope 为 universal，无法匹配到具体模块
        const totalRecipes = result.projectRecipeCount;
        const overview = {
            projectRoot: this.#projectRoot,
            moduleCount: result.modules.size,
            layerCount: result.layers.levels.length,
            totalFiles,
            totalRecipes,
            overallCoverage: totalFiles > 0 ? totalRecipes / totalFiles : 0,
            layers: result.layers.levels.map((l) => ({
                level: l.level,
                name: l.name,
                modules: l.modules.map((mName) => {
                    const mod = result.modules.get(mName);
                    return {
                        name: mName,
                        role: mod?.refinedRole ?? 'feature',
                        fileCount: mod?.fileCount ?? 0,
                        recipeCount: mod?.recipeCount ?? 0,
                    };
                }),
            })),
            cycleCount: result.cycles.length,
            gapCount: result.gaps.length,
            healthRadar: result.healthRadar,
            computedAt: result.computedAt,
            stale: isStale,
        };
        // Phase 3: 发射 panorama 信号 — 覆盖率/健康度变化检测
        if (this.#signalBus && this.#lastOverview) {
            if (Math.abs(overview.overallCoverage - this.#lastOverview.overallCoverage) >= 0.05) {
                this.#signalBus.send('panorama', 'PanoramaService.coverage', overview.overallCoverage, {
                    metadata: {
                        oldCoverage: this.#lastOverview.overallCoverage,
                        newCoverage: overview.overallCoverage,
                    },
                });
            }
        }
        this.#lastOverview = overview;
        return overview;
    }
    /**
     * 获取单模块详情 (enriched with file groups, recipes, and summary)
     */
    async getModule(moduleName) {
        const result = await this.#getOrCompute();
        const mod = result.modules.get(moduleName);
        if (!mod) {
            return null;
        }
        // Layer name: derive from module's own refinedRole (more accurate than level vote)
        const layerName = PanoramaService.#roleToLayer(mod.refinedRole || mod.inferredRole);
        // File groups: group by immediate subdirectory within the module
        const fileGroups = PanoramaService.#groupFilesBySubdir(mod.files);
        // Matched recipes from DB
        const recipes = await this.#findModuleRecipes(moduleName, mod);
        // Uncovered file count estimate
        const coveredFileCount = Math.min(recipes.length * 2, mod.fileCount); // rough heuristic
        const uncoveredFileCount = Math.max(0, mod.fileCount - coveredFileCount);
        // Neighbors from edge repo
        const neighbors = [];
        const outEdges = await this.#edgeRepo.findOutgoingByRelation(moduleName, 'depends_on');
        const seenOut = new Set();
        for (const e of outEdges) {
            if (!seenOut.has(e.toId)) {
                seenOut.add(e.toId);
                neighbors.push({ name: e.toId, direction: 'out', weight: e.weight });
            }
        }
        const inEdges = await this.#edgeRepo.findIncomingByRelation(moduleName, 'depends_on');
        const seenIn = new Set();
        for (const e of inEdges) {
            if (!seenIn.has(e.fromId)) {
                seenIn.add(e.fromId);
                neighbors.push({ name: e.fromId, direction: 'in', weight: e.weight });
            }
        }
        // Generate summary
        const summary = PanoramaService.#generateModuleSummary(mod, layerName, fileGroups, recipes, neighbors);
        return { module: mod, layerName, neighbors, fileGroups, recipes, uncoveredFileCount, summary };
    }
    /* ─── Module detail helpers ─────────────────────── */
    /** Role → layer name mapping (consistent with PanoramaAggregator) */
    static #roleToLayer(role) {
        const map = {
            core: 'Foundation',
            foundation: 'Foundation',
            model: 'Model',
            service: 'Service',
            networking: 'Infrastructure',
            storage: 'Infrastructure',
            ui: 'UI',
            feature: 'Feature',
            config: 'Configuration',
            test: 'Test',
            app: 'Application',
        };
        return map[role] ?? 'Feature';
    }
    /** Group file paths by their immediate subdirectory within the module */
    static #groupFilesBySubdir(files) {
        if (files.length === 0) {
            return [];
        }
        // Find common prefix to determine module root
        const prefix = PanoramaService.#commonPathPrefix(files);
        const groups = new Map();
        for (const f of files) {
            const relative = f.slice(prefix.length);
            const firstSlash = relative.indexOf('/');
            const group = firstSlash > 0 ? relative.slice(0, firstSlash) : '(root)';
            if (!groups.has(group)) {
                groups.set(group, []);
            }
            groups.get(group).push(f);
        }
        return [...groups.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .map(([group, groupFiles]) => ({ group, files: groupFiles, count: groupFiles.length }));
    }
    static #commonPathPrefix(paths) {
        if (paths.length === 0) {
            return '';
        }
        let prefix = paths[0];
        for (const p of paths) {
            while (!p.startsWith(prefix)) {
                // Strip trailing slash before searching for last separator
                const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
                const lastSlash = trimmed.lastIndexOf('/');
                if (lastSlash < 0) {
                    return '';
                }
                prefix = trimmed.slice(0, lastSlash + 1);
            }
        }
        return prefix;
    }
    /** Find recipes related to this module by category, trigger, or title match */
    async #findModuleRecipes(moduleName, mod) {
        try {
            // Map refined role to typical recipe categories
            const roleCategories = {
                networking: ['Network', 'API', 'Http'],
                storage: ['Storage', 'Database', 'Cache'],
                ui: ['UI', 'View', 'Component'],
                service: ['Service', 'Manager'],
                model: ['Model', 'Entity'],
                core: ['Core', 'Foundation', 'Utility'],
                foundation: ['Core', 'Foundation', 'Utility'],
                feature: ['Feature'],
            };
            const categories = roleCategories[mod.refinedRole] ?? [];
            return await this.#knowledgeRepo.findModuleRecipes(COUNTABLE_LIFECYCLES, moduleName, categories, 20);
        }
        catch {
            return [];
        }
    }
    /** Generate a structural summary for the agent */
    static #generateModuleSummary(mod, layerName, fileGroups, recipes, neighbors) {
        const lines = [];
        // Identity
        lines.push(`${mod.name} is a ${layerName} layer module (role: ${mod.refinedRole}, confidence: ${(mod.roleConfidence * 100).toFixed(0)}%).`);
        // Structure
        const groupDesc = fileGroups.map((g) => `${g.group}(${g.count})`).join(', ');
        lines.push(`Contains ${mod.fileCount} files in ${fileGroups.length} groups: ${groupDesc}.`);
        // Dependencies
        const dependsOn = neighbors.filter((n) => n.direction === 'out').map((n) => n.name);
        const usedBy = neighbors.filter((n) => n.direction === 'in').map((n) => n.name);
        if (dependsOn.length > 0) {
            lines.push(`Depends on: ${dependsOn.join(', ')}.`);
        }
        if (usedBy.length > 0) {
            lines.push(`Used by: ${usedBy.join(', ')}.`);
        }
        if (dependsOn.length === 0 && usedBy.length === 0) {
            lines.push('No dependency edges recorded (consider running a full bootstrap scan).');
        }
        // Knowledge coverage
        lines.push(`Knowledge coverage: ${recipes.length} recipes matched, ${(mod.coverageRatio * 100).toFixed(0)}% estimated coverage.`);
        if (recipes.length > 0) {
            const recipeList = recipes
                .slice(0, 5)
                .map((r) => r.title)
                .join('; ');
            lines.push(`Key recipes: ${recipeList}.`);
        }
        if (mod.coverageRatio < 0.5) {
            lines.push('Coverage is below 50% — consider submitting knowledge for uncovered file groups.');
        }
        return lines.join(' ');
    }
    /**
     * 获取知识空白区
     */
    async getGaps() {
        const result = await this.#getOrCompute();
        return result.gaps;
    }
    /**
     * 获取全景健康度
     */
    async getHealth() {
        const result = await this.#getOrCompute();
        let totalCoupling = 0;
        let count = 0;
        for (const [, mod] of result.modules) {
            totalCoupling += mod.fanIn + mod.fanOut;
            count++;
        }
        const avgCoupling = count > 0 ? totalCoupling / count : 0;
        const highPriorityGaps = result.gaps.filter((g) => g.priority === 'high').length;
        const radar = result.healthRadar;
        // 健康分: 100 分制 (基于维度覆盖率 + 结构健康)
        // 维度覆盖 60 分 + 无循环 20 分 + 无高优空白 10 分 + 耦合度适中 10 分
        let healthScore = radar.overallScore * 0.6;
        healthScore += result.cycles.length === 0 ? 20 : Math.max(0, 20 - result.cycles.length * 5);
        healthScore += highPriorityGaps === 0 ? 10 : Math.max(0, 10 - highPriorityGaps * 2);
        healthScore += avgCoupling < 10 ? 10 : Math.max(0, 10 - (avgCoupling - 10));
        healthScore = Math.round(Math.max(0, Math.min(100, healthScore)));
        return {
            healthRadar: radar,
            avgCoupling,
            cycleCount: result.cycles.length,
            gapCount: result.gaps.length,
            highPriorityGaps,
            moduleCount: count,
            healthScore,
        };
    }
    /**
     * 获取完整 PanoramaResult（内部使用或 Bootstrap 注入）
     */
    async getResult() {
        return await this.#getOrCompute();
    }
    /**
     * 确保全景数据已就绪（无数据时自动扫描）
     * MCP handler / HTTP route 应在返回数据前调用此方法
     */
    async ensureData() {
        if (!this.#scanner) {
            return;
        }
        if (!this.#scanPromise) {
            this.#scanPromise = this.#scanner.ensureData().then((scanResult) => {
                if (scanResult) {
                    this.#cache = null; // 扫描后清除缓存以触发重新计算
                }
            });
        }
        await this.#scanPromise;
    }
    /**
     * 强制刷新缓存
     */
    invalidate() {
        this.#cache = null;
        this.#scanPromise = null;
    }
    /**
     * 强制重新扫描（invalidate + 重置 scanner）
     */
    async rescan() {
        this.invalidate();
        if (this.#scanner) {
            this.#scanner.reset();
            await this.ensureData();
        }
    }
    /* ─── Cache + Compute ───────────────────────────── */
    async #getOrCompute() {
        if (this.#cache) {
            return this.#cache;
        }
        const candidates = await this.#moduleDiscoverer.discover();
        const configLayers = await this.#moduleDiscoverer.readConfigLayers();
        this.#cache = await this.#aggregator.compute(candidates, { configLayers });
        return this.#cache;
    }
}

/**
 * ProjectSnapshot Builder — 从 runAllPhases() 的松散返回值构建类型化快照
 *
 * 职责：
 *   1. 类型归一化（unknown → typed interfaces）
 *   2. 默认值填充
 *   3. 不可变冻结（Object.freeze）
 *
 * @module types/project-snapshot-builder
 */
const SNAPSHOT_VERSION = '1.0.0';
/**
 * 从 runAllPhases() 的松散返回值构建类型化的 ProjectSnapshot。
 *
 * @param input runAllPhases() 返回值 + 额外的上下文信息
 * @returns 不可变的 ProjectSnapshot 对象
 */
export function buildProjectSnapshot(input) {
    const primaryLang = typeof input.primaryLang === 'string' ? input.primaryLang : 'unknown';
    const langStats = input.langStats && typeof input.langStats === 'object' ? input.langStats : {};
    const language = {
        primaryLang,
        stats: langStats,
        secondary: input.langProfile?.secondary,
        isMultiLang: input.langProfile?.isMultiLang,
    };
    const snapshot = {
        version: SNAPSHOT_VERSION,
        timestamp: Date.now(),
        projectRoot: input.projectRoot,
        sourceTag: input.sourceTag,
        // Phase 1
        allFiles: normalizeFiles(input.allFiles),
        allTargets: normalizeTargets(input.allTargets),
        discoverer: normalizeDiscoverer(input.discoverer),
        truncated: input.truncated ?? false,
        // Phase 1.5
        language,
        ast: normalizeAst(input.astProjectSummary),
        astContext: typeof input.astContext === 'string' ? input.astContext : null,
        // Phase 1.6-1.7
        codeEntityGraph: normalizeCodeEntity(input.codeEntityResult),
        callGraph: normalizeCallGraph(input.callGraphResult),
        // Phase 1.8
        panorama: normalizePanorama(input.panoramaResult),
        // Phase 2
        dependencyGraph: normalizeDepGraph(input.depGraphData),
        depEdgesWritten: typeof input.depEdgesWritten === 'number' ? input.depEdgesWritten : 0,
        // Phase 3
        guardAudit: normalizeGuardAudit(input.guardAudit),
        // Phase 4
        activeDimensions: normalizeDimensions(input.activeDimensions),
        enhancementPackInfo: normalizeEnhancementPackInfo(input.enhancementPackInfo),
        enhancementPatterns: Array.isArray(input.enhancementPatterns)
            ? input.enhancementPatterns
            : [],
        enhancementGuardRules: Array.isArray(input.enhancementGuardRules)
            ? input.enhancementGuardRules
            : [],
        detectedFrameworks: Array.isArray(input.detectedFrameworks) ? input.detectedFrameworks : [],
        // Language profile & Targets summary
        langProfile: language,
        targetsSummary: normalizeTargets(input.targetsSummary || input.allTargets),
        localPackageModules: normalizeLocalPackageModules(input.localPackageModules),
        // Report
        phaseReport: normalizePhaseReport(input.report),
        warnings: Array.isArray(input.warnings) ? input.warnings : [],
        // Incremental
        incrementalPlan: normalizeIncrementalPlan(input.incrementalPlan),
        // Empty
        isEmpty: input.isEmpty ?? false,
    };
    return Object.freeze(snapshot);
}
// ── Normalize 函数 ──────────────────────────────────────────
function normalizeFiles(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map((f) => ({
        name: String(f.name || ''),
        path: String(f.path || ''),
        relativePath: String(f.relativePath || ''),
        content: String(f.content || ''),
        targetName: String(f.targetName || ''),
        language: f.language != null ? String(f.language) : undefined,
        totalLines: typeof f.totalLines === 'number' ? f.totalLines : undefined,
        priority: f.priority != null ? String(f.priority) : undefined,
        truncated: typeof f.truncated === 'boolean' ? f.truncated : undefined,
    }));
}
function normalizeTargets(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map((t) => {
        if (typeof t === 'string') {
            return { name: t };
        }
        const obj = t;
        return {
            name: String(obj.name || ''),
            type: obj.type != null ? String(obj.type) : undefined,
            framework: obj.framework != null ? String(obj.framework) : undefined,
            packageName: obj.packageName != null ? String(obj.packageName) : undefined,
            inferredRole: obj.inferredRole != null ? String(obj.inferredRole) : undefined,
            fileCount: typeof obj.fileCount === 'number' ? obj.fileCount : undefined,
            isLocalPackage: typeof obj.isLocalPackage === 'boolean' ? obj.isLocalPackage : undefined,
        };
    });
}
function normalizeDiscoverer(raw) {
    if (raw && typeof raw === 'object') {
        const obj = raw;
        return {
            id: String(obj.id || 'unknown'),
            displayName: String(obj.displayName || 'Unknown'),
        };
    }
    return { id: 'unknown', displayName: 'Unknown' };
}
function normalizeAst(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    // Pass through — the shapes from analyzeProject() already match AstSummary
    return raw;
}
function normalizeCodeEntity(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeCallGraph(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizePanorama(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeDepGraph(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeGuardAudit(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeDimensions(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw;
}
function normalizeEnhancementPackInfo(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw;
}
function normalizePhaseReport(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeIncrementalPlan(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    return raw;
}
function normalizeLocalPackageModules(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw;
}

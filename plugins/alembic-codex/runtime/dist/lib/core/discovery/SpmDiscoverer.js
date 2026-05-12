/**
 * @module SpmDiscoverer
 * @description SPM 项目发现器，适配 ProjectDiscoverer 接口
 *
 * 内置 Package.swift 正则解析，提供模块列表和文件遍历。
 *
 * 检测: 项目根或子目录存在 Package.swift
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { LanguageService } from '#shared/LanguageService.js';
import { ProjectDiscoverer } from './ProjectDiscoverer.js';
const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'Build',
    '.build',
    '.swiftpm',
    'Pods',
    'DerivedData',
    'Carthage',
    '.cursor',
]);
export class SpmDiscoverer extends ProjectDiscoverer {
    #projectRoot = null;
    #parsedPackages = [];
    get id() {
        return 'spm';
    }
    get displayName() {
        return 'Swift Package Manager (SPM)';
    }
    async detect(projectRoot) {
        const hasRoot = existsSync(join(projectRoot, 'Package.swift'));
        if (hasRoot) {
            return { match: true, confidence: 0.95, reason: 'Package.swift found at project root' };
        }
        try {
            const entries = readdirSync(projectRoot, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    if (existsSync(join(projectRoot, entry.name, 'Package.swift'))) {
                        return {
                            match: true,
                            confidence: 0.85,
                            reason: `Package.swift found in ${entry.name}/`,
                        };
                    }
                }
            }
        }
        catch {
            /* ignore */
        }
        return { match: false, confidence: 0, reason: 'No Package.swift found' };
    }
    async load(projectRoot) {
        this.#projectRoot = projectRoot;
        this.#parsedPackages = [];
        const allPaths = this.#findAllPackageSwifts(projectRoot);
        for (const pkgPath of allPaths) {
            try {
                const parsed = this.#parsePackageSwift(pkgPath);
                if (parsed) {
                    this.#parsedPackages.push({ pkgPath, parsed });
                }
            }
            catch {
                // 解析失败，跳过
            }
        }
    }
    async listTargets() {
        const targets = [];
        for (const { pkgPath, parsed } of this.#parsedPackages) {
            const pkgDir = dirname(pkgPath);
            for (const t of parsed.targets || []) {
                targets.push({
                    name: t.name,
                    path: pkgDir,
                    type: t.type || 'library',
                    language: 'swift',
                    metadata: {
                        ...t,
                        packageName: parsed.name,
                        packagePath: pkgPath,
                        targetDir: pkgDir,
                    },
                });
            }
        }
        return targets;
    }
    async getTargetFiles(target) {
        const targetName = typeof target === 'string' ? target : target.name;
        let sourcesDir = null;
        for (const { pkgPath, parsed } of this.#parsedPackages) {
            const matchTarget = parsed.targets?.find((t) => t.name === targetName);
            if (matchTarget) {
                const pkgDir = dirname(pkgPath);
                const candidates = [];
                if (matchTarget.path) {
                    candidates.push(join(pkgDir, matchTarget.path));
                }
                candidates.push(join(pkgDir, 'Sources', targetName));
                candidates.push(join(pkgDir, targetName));
                for (const dir of candidates) {
                    if (existsSync(dir)) {
                        sourcesDir = dir;
                        break;
                    }
                }
                if (sourcesDir) {
                    break;
                }
            }
        }
        if (!sourcesDir) {
            const fallback = join(this.#projectRoot, 'Sources', targetName);
            if (existsSync(fallback)) {
                sourcesDir = fallback;
            }
            else {
                return [];
            }
        }
        return this.#walkSourceFiles(sourcesDir).map((f) => ({
            name: f.name,
            path: f.path,
            relativePath: f.relativePath,
            language: this.#inferLang(f.path),
        }));
    }
    async getDependencyGraph() {
        if (!this.#projectRoot) {
            return { nodes: [], edges: [] };
        }
        if (this.#parsedPackages.length === 0) {
            return { nodes: [], edges: [] };
        }
        const nodes = [];
        const edges = [];
        const pkgNameSet = new Set();
        const targetToPkg = new Map();
        const allParsed = [];
        const umbrellaNames = new Set();
        for (const { pkgPath, parsed } of this.#parsedPackages) {
            if (pkgNameSet.has(parsed.name)) {
                continue;
            }
            pkgNameSet.add(parsed.name);
            allParsed.push({ ...parsed, _dir: dirname(pkgPath) });
            const hasTargets = parsed.targets && parsed.targets.length > 0;
            const hasProducts = parsed.products && parsed.products.length > 0;
            if (!hasTargets && !hasProducts) {
                umbrellaNames.add(parsed.name);
                continue;
            }
            nodes.push({
                id: parsed.name,
                label: parsed.name,
                type: 'package',
                fullPath: dirname(pkgPath),
                targetCount: parsed.targets.length,
            });
            for (const t of parsed.targets) {
                nodes.push({
                    id: t.name,
                    label: t.name,
                    type: 'target',
                    parent: parsed.name,
                    targetType: t.type,
                });
                targetToPkg.set(t.name, parsed.name);
            }
            for (const prod of parsed.products || []) {
                if (!targetToPkg.has(prod.name)) {
                    targetToPkg.set(prod.name, parsed.name);
                }
            }
        }
        for (const parsed of allParsed) {
            if (umbrellaNames.has(parsed.name)) {
                continue;
            }
            for (const dep of parsed.dependencies || []) {
                if (dep.type === 'local' && 'path' in dep && dep.path) {
                    const depPkgSwift = join(parsed._dir, dep.path, 'Package.swift');
                    if (existsSync(depPkgSwift)) {
                        try {
                            const depParsed = this.#parsePackageSwift(depPkgSwift);
                            if (!umbrellaNames.has(depParsed.name)) {
                                edges.push({ from: parsed.name, to: depParsed.name, type: 'depends_on' });
                            }
                        }
                        catch {
                            const targetName = basename(dep.path);
                            if (!umbrellaNames.has(targetName)) {
                                edges.push({ from: parsed.name, to: targetName, type: 'depends_on' });
                            }
                        }
                    }
                }
                else if ('url' in dep && dep.url) {
                    const remoteName = basename(dep.url).replace(/\.git$/, '');
                    if (!pkgNameSet.has(remoteName)) {
                        pkgNameSet.add(remoteName);
                        nodes.push({ id: remoteName, label: remoteName, type: 'remote', indirect: true });
                    }
                    edges.push({ from: parsed.name, to: remoteName, type: 'depends_on' });
                }
            }
            for (const t of parsed.targets || []) {
                edges.push({ from: parsed.name, to: t.name, type: 'contains' });
                for (const depName of t.dependencies || []) {
                    if (!umbrellaNames.has(depName)) {
                        edges.push({ from: t.name, to: depName, type: 'depends_on' });
                    }
                }
            }
        }
        return { nodes, edges };
    }
    // ─────────────── Private Helpers ───────────────
    /** 向下递归扫描所有 Package.swift（支持多 Package 项目） */
    #findAllPackageSwifts(rootDir) {
        const results = [];
        const scan = (dir, depth = 0) => {
            if (depth > 5) {
                return;
            }
            try {
                const entries = readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        if (SKIP_DIRS.has(entry.name)) {
                            continue;
                        }
                        scan(join(dir, entry.name), depth + 1);
                    }
                    else if (entry.name === 'Package.swift') {
                        results.push(join(dir, entry.name));
                    }
                }
            }
            catch {
                // 权限错误等，跳过
            }
        };
        scan(rootDir);
        return results;
    }
    /** 简易解析 Package.swift（无 Swift 编译器，使用正则） */
    #parsePackageSwift(packagePath) {
        if (!packagePath || !existsSync(packagePath)) {
            throw new Error(`Package.swift not found: ${packagePath}`);
        }
        const content = readFileSync(packagePath, 'utf-8');
        return {
            path: packagePath,
            name: this.#extractName(content),
            version: this.#extractVersion(content),
            targets: this.#extractTargets(content),
            dependencies: this.#extractDependencies(content),
            products: this.#extractProducts(content),
            platforms: this.#extractPlatforms(content),
        };
    }
    #extractName(content) {
        const m = content.match(/name\s*:\s*"([^"]+)"/);
        return m ? m[1] : 'unknown';
    }
    #extractVersion(content) {
        const m = content.match(/version\s*:\s*"([^"]+)"/);
        return m ? m[1] : '0.0.0';
    }
    #extractTargets(content) {
        const targets = [];
        const re = /\.(?:target|testTarget|executableTarget)\s*\(/g;
        let match;
        while ((match = re.exec(content)) !== null) {
            const type = match[0].includes('testTarget')
                ? 'testTarget'
                : match[0].includes('executableTarget')
                    ? 'executableTarget'
                    : 'target';
            const startPos = match.index + match[0].length;
            let depth = 1;
            let endPos = startPos;
            while (depth > 0 && endPos < content.length) {
                if (content[endPos] === '(') {
                    depth++;
                }
                else if (content[endPos] === ')') {
                    depth--;
                }
                endPos++;
            }
            if (depth === 0) {
                const block = content.substring(startPos, endPos - 1);
                const nameMatch = block.match(/name\s*:\s*"([^"]+)"/);
                if (!nameMatch) {
                    continue;
                }
                const pathMatch = block.match(/path\s*:\s*"([^"]+)"/);
                const depsMatch = block.match(/dependencies\s*:\s*\[([^\]]*)\]/s);
                const deps = [];
                if (depsMatch) {
                    const depRe = /\.(?:product|target)\s*\(\s*name\s*:\s*"([^"]+)"/g;
                    let dm;
                    while ((dm = depRe.exec(depsMatch[1])) !== null) {
                        deps.push(dm[1]);
                    }
                }
                targets.push({
                    name: nameMatch[1],
                    type,
                    path: pathMatch ? pathMatch[1] : null,
                    dependencies: deps,
                });
            }
        }
        return targets;
    }
    #extractDependencies(content) {
        const deps = [];
        const urlRe = /\.package\s*\(\s*url\s*:\s*"([^"]+)"[^)]*\)/g;
        let m;
        while ((m = urlRe.exec(content)) !== null) {
            const block = m[0];
            const fromMatch = block.match(/from\s*:\s*"([^"]+)"/);
            const exactMatch = block.match(/exact\s*:\s*"([^"]+)"/);
            deps.push({
                url: m[1],
                version: fromMatch ? fromMatch[1] : exactMatch ? exactMatch[1] : null,
                type: 'package',
            });
        }
        const pathRe = /\.package\s*\(\s*path\s*:\s*"([^"]+)"\s*\)/g;
        while ((m = pathRe.exec(content)) !== null) {
            deps.push({
                path: m[1],
                type: 'local',
            });
        }
        return deps;
    }
    #extractProducts(content) {
        const products = [];
        const re = /\.(library|executable)\s*\(\s*name\s*:\s*"([^"]+)"/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            products.push({ name: m[2], type: m[1] });
        }
        return products;
    }
    #extractPlatforms(content) {
        const platforms = [];
        const re = /\.(iOS|macOS|tvOS|watchOS|visionOS)\s*\(\s*\.v(\d+(?:_\d+)?)\s*\)/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            platforms.push({ name: m[1], version: m[2].replace(/_/g, '.') });
        }
        return platforms;
    }
    #walkSourceFiles(dir) {
        const CODE_EXTS = new Set(['.swift', '.m', '.h', '.c', '.cpp', '.mm']);
        const SKIP_DIRS = new Set([
            'node_modules',
            '.git',
            'dist',
            'build',
            '.build',
            'DerivedData',
            'Pods',
            'Carthage',
        ]);
        const MAX_FILES = 300;
        const files = [];
        const walk = (d, rel = '') => {
            if (files.length >= MAX_FILES) {
                return;
            }
            let entries;
            try {
                entries = readdirSync(d);
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (files.length >= MAX_FILES) {
                    break;
                }
                if (entry.startsWith('.')) {
                    continue;
                }
                const full = join(d, entry);
                const relPath = rel ? `${rel}/${entry}` : entry;
                let st;
                try {
                    st = statSync(full);
                }
                catch {
                    continue;
                }
                if (st.isDirectory()) {
                    if (!SKIP_DIRS.has(entry)) {
                        walk(full, relPath);
                    }
                }
                else if (CODE_EXTS.has(extname(entry).toLowerCase())) {
                    if (st.size <= 512 * 1024) {
                        files.push({ name: entry, path: full, relativePath: relPath });
                    }
                }
            }
        };
        walk(dir);
        return files;
    }
    #inferLang(filePath) {
        return LanguageService.inferLang(filePath);
    }
}

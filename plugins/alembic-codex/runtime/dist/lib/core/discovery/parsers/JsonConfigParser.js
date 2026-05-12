/**
 * @module JsonConfigParser
 * @description JSON 配置文件解析器 — 支持 Nx project.json、Flutter 插件依赖、React Native 检测
 *
 * 每个解析函数接受文件内容字符串，返回类型化结果。
 */
// ── Nx 解析 ─────────────────────────────────────────
/**
 * 解析 Nx project.json 内容
 * 每个 project.json 描述一个项目
 */
export function parseNxWorkspace(content) {
    const result = { projects: [] };
    try {
        const json = JSON.parse(content);
        const name = json.name ?? '';
        const root = json.root ?? json.sourceRoot ?? '.';
        const projectType = json.projectType ?? 'library';
        const tags = Array.isArray(json.tags) ? json.tags : [];
        if (name) {
            result.projects.push({ name, root, projectType, tags });
        }
    }
    catch {
        // JSON 解析失败时返回空结果
    }
    return result;
}
// ── Flutter 解析 ────────────────────────────────────
/**
 * 解析 .flutter-plugins-dependencies 文件内容
 * 该文件由 Flutter 工具链自动生成
 */
export function parseFlutterPluginsDeps(content) {
    const result = { plugins: [] };
    try {
        const json = JSON.parse(content);
        // dependencyGraph 数组包含 Flutter embedding 信息
        const depGraph = json.dependencyGraph;
        if (Array.isArray(depGraph)) {
            for (const entry of depGraph) {
                if (typeof entry === 'object' && entry !== null) {
                    const rec = entry;
                    const name = rec.name ?? '';
                    if (name && name !== 'flutter') {
                        result.plugins.push({
                            name,
                            path: rec.path ?? '',
                            platform: 'flutter',
                        });
                    }
                }
            }
        }
        // 也解析 plugins.ios / plugins.android 中的平台插件
        const plugins = json.plugins;
        if (typeof plugins === 'object' && plugins !== null) {
            const platformPlugins = plugins;
            for (const [platform, list] of Object.entries(platformPlugins)) {
                if (Array.isArray(list)) {
                    for (const p of list) {
                        if (typeof p === 'object' && p !== null) {
                            const rec = p;
                            const name = rec.name ?? '';
                            // 避免重复
                            if (name &&
                                !result.plugins.some((existing) => existing.name === name && existing.platform === platform)) {
                                result.plugins.push({
                                    name,
                                    path: rec.path ?? '',
                                    platform,
                                });
                            }
                        }
                    }
                }
            }
        }
        // Flutter SDK 版本
        if (typeof json.flutterVersion === 'string') {
            result.flutterSdkVersion = json.flutterVersion;
        }
    }
    catch {
        // JSON 解析失败时返回空结果
    }
    return result;
}
// ── React Native 解析 ──────────────────────────────
/**
 * 解析 package.json 内容，判断是否是 React Native 项目
 */
export function parseReactNativeProject(content) {
    const result = {
        isReactNative: false,
        name: '',
    };
    try {
        const json = JSON.parse(content);
        result.name = json.name ?? '';
        const deps = (json.dependencies ?? {});
        const devDeps = (json.devDependencies ?? {});
        if (deps['react-native'] || devDeps['react-native']) {
            result.isReactNative = true;
            result.rnVersion = deps['react-native'] ?? devDeps['react-native'];
        }
        // Fabric (new architecture) 检测
        if (result.isReactNative) {
            const scripts = (json.scripts ?? {});
            result.hasFabric =
                deps['react-native-codegen'] !== undefined ||
                    Object.values(scripts).some((s) => s.includes('codegen'));
            // TurboModules 检测
            result.hasTurboModules =
                typeof json.codegenConfig === 'object' || deps['react-native-turbo-modules'] !== undefined;
        }
    }
    catch {
        // JSON 解析失败时返回空结果
    }
    return result;
}

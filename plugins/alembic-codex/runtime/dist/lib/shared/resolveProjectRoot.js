/**
 * resolveProjectRoot — 统一的 projectRoot 解析辅助函数
 *
 * 三级 fallback:
 *   1. ServiceContainer.singletons._projectRoot（最可靠，Bootstrap 后一定有值）
 *   2. process.env.ALEMBIC_PROJECT_DIR（MCP/HTTP Server 启动时设置）
 *   3. process.cwd()（CLI 模式下通常正确；MCP 模式下可能是 $HOME）
 *
 * 用于 MCP handler / HTTP route / Service 内部获取项目根目录，
 * 替代散落在各处的裸 `process.cwd()` 调用。
 */
import { relative } from 'node:path';
import { WorkspaceResolver } from './WorkspaceResolver.js';
/**
 * 解析项目根目录
 * @param container DI 容器实例（McpContext.container / getServiceContainer()）
 * @returns 项目根目录绝对路径
 */
export function resolveProjectRoot(container) {
    const fromContainer = container?.singletons?._projectRoot;
    if (typeof fromContainer === 'string' && fromContainer) {
        return fromContainer;
    }
    return process.env.ALEMBIC_PROJECT_DIR || process.cwd();
}
/**
 * 解析数据根目录（Ghost 感知）
 *
 * Ghost 模式下返回 ~/.asd/workspaces/<id>/，标准模式下返回 projectRoot。
 * 所有运行时数据（.asd/）和知识库（Alembic/）的写入应基于 dataRoot。
 *
 * @param container DI 容器实例
 * @returns 数据根目录绝对路径
 */
export function resolveDataRoot(container) {
    const resolver = container?.singletons?._workspaceResolver;
    if (resolver) {
        return resolver.dataRoot;
    }
    // fallback: 即使没有 container，也尝试根据 projectRoot 自动恢复 Ghost 模式 dataRoot
    try {
        return WorkspaceResolver.fromProject(resolveProjectRoot(container)).dataRoot;
    }
    catch {
        return resolveProjectRoot(container);
    }
}
/**
 * 解析知识库扫描目录（Ghost 感知）
 *
 * 返回相对于 dataRoot 的目录列表，优先使用 WorkspaceResolver 中的知识库目录，
 * 同时保留 legacy recipes/candidates 兼容路径。
 */
export function resolveKnowledgeScanDirs(container) {
    const dataRoot = resolveDataRoot(container);
    const dirs = new Set(['recipes', 'candidates']);
    const resolver = container?.singletons?._workspaceResolver ??
        (() => {
            try {
                return WorkspaceResolver.fromProject(resolveProjectRoot(container));
            }
            catch {
                return null;
            }
        })();
    if (!resolver) {
        dirs.add('Alembic/recipes');
        dirs.add('Alembic/candidates');
        return [...dirs];
    }
    dirs.add(relative(dataRoot, resolver.recipesDir));
    dirs.add(relative(dataRoot, resolver.candidatesDir));
    return [...dirs];
}
/**
 * 获取 WorkspaceResolver 实例
 * @param container DI 容器实例
 * @returns WorkspaceResolver 或 null（未初始化时）
 */
export function resolveWorkspace(container) {
    return container?.singletons?._workspaceResolver ?? null;
}

/**
 * @module ProjectDiscoverer
 * @description 项目结构发现器 - 统一接口定义
 *
 * 每个实现负责一种构建系统/包管理器的解析。
 * Bootstrap Phase 1 通过 DiscovererRegistry 自动选择匹配的实现。
 */
export class ProjectDiscoverer {
    /** 检测此 Discoverer 是否适用于给定项目 */
    async detect(projectRoot) {
        throw new Error('Not implemented');
    }
    /** 加载项目结构（解析配置文件、构建依赖图） */
    async load(projectRoot) {
        throw new Error('Not implemented');
    }
    /** 列出所有 Target/模块 */
    async listTargets() {
        throw new Error('Not implemented');
    }
    /** 获取指定 Target 下的源码文件列表 */
    async getTargetFiles(target) {
        throw new Error('Not implemented');
    }
    /** 获取模块间依赖关系图 */
    async getDependencyGraph() {
        throw new Error('Not implemented');
    }
    /** Discoverer 标识 */
    get id() {
        throw new Error('Not implemented');
    }
    /** 人类可读名称 */
    get displayName() {
        throw new Error('Not implemented');
    }
}

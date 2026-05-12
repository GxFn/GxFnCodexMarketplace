/**
 * ProjectSnapshot — 统一项目快照类型定义
 *
 * 这是所有 Phase 1-4 数据的唯一类型来源（Single Source of Truth）。
 * 消除了之前在 bootstrap-phases.ts、MissionBriefingBuilder.ts、
 * handler-types.ts、rescan-internal.ts 等文件中重复定义的类型。
 *
 * 设计原则：
 *   1. **不可变** — 创建后通过 Object.freeze 冻结
 *   2. **完整** — 包含 Phase 1-4 全部产出
 *   3. **类型化** — 每个字段有明确接口，不使用 `any`
 *   4. **单一定义** — 项目分析数据的唯一类型来源
 *
 * @module types/project-snapshot
 */
export {};

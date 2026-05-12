/**
 * AgentRuntimeTypes — AgentRuntime 共享类型定义
 *
 * 从 AgentRuntime.ts 提取的接口和类型，
 * 供 AgentRuntime、ToolExecutionPipeline、LarkTransport 及测试文件独立消费。
 *
 * @module AgentRuntimeTypes
 */
/** 单次迭代允许的最大工具调用数 */
export const MAX_TOOL_CALLS_PER_ITER = 8;

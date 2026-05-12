/**
 * ModelDef — LLM 模型能力声明式定义
 *
 * 所有模型的能力、约束、容量信息集中在此接口描述。
 * 消费方（ContextWindow、ParameterGuard、Gateway、Dashboard）
 * 统一从 ModelRegistry 查询，而非各自硬编码。
 */
export {};

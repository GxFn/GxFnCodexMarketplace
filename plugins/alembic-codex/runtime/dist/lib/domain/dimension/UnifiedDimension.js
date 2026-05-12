/**
 * UnifiedDimension — 统一维度类型定义
 *
 * Bootstrap / Panorama / Rescan 共用的维度接口，
 * 消除三套维度体系之间的 ID 不一致和字段缺失问题。
 *
 * @module domain/dimension/UnifiedDimension
 */
// ═══════════════════════════════════════════════════════════
// 维度 ID 常量
// ═══════════════════════════════════════════════════════════
/** Layer 1: 通用维度 ID */
export const UNIVERSAL_DIM_IDS = [
    'architecture',
    'coding-standards',
    'design-patterns',
    'error-resilience',
    'concurrency-async',
    'data-event-flow',
    'networking-api',
    'ui-interaction',
    'testing-quality',
    'security-auth',
    'performance-optimization',
    'observability-logging',
    'agent-guidelines',
];
/** Layer 2: 语言维度 ID */
export const LANGUAGE_DIM_IDS = [
    'swift-objc-idiom',
    'ts-js-module',
    'python-structure',
    'jvm-annotation',
    'go-module',
    'rust-ownership',
    'csharp-dotnet',
];
/** Layer 3: 框架维度 ID */
export const FRAMEWORK_DIM_IDS = [
    'react-patterns',
    'vue-patterns',
    'spring-patterns',
    'swiftui-patterns',
    'django-fastapi',
];
/** 所有维度 ID 数组 */
export const ALL_DIMENSION_IDS = [
    ...UNIVERSAL_DIM_IDS,
    ...LANGUAGE_DIM_IDS,
    ...FRAMEWORK_DIM_IDS,
];

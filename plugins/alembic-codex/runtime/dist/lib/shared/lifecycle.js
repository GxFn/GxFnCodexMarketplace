/**
 * lifecycle.ts — 统一生命周期接口
 *
 * 所有持有定时器、连接、文件句柄等资源的组件应实现 Disposable 或 Startable。
 * 配合 TimerRegistry 和 ShutdownCoordinator 实现统一资源回收。
 *
 * @module shared/lifecycle
 */
export {};

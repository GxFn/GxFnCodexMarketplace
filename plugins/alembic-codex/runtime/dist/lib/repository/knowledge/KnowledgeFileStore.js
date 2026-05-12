/**
 * KnowledgeFileStore — .md 文件操作接口
 *
 * 从 KnowledgeFileWriter 类提炼的接口，使文件操作可被 mock 测试。
 * 实现类: KnowledgeFileWriter (lib/service/knowledge/KnowledgeFileWriter.ts)
 *
 * 设计原则:
 *   - .md 文件 = 唯一真相源 (Source of Truth)
 *   - DB = 索引缓存
 *   - 所有写操作必须经过此接口落盘为 .md 文件
 */
export {};

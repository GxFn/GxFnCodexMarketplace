/**
 * Task HTTP API 路由 (v3.3 — Intent Lifecycle)
 *
 * 为 VS Code Extension `taskTool.ts` 提供 HTTP 转发端点。
 * 5 operations: prime, create, close, fail, record_decision
 *
 * 端点:
 *   POST /api/v1/task  — 统一入口（operation 路由）
 */
import express from 'express';
import { TaskDispatchBody } from '#shared/schemas/http-requests.js';
import { taskHandler } from '../../external/mcp/handlers/task.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
import { validate } from '../middleware/validate.js';
const router = express.Router();
/**
 * POST /api/v1/task
 *
 * 请求体:
 *   { operation: string, ...params }
 *
 * 响应:
 *   { success: boolean, data?: unknown, message?: string }
 */
router.post('/', validate(TaskDispatchBody), async (req, res) => {
    const container = getServiceContainer();
    // Build a minimal McpContext for the task handler
    const ctx = {
        container,
        session: req.__mcpSession ??
            undefined,
        startedAt: Date.now(),
    };
    try {
        const result = await taskHandler(ctx, req.body);
        const envelope = result;
        if (envelope.success === false) {
            return void res.status(400).json(envelope);
        }
        return void res.json(envelope);
    }
    catch (err) {
        return void res.status(400).json({
            success: false,
            message: err instanceof Error ? err.message : String(err),
            operation: req.body.operation,
        });
    }
});
export default router;

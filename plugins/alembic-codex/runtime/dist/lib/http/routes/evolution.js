/**
 * evolution.ts — 进化相关路由
 *
 * GET  /api/v1/evolution/proposals          Proposal 列表
 * GET  /api/v1/evolution/proposals/stats    Proposal 统计
 * POST /api/v1/evolution/proposals/:id/execute  执行 Proposal
 * POST /api/v1/evolution/proposals/:id/observe  开始观察 Proposal
 * POST /api/v1/evolution/proposals/:id/reject   拒绝 Proposal
 * GET  /api/v1/evolution/warnings           Warning 列表
 * GET  /api/v1/evolution/warnings/stats     Warning 统计
 * POST /api/v1/evolution/warnings/:id/resolve   解决 Warning
 * POST /api/v1/evolution/warnings/:id/dismiss   忽略 Warning
 *
 * @module http/routes/evolution
 */
import express from 'express';
import Logger from '../../infrastructure/logging/Logger.js';
import { getServiceContainer } from '../../injection/ServiceContainer.js';
const router = express.Router();
const logger = Logger.getInstance();
/* ════════════════════════════════════════════════════════
 *  Proposals — CRUD + 操作
 * ════════════════════════════════════════════════════════ */
/** GET /proposals — 查询 Proposals */
router.get('/proposals', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('proposalRepository');
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.type) {
            filter.type = req.query.type;
        }
        if (req.query.targetRecipeId) {
            filter.targetRecipeId = req.query.targetRecipeId;
        }
        if (req.query.source) {
            filter.source = req.query.source;
        }
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const proposals = repo
            .find(filter)
            .slice(0, limit);
        res.json({ success: true, data: proposals });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'PROPOSAL_ERROR', message: err.message },
        });
    }
});
/** GET /proposals/stats — Proposal 统计 */
router.get('/proposals/stats', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('proposalRepository');
        const pending = repo.find({ status: 'pending' }).length;
        const observing = repo.find({ status: 'observing' }).length;
        res.json({
            success: true,
            data: { pending, observing, total: pending + observing },
        });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'PROPOSAL_ERROR', message: err.message },
        });
    }
});
/** POST /proposals/:id/execute — 手动执行 Proposal */
router.post('/proposals/:id/execute', async (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('proposalRepository');
        const executor = container.get('proposalExecutor');
        const id = String(req.params.id);
        const proposal = repo.findById(id);
        if (!proposal) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Proposal not found' },
            });
            return;
        }
        // 仅执行指定的单个 Proposal
        const result = await executor.executeOne(id);
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'PROPOSAL_ERROR', message: err.message },
        });
    }
});
/** POST /proposals/:id/observe — 开始观察 Proposal（pending → observing） */
router.post('/proposals/:id/observe', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('proposalRepository');
        const id = String(req.params.id);
        const ok = repo.startObserving(id);
        if (!ok) {
            res.status(400).json({
                success: false,
                error: { code: 'INVALID_STATE', message: 'Proposal not found or not in pending status' },
            });
            return;
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'PROPOSAL_ERROR', message: err.message },
        });
    }
});
/** POST /proposals/:id/reject — 拒绝 Proposal */
router.post('/proposals/:id/reject', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('proposalRepository');
        const id = String(req.params.id);
        const { reason } = req.body;
        const ok = repo.markRejected(id, reason || 'user rejected', 'user');
        if (!ok) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Proposal not found or already resolved' },
            });
            return;
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'PROPOSAL_ERROR', message: err.message },
        });
    }
});
/* ════════════════════════════════════════════════════════
 *  Warnings — CRUD + 操作
 * ════════════════════════════════════════════════════════ */
/** GET /warnings — 查询 Warnings */
router.get('/warnings', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('warningRepository');
        const filter = {};
        if (req.query.status) {
            filter.status = req.query.status;
        }
        if (req.query.type) {
            filter.type = req.query.type;
        }
        if (req.query.targetRecipeId) {
            filter.targetRecipeId = req.query.targetRecipeId;
        }
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const warnings = repo.find(filter, limit);
        res.json({ success: true, data: warnings });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'WARNING_ERROR', message: err.message },
        });
    }
});
/** GET /warnings/stats — Warning 统计 */
router.get('/warnings/stats', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('warningRepository');
        const stats = repo.countOpen();
        res.json({ success: true, data: stats });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'WARNING_ERROR', message: err.message },
        });
    }
});
/** POST /warnings/:id/resolve — 解决 Warning */
router.post('/warnings/:id/resolve', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('warningRepository');
        const id = String(req.params.id);
        const { resolution } = req.body;
        const ok = repo.resolve(id, resolution || 'resolved by user', 'user');
        if (!ok) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Warning not found or already resolved' },
            });
            return;
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'WARNING_ERROR', message: err.message },
        });
    }
});
/** POST /warnings/:id/dismiss — 忽略 Warning */
router.post('/warnings/:id/dismiss', (req, res) => {
    try {
        const container = getServiceContainer();
        const repo = container.get('warningRepository');
        const id = String(req.params.id);
        const { reason } = req.body;
        const ok = repo.dismiss(id, reason || 'dismissed by user', 'user');
        if (!ok) {
            res.status(404).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Warning not found or already resolved' },
            });
            return;
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({
            success: false,
            error: { code: 'WARNING_ERROR', message: err.message },
        });
    }
});
export default router;

/**
 * LarkNotifier — Lark notification transport
 *
 * Extracted from task.ts. Sends task progress notifications via API Server → Lark.
 * All methods are non-blocking and fire-and-forget.
 *
 * @module infrastructure/notification/LarkNotifier
 */
// ── Internal Transport ──────────────────────────────
async function sendLarkViaApi(text) {
    try {
        const port = process.env.PORT || 3000;
        const resp = await fetch(`http://localhost:${port}/api/v1/remote/notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
            process.stderr.write(`[LarkNotifier] HTTP ${resp.status}\n`);
            return false;
        }
        const body = (await resp.json());
        return body.success === true;
    }
    catch (err) {
        process.stderr.write(`[LarkNotifier] notify failed: ${err instanceof Error ? err.message : String(err)}\n`);
        return false;
    }
}
async function sendScreenshotViaApi(caption = '') {
    try {
        const port = process.env.PORT || 3000;
        const resp = await fetch(`http://localhost:${port}/api/v1/remote/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caption }),
            signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) {
            process.stderr.write(`[LarkNotifier] Screenshot HTTP ${resp.status}\n`);
            return false;
        }
        const body = (await resp.json());
        return body.success === true;
    }
    catch (err) {
        process.stderr.write(`[LarkNotifier] Screenshot failed: ${err instanceof Error ? err.message : String(err)}\n`);
        return false;
    }
}
// ── Public API ──────────────────────────────────────
/**
 * Send task progress notification to Lark (async, non-blocking).
 * Fire-and-forget — failures are logged to stderr but never throw.
 */
export async function notifyTaskProgress(operation, args, result) {
    if (!result || result.success === false) {
        return;
    }
    const data = result.data;
    let text = '';
    switch (operation) {
        case 'create': {
            const title = data?.title || args.title || '';
            const id = data?.id || '';
            text = `📋 新任务: ${id}\n${title}`;
            break;
        }
        case 'close': {
            const closed = (data?.closed || data);
            const title = closed?.title || args.title || '';
            const id = closed?.id || args.id;
            const reason = closed?.reason || args.reason || '';
            text = `✅ 完成: ${id}\n${title}\n原因: ${reason}`;
            break;
        }
        case 'fail': {
            const failed = (data?.failed || data);
            const id = failed?.id || args.id;
            const reason = failed?.reason || args.reason || '未知';
            text = `❌ 失败: ${id}\n原因: ${reason}`;
            break;
        }
        case 'record_decision': {
            const title = args.title || '';
            text = `📌 决策: ${title}`;
            break;
        }
        default:
            return;
    }
    if (text) {
        await sendLarkViaApi(text);
        await sendScreenshotViaApi();
    }
}

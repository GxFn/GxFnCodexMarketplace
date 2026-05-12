import { envelopeForError, envelopeForSessionResult } from './TerminalEnvelopes.js';
import { getTerminalSessionManager, recordAndReturn } from './TerminalExecutorShared.js';
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
export async function executeSessionClose(request, fallbackSessionManager, startedAt, startedMs) {
    const id = parseSessionId(request.args.id);
    if (!id.ok) {
        return recordAndReturn(request, envelopeForError(request, startedAt, startedMs, id.error, { error: id.error }));
    }
    const sessionManager = getTerminalSessionManager(request, fallbackSessionManager);
    const before = sessionManager.snapshot(id.id);
    if (before?.status === 'busy') {
        return recordAndReturn(request, envelopeForError(request, startedAt, startedMs, `terminal session "${id.id}" is busy`, {
            error: `terminal session "${id.id}" is busy`,
            id: id.id,
            sessionRecord: before,
        }));
    }
    const closed = sessionManager.close(id.id);
    const after = sessionManager.snapshot(id.id);
    return recordAndReturn(request, envelopeForSessionResult(request, startedAt, startedMs, {
        action: 'close',
        id: id.id,
        closed,
        sessionRecord: after ?? before,
    }));
}
export async function executeSessionStatus(request, fallbackSessionManager, startedAt, startedMs) {
    const id = parseOptionalSessionId(request.args.id);
    if (!id.ok) {
        return recordAndReturn(request, envelopeForError(request, startedAt, startedMs, id.error, { error: id.error }));
    }
    const sessionManager = getTerminalSessionManager(request, fallbackSessionManager);
    const sessionRecord = id.id ? sessionManager.snapshot(id.id) : null;
    const sessions = id.id ? undefined : sessionManager.list();
    return recordAndReturn(request, envelopeForSessionResult(request, startedAt, startedMs, {
        action: 'status',
        id: id.id,
        found: id.id ? !!sessionRecord : undefined,
        sessionRecord,
        sessions,
        count: sessions?.length,
    }));
}
export async function executeSessionCleanup(request, fallbackSessionManager, startedAt, startedMs) {
    const sessionManager = getTerminalSessionManager(request, fallbackSessionManager);
    const removed = sessionManager.cleanup();
    return recordAndReturn(request, envelopeForSessionResult(request, startedAt, startedMs, {
        action: 'cleanup',
        removed,
    }));
}
function parseSessionId(value) {
    if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
        return {
            ok: false,
            error: 'terminal session id must match /^[A-Za-z0-9._:-]{1,64}$/',
        };
    }
    return { ok: true, id: value };
}
function parseOptionalSessionId(value) {
    if (value === undefined || value === null || value === '') {
        return { ok: true, id: null };
    }
    const parsed = parseSessionId(value);
    if (!parsed.ok) {
        return parsed;
    }
    return { ok: true, id: parsed.id };
}

import fs from 'node:fs/promises';
import path from 'node:path';
export function getReportSessionId(report) {
    const session = report.session;
    return typeof session?.id === 'string' && session.id ? session.id : null;
}
export function buildWorkflowReportSummary(report) {
    const terminal = report.terminal;
    const totals = report.totals || {};
    const duration = report.duration || {};
    const session = report.session;
    return {
        sessionId: getReportSessionId(report),
        timestamp: report.timestamp,
        project: report.project,
        mode: session?.mode || null,
        terminalCapability: session?.terminalCapability || 'baseline',
        durationMs: duration.totalMs || 0,
        candidates: totals.candidates || 0,
        toolCalls: totals.toolCalls || 0,
        terminalEnabled: terminal?.enabled === true,
        terminalSuccessRate: terminal?.successRate || 0,
    };
}
export function buildWorkflowReportArtifactManifest(report) {
    const sessionId = getReportSessionId(report);
    const terminal = report.terminal;
    const transcriptRefs = Array.isArray(terminal?.transcriptRefs)
        ? terminal.transcriptRefs.filter((ref) => typeof ref === 'string' && ref.trim().length > 0)
        : [];
    return {
        version: '1.0.0',
        sessionId,
        createdAt: new Date().toISOString(),
        report: {
            latest: 'bootstrap-report.json',
            history: sessionId ? `bootstrap-reports/${sessionId}.json` : null,
        },
        snapshot: report.snapshot ?? {
            status: 'skipped',
            id: null,
            reason: 'snapshot result not recorded',
        },
        terminal: {
            enabled: terminal?.enabled === true,
            commandCount: Array.isArray(terminal?.commands) ? terminal.commands.length : 0,
            transcriptRefs,
        },
        artifacts: transcriptRefs.map((ref) => ({ kind: 'terminal-transcript', ref })),
        notes: transcriptRefs.length > 0
            ? []
            : ['No terminal transcript artifacts were captured for this session.'],
    };
}
export async function writeWorkflowReportHistoryWithWriteZone(writeZone, report) {
    const sessionId = getReportSessionId(report);
    if (!sessionId) {
        return;
    }
    await writeZone.writeFileAsync(writeZone.runtime(path.join('bootstrap-reports', `${sessionId}.json`)), JSON.stringify(report, null, 2));
    await writeZone.writeFileAsync(writeZone.runtime(path.join('bootstrap-reports', 'artifacts', sessionId, 'manifest.json')), JSON.stringify(buildWorkflowReportArtifactManifest(report), null, 2));
    const indexPath = writeZone.runtime(path.join('bootstrap-reports', 'index.json'));
    const existing = await readJsonFile(indexPath.absolute);
    const reports = sanitizeReportSummaries(existing?.reports || []).filter((entry) => entry.sessionId !== sessionId);
    reports.unshift(buildWorkflowReportSummary(report));
    await writeZone.writeFileAsync(indexPath, JSON.stringify({ updatedAt: new Date().toISOString(), reports: reports.slice(0, 100) }, null, 2));
}
export async function writeWorkflowReportHistory(reportDir, report) {
    const sessionId = getReportSessionId(report);
    if (!sessionId) {
        return;
    }
    const historyDir = path.join(reportDir, 'bootstrap-reports');
    const artifactDir = path.join(historyDir, 'artifacts', sessionId);
    await fs.mkdir(historyDir, { recursive: true });
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(historyDir, `${sessionId}.json`), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(artifactDir, 'manifest.json'), JSON.stringify(buildWorkflowReportArtifactManifest(report), null, 2));
    const indexPath = path.join(historyDir, 'index.json');
    const existing = await readJsonFile(indexPath);
    const reports = sanitizeReportSummaries(existing?.reports || []).filter((entry) => entry.sessionId !== sessionId);
    reports.unshift(buildWorkflowReportSummary(report));
    await fs.writeFile(indexPath, JSON.stringify({ updatedAt: new Date().toISOString(), reports: reports.slice(0, 100) }, null, 2));
}
async function readJsonFile(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function sanitizeReportSummaries(reports) {
    return reports.filter((entry) => typeof entry.sessionId === 'string' && entry.sessionId.trim().length > 0);
}

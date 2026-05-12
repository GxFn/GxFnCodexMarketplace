import path from 'node:path';
import { toSessionCache } from '#types/snapshot-views.js';
import { buildMissionBriefing } from '#workflows/capabilities/execution/external/MissionBriefingBuilder.js';
import { getOrCreateSessionManager } from '#workflows/capabilities/execution/external/SessionSupport.js';
import { buildLanguageExtension } from '#workflows/capabilities/presentation/LanguageExtensionBuilder.js';
export function createExternalWorkflowSession(opts) {
    const sessionManager = getOrCreateSessionManager(opts.container);
    const session = sessionManager.createSession({
        projectRoot: opts.projectRoot,
        dimensions: opts.dimensions,
        projectContext: {
            projectName: path.basename(opts.projectRoot),
            primaryLang: opts.primaryLang,
            fileCount: opts.fileCount,
            modules: opts.moduleCount,
        },
    });
    session.setSnapshotCache(toSessionCache(opts.snapshot));
    return session;
}
export function buildExternalMissionBriefing(opts) {
    const projectMeta = {
        name: path.basename(opts.projectRoot),
        primaryLanguage: opts.primaryLang,
        secondaryLanguages: opts.secondaryLanguages || [],
        isMultiLang: opts.isMultiLang || false,
        fileCount: opts.fileCount,
        projectType: opts.projectType,
        projectRoot: opts.projectRoot,
    };
    return buildMissionBriefing({
        ...opts.briefing,
        profile: opts.profile,
        rescan: opts.rescan,
        projectMeta,
        languageExtension: buildLanguageExtension(opts.primaryLang),
    });
}
export function getActiveExternalWorkflowSession(container, sessionId) {
    const sessionManager = getOrCreateSessionManager(container);
    const session = sessionManager.getSession(sessionId);
    if (session) {
        return session;
    }
    if (sessionId) {
        const anySession = sessionManager.getAnySession();
        if (anySession && anySession.id === sessionId) {
            return anySession;
        }
    }
    return null;
}

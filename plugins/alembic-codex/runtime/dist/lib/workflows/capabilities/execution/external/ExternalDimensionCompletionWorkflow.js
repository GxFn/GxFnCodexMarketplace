import { dimensionTags } from '#domain/dimension/RecipeDimension.js';
import Logger from '#infra/logging/Logger.js';
import { BootstrapEventEmitter } from '#service/bootstrap/BootstrapEventEmitter.js';
import { getDeveloperIdentity } from '#shared/developer-identity.js';
import { resolveDataRoot } from '#shared/resolveProjectRoot.js';
import { runWorkflowCompletionFinalizer, } from '#workflows/capabilities/completion/WorkflowCompletionFinalizer.js';
import { BOOTSTRAP_COMPLETE_ACTIONS } from '#workflows/capabilities/execution/external/MissionBriefingSupport.js';
import { generateSkill as generateWorkflowSkill } from '#workflows/capabilities/execution/WorkflowSkillCompletionCapability.js';
import { saveDimensionCheckpoint } from '#workflows/capabilities/persistence/DimensionCheckpoint.js';
const logger = Logger.getInstance();
export async function runExternalDimensionCompletionWorkflow(ctx, args, dependencies = {}) {
    const startedAtMs = dependencies.now?.() ?? Date.now();
    const input = normalizeCompletionInput(args);
    if (!input.success) {
        return input.response;
    }
    const session = await resolveExternalCompletionSession({ ctx, input: input.value, dependencies });
    if (!session.success) {
        return session.response;
    }
    extendSessionTtl(session.value);
    const dimension = session.value.dimensions.find((dim) => dim.id === input.value.dimensionId);
    if (!dimension) {
        return validationFailure(`Unknown dimensionId: "${input.value.dimensionId}". Valid dimensions: ${session.value.dimensions.map((dim) => dim.id).join(', ')}`, 'VALIDATION_ERROR');
    }
    const projectRoot = session.value.projectRoot;
    const dataRoot = resolveDataRoot(ctx.container) || projectRoot;
    const referencedFiles = input.value.referencedFiles.length > 0
        ? input.value.referencedFiles
        : recoverReferencedFiles(session.value, input.value.dimensionId);
    const submittedRecipeIds = input.value.submittedRecipeIds.length > 0
        ? input.value.submittedRecipeIds
        : recoverSubmittedRecipeIds(session.value, input.value.dimensionId);
    const recipesBound = await bindSubmittedRecipes({
        ctx,
        session: session.value,
        dimensionId: input.value.dimensionId,
        submittedRecipeIds,
    });
    const skillCreated = await createExternalDimensionSkill({
        ctx,
        dimension,
        dimensionId: input.value.dimensionId,
        analysisText: input.value.analysisText,
        referencedFiles,
        keyFindings: input.value.keyFindings,
        submittedRecipeIds,
        dependencies,
    });
    const { updated, qualityReport } = session.value.markDimensionComplete(input.value.dimensionId, {
        analysisText: input.value.analysisText,
        keyFindings: input.value.keyFindings,
        referencedFiles,
        recipeIds: submittedRecipeIds,
        candidateCount: input.value.candidateCount || submittedRecipeIds.length,
    });
    await persistDimensionCheckpoint({
        session: session.value,
        dataRoot,
        dimensionId: input.value.dimensionId,
        candidateCount: input.value.candidateCount || submittedRecipeIds.length,
        analysisText: input.value.analysisText,
        referencedFiles,
        submittedRecipeIds,
        skillCreated,
        dependencies,
    });
    await persistKeyFindings({
        ctx,
        session: session.value,
        dimensionId: input.value.dimensionId,
        keyFindings: input.value.keyFindings,
    });
    const progress = session.value.getProgress();
    const isComplete = session.value.isComplete;
    emitExternalCompletionProgress({
        ctx,
        session: session.value,
        dimension,
        dimensionId: input.value.dimensionId,
        candidateCount: input.value.candidateCount || submittedRecipeIds.length,
        skillCreated,
        recipesBound,
        progress,
        isComplete,
        dependencies,
    });
    const completionFinalizer = isComplete
        ? await (dependencies.runCompletionFinalizer ?? runWorkflowCompletionFinalizer)({
            ctx,
            session: session.value,
            projectRoot,
            dataRoot,
            log: logger,
            dependencies: dependencies.finalizerDependencies,
        })
        : { deliveryVerification: null, semanticMemoryResult: null };
    if (input.value.crossDimensionHints) {
        session.value.storeHints(input.value.dimensionId, input.value.crossDimensionHints);
    }
    const accumulatedHints = session.value.getAccumulatedHints();
    const accumulatedEvidence = session.value.submissionTracker.getAccumulatedEvidence(input.value.dimensionId);
    const qualityFeedback = buildQualityFeedback({
        dimensionId: input.value.dimensionId,
        qualityReport,
    });
    const evidenceHints = buildEvidenceHints({
        session: session.value,
        isComplete,
        accumulatedEvidence,
    });
    const subpackageCoverageWarning = buildSubpackageCoverageWarning({
        session: session.value,
        dimensionId: input.value.dimensionId,
        referencedFiles,
    });
    return {
        success: true,
        data: {
            dimensionId: input.value.dimensionId,
            updated,
            skillCreated,
            recipesBound,
            progress: `${progress.completed}/${progress.total}`,
            completedDimensions: progress.completedDimIds,
            remainingDimensions: progress.remainingDimIds,
            isBootstrapComplete: isComplete,
            accumulatedHints: Object.keys(accumulatedHints).length > 0 ? accumulatedHints : undefined,
            qualityFeedback,
            evidenceHints,
            subpackageCoverageWarning,
            deliveryVerification: isComplete ? completionFinalizer.deliveryVerification : undefined,
            nextActions: isComplete ? BOOTSTRAP_COMPLETE_ACTIONS : undefined,
        },
        meta: {
            tool: 'alembic_dimension_complete',
            responseTimeMs: (dependencies.now?.() ?? Date.now()) - startedAtMs,
        },
    };
}
function normalizeCompletionInput(args) {
    const dimensionId = typeof args.dimensionId === 'string' ? args.dimensionId : undefined;
    const analysisText = typeof args.analysisText === 'string' ? args.analysisText : undefined;
    const submittedRecipeIds = args.submittedRecipeIds ?? [];
    if (!dimensionId) {
        return {
            success: false,
            response: validationFailure('Missing required parameter: dimensionId'),
        };
    }
    if (!analysisText || analysisText.length < 10) {
        return {
            success: false,
            response: validationFailure('analysisText is required and must be at least 10 characters'),
        };
    }
    if (!Array.isArray(submittedRecipeIds)) {
        return {
            success: false,
            response: validationFailure('submittedRecipeIds must be an array of recipe ID strings'),
        };
    }
    return {
        success: true,
        value: {
            sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined,
            dimensionId,
            submittedRecipeIds: submittedRecipeIds.filter((id) => typeof id === 'string'),
            analysisText,
            referencedFiles: stringArray(args.referencedFiles),
            keyFindings: stringArray(args.keyFindings),
            candidateCount: typeof args.candidateCount === 'number' ? args.candidateCount : undefined,
            crossDimensionHints: args.crossDimensionHints && typeof args.crossDimensionHints === 'object'
                ? args.crossDimensionHints
                : undefined,
        },
    };
}
async function resolveExternalCompletionSession({ ctx, input, dependencies, }) {
    const getActiveSession = dependencies.getActiveSession ?? getActiveExternalWorkflowSession;
    const session = await getActiveSession(ctx.container, input.sessionId);
    if (session) {
        return { success: true, value: session };
    }
    return {
        success: false,
        response: {
            success: false,
            message: input.sessionId
                ? `No active bootstrap session found with id: ${input.sessionId}`
                : 'No active bootstrap session. Call alembic_bootstrap first.',
            errorCode: 'SESSION_NOT_FOUND',
            meta: { tool: 'alembic_dimension_complete' },
        },
    };
}
async function getActiveExternalWorkflowSession(container, sessionId) {
    const { getActiveExternalWorkflowSession } = await import('#workflows/capabilities/execution/external/ExternalMissionWorkflow.js');
    return getActiveExternalWorkflowSession(container, sessionId);
}
function extendSessionTtl(session) {
    if (session.expiresAt) {
        session.expiresAt = Math.max(session.expiresAt, Date.now() + 60 * 60 * 1000);
    }
}
function recoverReferencedFiles(session, dimensionId) {
    try {
        const submissions = session.submissionTracker.getSubmissions(dimensionId);
        const filesFromSources = new Set();
        for (const submission of submissions) {
            for (const source of submission.sources) {
                filesFromSources.add(source.split(':')[0]);
            }
        }
        if (filesFromSources.size > 0) {
            logger.debug(`[DimensionComplete] Auto-recovered ${filesFromSources.size} referencedFiles from submissions for "${dimensionId}"`);
        }
        return [...filesFromSources];
    }
    catch {
        return [];
    }
}
function recoverSubmittedRecipeIds(session, dimensionId) {
    try {
        const recoveredIds = session.submissionTracker
            .getSubmissions(dimensionId)
            .map((submission) => submission.recipeId)
            .filter((id) => Boolean(id));
        if (recoveredIds.length > 0) {
            logger.debug(`[DimensionComplete] Auto-recovered ${recoveredIds.length} submittedRecipeIds from tracker for "${dimensionId}"`);
        }
        return recoveredIds;
    }
    catch {
        return [];
    }
}
async function bindSubmittedRecipes({ ctx, session, dimensionId, submittedRecipeIds, }) {
    if (submittedRecipeIds.length === 0) {
        return 0;
    }
    let recipesBound = 0;
    try {
        const knowledgeService = ctx.container.get('knowledgeService');
        if (!knowledgeService) {
            return recipesBound;
        }
        for (const recipeId of submittedRecipeIds) {
            try {
                const entry = await knowledgeService.get(recipeId);
                if (!entry) {
                    continue;
                }
                const newTags = [
                    ...new Set([
                        ...dimensionTags(dimensionId, parseExistingTags(entry.tags)),
                        `bootstrap:${session.id}`,
                    ]),
                ];
                await knowledgeService.update(recipeId, { dimensionId, tags: newTags }, { userId: getDeveloperIdentity() });
                recipesBound++;
            }
            catch (err) {
                logger.debug(`[DimensionComplete] Failed to tag recipe ${recipeId}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    catch (err) {
        logger.warn(`[DimensionComplete] Recipe tagging failed (degraded): ${err instanceof Error ? err.message : String(err)}`);
    }
    return recipesBound;
}
function parseExistingTags(tags) {
    if (Array.isArray(tags)) {
        return tags;
    }
    if (typeof tags !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed)
            ? parsed.filter((tag) => typeof tag === 'string')
            : [];
    }
    catch {
        return tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
    }
}
async function createExternalDimensionSkill({ ctx, dimension, dimensionId, analysisText, referencedFiles, keyFindings, submittedRecipeIds, dependencies, }) {
    if (!dimension.skillWorthy) {
        return false;
    }
    const effectiveAnalysis = await synthesizeSkillAnalysisIfNeeded({
        ctx,
        dimension,
        dimensionId,
        analysisText,
        keyFindings,
        submittedRecipeIds,
    });
    const generateSkill = dependencies.generateSkill ?? generateWorkflowSkill;
    const skillResult = await generateSkill(ctx, dimension, effectiveAnalysis, referencedFiles, keyFindings, 'external-agent-bootstrap');
    if (!skillResult.success) {
        logger.warn(`[DimensionComplete] Skill skipped for "${dimensionId}": ${skillResult.error}`);
    }
    return skillResult.success;
}
async function synthesizeSkillAnalysisIfNeeded({ ctx, dimension, dimensionId, analysisText, keyFindings, submittedRecipeIds, }) {
    if (analysisText.length >= 500 || submittedRecipeIds.length === 0) {
        return analysisText;
    }
    try {
        const knowledgeService = ctx.container.get('knowledgeService');
        if (!knowledgeService) {
            return analysisText;
        }
        const parts = [`## ${dimension.label || dimensionId} — 分析报告\n`];
        if (analysisText.trim().length > 0) {
            parts.push(analysisText.trim(), '');
        }
        for (const recipeId of submittedRecipeIds) {
            const entry = await knowledgeService.get(recipeId);
            if (!entry) {
                continue;
            }
            parts.push(`### ${entry.title || 'Untitled'}`);
            if (entry.description) {
                parts.push(entry.description);
            }
            if (entry.whenClause || entry.doClause || entry.dontClause) {
                parts.push('');
                if (entry.whenClause) {
                    parts.push(`- **When**: ${entry.whenClause}`);
                }
                if (entry.doClause) {
                    parts.push(`- **Do**: ${entry.doClause}`);
                }
                if (entry.dontClause) {
                    parts.push(`- **Don't**: ${entry.dontClause}`);
                }
            }
            if (entry.coreCode) {
                parts.push('', '```', entry.coreCode.substring(0, 500), '```');
            }
            parts.push('');
        }
        if (keyFindings.length > 0) {
            parts.push('## Key Findings', '');
            for (const finding of keyFindings) {
                parts.push(`- ${finding}`);
            }
        }
        const synthesized = parts.join('\n');
        if (synthesized.length > analysisText.length) {
            logger.info(`[DimensionComplete] Synthesized analysisText for "${dimensionId}" from ${submittedRecipeIds.length} candidates (${analysisText.length} → ${synthesized.length} chars)`);
            return synthesized;
        }
    }
    catch (err) {
        logger.debug(`[DimensionComplete] Failed to synthesize analysisText: ${err instanceof Error ? err.message : String(err)}`);
    }
    return analysisText;
}
async function persistDimensionCheckpoint({ session, dataRoot, dimensionId, candidateCount, analysisText, referencedFiles, submittedRecipeIds, skillCreated, dependencies, }) {
    try {
        const saveCheckpoint = dependencies.saveCheckpoint ?? saveDimensionCheckpoint;
        await saveCheckpoint(dataRoot, session.id, dimensionId, {
            candidateCount,
            analysisChars: analysisText.length,
            referencedFiles: referencedFiles.length,
            recipeIds: submittedRecipeIds,
            skillCreated,
        });
    }
    catch (err) {
        logger.warn(`[DimensionComplete] Checkpoint save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
async function persistKeyFindings({ ctx, session, dimensionId, keyFindings, }) {
    try {
        const knowledgeGraphService = ctx.container.get('knowledgeGraphService');
        if (!knowledgeGraphService || keyFindings.length === 0) {
            return;
        }
        for (const finding of keyFindings) {
            await knowledgeGraphService.addEdge(dimensionId, 'dimension', finding.substring(0, 80), 'finding', 'discovered_in', { source: 'external-agent-bootstrap', sessionId: session.id });
        }
    }
    catch (err) {
        logger.debug(`[DimensionComplete] SemanticMemory fixation skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
}
function emitExternalCompletionProgress({ ctx, session, dimension, dimensionId, candidateCount, skillCreated, recipesBound, progress, isComplete, dependencies, }) {
    const emitter = dependencies.createEmitter
        ? dependencies.createEmitter(ctx.container)
        : new BootstrapEventEmitter(ctx.container);
    emitter.emitDimensionComplete(dimensionId, {
        type: dimension.skillWorthy ? 'skill' : 'candidate',
        extracted: candidateCount,
        skillCreated,
        recipesBound,
        progress: `${progress.completed}/${progress.total}`,
        isBootstrapComplete: isComplete,
        source: 'external-agent',
    });
    if (isComplete) {
        emitter.emitAllComplete(session.id, progress.total, 'external-agent');
    }
}
function buildQualityFeedback({ dimensionId, qualityReport, }) {
    if (!qualityReport) {
        return undefined;
    }
    const qualityFeedback = {
        totalScore: qualityReport.totalScore,
        pass: qualityReport.pass,
        scores: qualityReport.scores,
        suggestions: qualityReport.suggestions.length > 0 ? qualityReport.suggestions : undefined,
    };
    if (qualityReport.pass) {
        logger.info(`[DimensionComplete] Quality assessment for "${dimensionId}": score=${qualityReport.totalScore}/100 PASS`);
    }
    else {
        logger.warn(`[DimensionComplete] Quality assessment for "${dimensionId}": score=${qualityReport.totalScore}/100 BELOW_THRESHOLD`);
    }
    return qualityFeedback;
}
function buildSubpackageCoverageWarning({ session, dimensionId, referencedFiles, }) {
    try {
        const localPackages = session.getSnapshotCache?.()?.localPackageModules;
        if (!localPackages || localPackages.length === 0 || referencedFiles.length === 0) {
            return undefined;
        }
        const uncoveredPackages = [];
        for (const localPackage of localPackages) {
            const packagePrefix = localPackage.packageName.replace(/\/$/, '');
            const covered = referencedFiles.some((file) => file.includes(packagePrefix) || file.includes(localPackage.name));
            if (!covered) {
                uncoveredPackages.push(localPackage.name);
            }
        }
        if (uncoveredPackages.length === 0) {
            return undefined;
        }
        logger.info(`[DimensionComplete] Subpackage coverage gap for "${dimensionId}": ${uncoveredPackages.join(', ')}`);
        return (`本维度未覆盖以下本地子包: ${uncoveredPackages.join(', ')}。` +
            `建议在分析中纳入这些模块的源码，以确保知识库完整性。`);
    }
    catch {
        return undefined;
    }
}
function buildEvidenceHints({ session, isComplete, accumulatedEvidence, }) {
    if (isComplete ||
        (accumulatedEvidence.completedDimSummaries.length === 0 &&
            accumulatedEvidence.negativeSignals.length === 0)) {
        return undefined;
    }
    return {
        previousSubmissions: accumulatedEvidence.completedDimSummaries.map((summary) => ({
            dimId: summary.dimId,
            submissionCount: summary.submissionCount,
            titles: summary.titles,
            referencedFiles: summary.referencedFiles,
        })),
        previousDimensionAnalysis: buildPreviousDimensionAnalysis(session, accumulatedEvidence),
        sharedFiles: accumulatedEvidence.sharedFiles.length > 0 ? accumulatedEvidence.sharedFiles : undefined,
        negativeSignals: accumulatedEvidence.negativeSignals.length > 0
            ? accumulatedEvidence.negativeSignals.map((signal) => signal.pattern)
            : undefined,
        usedTriggers: accumulatedEvidence.usedTriggers.length > 0 ? accumulatedEvidence.usedTriggers : undefined,
        _note: '以上为前序维度的分析证据，包含分析摘要和关键发现。请利用其中的文件引用和负空间信号，避免重复分析已覆盖的内容',
    };
}
function buildPreviousDimensionAnalysis(session, accumulatedEvidence) {
    try {
        const summaries = [];
        for (const dimensionSummary of accumulatedEvidence.completedDimSummaries) {
            const report = session.sessionStore.getDimensionReport(dimensionSummary.dimId);
            if (!report) {
                continue;
            }
            summaries.push({
                dimId: dimensionSummary.dimId,
                analysisSummary: (report.analysisText || '').substring(0, 500),
                keyFindings: (report.findings || [])
                    .slice(0, 5)
                    .map((finding) => finding.finding || finding.content || ''),
            });
        }
        return summaries.length > 0 ? summaries : undefined;
    }
    catch {
        return undefined;
    }
}
function stringArray(value) {
    return Array.isArray(value)
        ? value.filter((item) => typeof item === 'string')
        : [];
}
function validationFailure(message, errorCode = 'VALIDATION_ERROR') {
    return {
        success: false,
        message,
        errorCode,
        meta: { tool: 'alembic_dimension_complete' },
    };
}

import Logger from '#infra/logging/Logger.js';
import { CapabilityRegistry } from '../capabilities/index.js';
import { PolicyEngine } from '../policies/index.js';
import { getPreset } from '../profiles/presets.js';
import { AgentRuntime } from '../runtime/AgentRuntime.js';
export class AgentRuntimeBuilder {
    #container;
    #toolRegistry;
    #aiProvider;
    #toolRouter;
    #logger = Logger.getInstance();
    #sharedOpts;
    constructor({ container, toolRegistry, aiProvider, memoryCoordinator = null, projectBriefing = null, projectRoot = process.cwd(), dataRoot = projectRoot, toolRouter = null, }) {
        this.#container = container;
        this.#toolRegistry = toolRegistry;
        this.#aiProvider = aiProvider;
        this.#toolRouter = toolRouter;
        this.#sharedOpts = {
            memoryCoordinator,
            projectBriefing,
            projectRoot,
            dataRoot,
        };
    }
    build(profileRef, options = {}) {
        const { presetName, overrides } = normalizeProfile(profileRef);
        const preset = getPreset(presetName, overrides);
        const capabilities = (preset.capabilities || []).map((name) => CapabilityRegistry.create(name, this.#getCapabilityOpts(name)));
        const resolvedPolicies = (preset.policies || []).map((policyOrFactory) => typeof policyOrFactory === 'function'
            ? policyOrFactory(overrides)
            : policyOrFactory);
        this.#logger.debug('[AgentRuntimeBuilder] building runtime', { presetName });
        return new AgentRuntime({
            presetName,
            aiProvider: this.#aiProvider,
            toolRegistry: this.#toolRegistry,
            toolRouter: this.#toolRouter || this.#toolRegistry.getRouter?.() || null,
            container: this.#container,
            capabilities,
            strategy: preset.strategyInstance,
            policies: new PolicyEngine(resolvedPolicies),
            persona: preset.persona,
            memory: preset.memory,
            onProgress: options.onProgress || null,
            onToolCall: options.onToolCall || null,
            lang: options.lang || null,
            additionalTools: resolveActionSpaceAdditionalTools(profileRef),
            projectRoot: this.#sharedOpts.projectRoot,
            dataRoot: this.#sharedOpts.dataRoot,
        });
    }
    #getCapabilityOpts(name) {
        return {
            container: this.#container,
            memoryCoordinator: this.#sharedOpts.memoryCoordinator,
            projectBriefing: this.#sharedOpts.projectBriefing,
            projectRoot: this.#sharedOpts.projectRoot,
            ...(name === 'system_interaction' ? { projectRoot: this.#sharedOpts.projectRoot } : {}),
        };
    }
}
function normalizeProfile(profile) {
    if ('kind' in profile && profile.kind === 'compiled-agent-profile') {
        return { presetName: profile.basePreset, overrides: profile.runtimeOverrides || {} };
    }
    if (isProfileRef(profile)) {
        return { presetName: profile.preset || profile.id || 'chat', overrides: {} };
    }
    const { basePreset, skills, actionSpace, ...rest } = profile;
    return {
        presetName: basePreset,
        overrides: {
            ...rest,
            ...(skills ? { capabilities: skills } : {}),
            ...(actionSpace?.mode === 'listed' ? { additionalTools: actionSpace.toolIds } : {}),
        },
    };
}
function resolveActionSpaceAdditionalTools(profile) {
    if ('kind' in profile && profile.kind === 'compiled-agent-profile') {
        return profile.additionalTools || [];
    }
    if (isProfileRef(profile) || profile.actionSpace?.mode !== 'listed') {
        return [];
    }
    return profile.actionSpace.toolIds;
}
function isProfileRef(profile) {
    return !('basePreset' in profile) && !('kind' in profile);
}
export default AgentRuntimeBuilder;

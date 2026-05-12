import { BudgetPolicy, SafetyPolicy } from '../policies/index.js';
export class AgentProfileCompiler {
    #profileRegistry;
    #stageFactoryRegistry;
    constructor({ profileRegistry, stageFactoryRegistry }) {
        this.#profileRegistry = profileRegistry;
        this.#stageFactoryRegistry = stageFactoryRegistry;
    }
    compile(profileInput, options = {}) {
        if (isCompiledProfile(profileInput)) {
            return profileInput;
        }
        if ('basePreset' in profileInput) {
            return this.#compileOverride(profileInput, options);
        }
        return this.#compileRef(profileInput, options);
    }
    #compileRef(profileRef, options) {
        const profileId = profileRef.id || profileRef.preset || '';
        const params = mergeParams(options.params, profileRef.params);
        const definition = profileId ? this.#profileRegistry.get(profileId) : null;
        if (!definition) {
            const preset = profileRef.preset || profileRef.id;
            if (!preset) {
                throw new Error('AgentProfileRef requires id or preset');
            }
            return this.#compilePresetRef(String(preset), params);
        }
        return this.#compileDefinition(definition, params, options.context);
    }
    #compileOverride(profileOverride, options) {
        const params = mergeParams(options.params, profileOverride.params);
        const actionSpace = profileOverride.actionSpace || { mode: 'listed', toolIds: [] };
        const runtimeOverrides = stripUndefined({
            capabilities: profileOverride.skills,
            strategy: profileOverride.strategy,
            policies: compilePolicyDeclarations(profileOverride.policies),
            persona: profileOverride.persona,
            memory: profileOverride.memory,
        });
        return {
            kind: 'compiled-agent-profile',
            id: profileOverride.id || String(profileOverride.basePreset),
            title: profileOverride.id || String(profileOverride.basePreset),
            serviceKind: 'system-analysis',
            lifecycle: 'active',
            basePreset: profileOverride.basePreset,
            skills: profileOverride.skills,
            strategy: profileOverride.strategy,
            policies: runtimeOverrides.policies,
            persona: profileOverride.persona,
            memory: profileOverride.memory,
            actionSpace,
            additionalTools: additionalToolsFromActionSpace(actionSpace),
            params,
            runtimeOverrides,
        };
    }
    #compilePresetRef(preset, params) {
        return {
            kind: 'compiled-agent-profile',
            id: preset,
            title: preset,
            serviceKind: serviceKindForPreset(preset),
            lifecycle: 'active',
            basePreset: preset,
            actionSpace: { mode: 'listed', toolIds: [] },
            additionalTools: [],
            params,
            runtimeOverrides: {},
        };
    }
    #compileDefinition(definition, inputParams, context) {
        const params = mergeParams(defaultParamsForProfile(definition.id), inputParams);
        const actionSpace = resolveActionSpace(definition, params);
        const strategy = compileStrategy(definition.strategy, {
            params,
            context: context,
            stageFactoryRegistry: this.#stageFactoryRegistry,
        });
        const policies = compilePolicyDeclarations(resolvePolicyDeclarations(definition, params));
        const runtimeOverrides = stripUndefined({
            capabilities: definition.defaults?.skills,
            strategy,
            policies,
            persona: definition.defaults?.persona,
            memory: definition.defaults?.memory,
        });
        return {
            kind: 'compiled-agent-profile',
            id: definition.id,
            title: definition.title,
            serviceKind: definition.serviceKind,
            lifecycle: definition.lifecycle,
            basePreset: definition.basePreset || definition.id,
            skills: definition.defaults?.skills,
            strategy,
            policies,
            persona: definition.defaults?.persona,
            memory: definition.defaults?.memory,
            actionSpace,
            additionalTools: additionalToolsFromActionSpace(actionSpace),
            params,
            projection: definition.projection,
            concurrency: resolveConcurrencyPlan(definition.concurrency, params),
            runtimeOverrides,
        };
    }
}
function compileStrategy(strategy, { params, context, stageFactoryRegistry, }) {
    if (!strategy || (isStrategyTemplate(strategy) && strategy.type === 'preset')) {
        return undefined;
    }
    if (isStrategyTemplate(strategy) && strategy.type === 'pipeline') {
        return {
            type: 'pipeline',
            maxRetries: 1,
            stages: stageFactoryRegistry.build(strategy.factory, { params, context }),
        };
    }
    if (isStrategyTemplate(strategy) && strategy.type === 'single') {
        return { type: 'single' };
    }
    if (isStrategyTemplate(strategy) && strategy.type === 'fanout') {
        return undefined;
    }
    return strategy;
}
function compilePolicyDeclarations(policies) {
    if (!policies) {
        return undefined;
    }
    return policies.map((policy) => {
        if (!isRecord(policy) || typeof policy.type !== 'string') {
            return policy;
        }
        if (policy.type === 'budget') {
            const { type: _type, ...config } = policy;
            return new BudgetPolicy(config);
        }
        if (policy.type === 'safety') {
            return new SafetyPolicy();
        }
        return policy;
    });
}
function additionalToolsFromActionSpace(actionSpace) {
    if (actionSpace.mode !== 'listed') {
        return [];
    }
    return [...actionSpace.toolIds];
}
function resolveActionSpace(definition, params) {
    if (definition.id === 'signal-analysis' && params.mode === 'auto') {
        return { mode: 'listed', toolIds: ['suggest_skills', 'create_skill'] };
    }
    return definition.defaults?.actionSpace || { mode: 'listed', toolIds: [] };
}
function resolvePolicyDeclarations(definition, params) {
    if (definition.id === 'evolution-audit') {
        const recipes = Array.isArray(params.recipes) ? params.recipes : [];
        return [
            {
                type: 'budget',
                maxIterations: Math.min(recipes.length * 4 + 10, 120),
                maxTokens: 8192,
                temperature: 0.3,
                timeoutMs: 600_000,
            },
        ];
    }
    return definition.defaults?.policies;
}
function resolveConcurrencyPlan(concurrency, params) {
    if (!concurrency) {
        return undefined;
    }
    const paramConcurrency = params.concurrency;
    if (typeof paramConcurrency !== 'number' ||
        !Number.isFinite(paramConcurrency) ||
        paramConcurrency <= 0) {
        return concurrency;
    }
    return {
        ...concurrency,
        concurrency: Math.max(1, Math.floor(paramConcurrency)),
    };
}
function defaultParamsForProfile(profileId) {
    if (profileId === 'scan-summarize') {
        return { task: 'summarize' };
    }
    if (profileId === 'scan-extract') {
        return { task: 'extract' };
    }
    return {};
}
function mergeParams(...paramsList) {
    return Object.assign({}, ...paramsList.filter(Boolean));
}
function stripUndefined(input) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
function isCompiledProfile(value) {
    return isRecord(value) && value.kind === 'compiled-agent-profile';
}
function isStrategyTemplate(value) {
    return isRecord(value) && typeof value.type === 'string';
}
function isRecord(value) {
    return !!value && typeof value === 'object';
}
function serviceKindForPreset(preset) {
    if (preset === 'remote-exec') {
        return 'remote-operation';
    }
    if (preset === 'chat' || preset === 'lark') {
        return 'conversation';
    }
    if (preset === 'evolution') {
        return 'system-analysis';
    }
    return 'knowledge-production';
}
export default AgentProfileCompiler;

import { buildBootstrapTerminalPolicyHints, getBootstrapStageTerminalTools, resolveBootstrapTerminalToolset, } from '#workflows/capabilities/planning/dimensions/BootstrapTerminalToolset.js';
import { PRESETS } from '../profiles/presets.js';
import { buildRelationsPipelineStages, buildScanPipelineStages, SCAN_TASK_CONFIGS, } from '../prompts/scan-prompts.js';
export class AgentStageFactoryRegistry {
    #factories = new Map();
    constructor() {
        this.registerDefaults();
    }
    register(name, factory) {
        if (!name) {
            throw new Error('Agent stage factory name is required');
        }
        this.#factories.set(name, factory);
        return this;
    }
    resolve(name) {
        const factory = this.#factories.get(name);
        if (!factory) {
            throw new Error(`Unknown agent stage factory: "${name}"`);
        }
        return factory;
    }
    build(name, input) {
        return this.resolve(name)(input);
    }
    list() {
        return [...this.#factories.keys()];
    }
    registerDefaults() {
        this.register('scanPipeline', ({ params }) => {
            const task = params.task === 'summarize' ? 'summarize' : 'extract';
            const taskConfig = SCAN_TASK_CONFIGS[task];
            const files = Array.isArray(params.files)
                ? params.files
                : undefined;
            return buildScanPipelineStages({
                task,
                producePrompt: taskConfig.producePrompt,
                analyzeCaps: ['code_analysis'],
                produceCaps: ['scan_production'],
                files,
                analyzeMaxIter: task === 'summarize' ? 12 : 24,
            });
        });
        this.register('relationsPipeline', () => buildRelationsPipelineStages());
        this.register('bootstrapDimensionPipeline', ({ params, context }) => {
            const presetStages = PRESETS.insight.strategy.stages;
            const evolutionPresetStages = PRESETS.evolution.strategy.stages;
            const needsCandidates = params.needsCandidates !== false;
            const hasExistingRecipes = params.hasExistingRecipes === true;
            const prescreenDone = params.prescreenDone === true;
            const terminalCapability = resolveBootstrapTerminalToolset();
            const terminalPolicyHints = buildBootstrapTerminalPolicyHints(terminalCapability);
            const memoryCoordinator = context?.memoryCoordinator;
            const rescanContext = context?.strategyContext
                ?.rescanContext;
            const rescanGap = typeof rescanContext?.gap === 'number' && Number.isFinite(rescanContext.gap)
                ? Math.max(0, Math.floor(rescanContext.gap))
                : null;
            const rescanCreateBudget = typeof rescanContext?.createBudget === 'number' &&
                Number.isFinite(rescanContext.createBudget)
                ? Math.max(0, Math.floor(rescanContext.createBudget))
                : rescanGap;
            const withTerminalPromptContext = (ctx) => ({
                ...ctx,
                toolPolicyHints: terminalPolicyHints,
            });
            const analyzeStage = {
                ...presetStages[0],
                additionalTools: getBootstrapStageTerminalTools('analyze', terminalCapability),
                promptBuilder: (ctx) => presetStages[0].promptBuilder?.(withTerminalPromptContext(ctx)),
            };
            if (!needsCandidates) {
                return [analyzeStage];
            }
            const produceStage = {
                ...presetStages[2],
                ...(rescanCreateBudget != null && rescanCreateBudget > 0
                    ? {
                        budget: {
                            ...(presetStages[2].budget || {}),
                            maxSubmits: rescanCreateBudget,
                            softSubmitLimit: rescanCreateBudget,
                        },
                    }
                    : {}),
                promptBuilder: (ctx) => {
                    memoryCoordinator?.allocateBudget?.('producer');
                    return presetStages[2].promptBuilder?.(withTerminalPromptContext(ctx));
                },
            };
            if (hasExistingRecipes && !prescreenDone) {
                return [
                    {
                        ...evolutionPresetStages[0],
                        additionalTools: getBootstrapStageTerminalTools(evolutionPresetStages[0].name || 'evolve', terminalCapability),
                        promptBuilder: (ctx) => evolutionPresetStages[0].promptBuilder?.(withTerminalPromptContext(ctx)),
                    },
                    evolutionPresetStages[1],
                    analyzeStage,
                    presetStages[1],
                    produceStage,
                    presetStages[3],
                ];
            }
            return [analyzeStage, presetStages[1], produceStage, presetStages[3]];
        });
    }
}
export default AgentStageFactoryRegistry;

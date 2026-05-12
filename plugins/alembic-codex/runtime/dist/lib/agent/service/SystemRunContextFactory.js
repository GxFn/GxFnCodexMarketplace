import { ContextWindow } from '../context/ContextWindow.js';
import { ExplorationTracker } from '../context/ExplorationTracker.js';
import { MemoryCoordinator } from '../memory/MemoryCoordinator.js';
import { createSystemRunContext, projectSystemRunContext, } from '../runtime/SystemRunContext.js';
export class SystemRunContextFactory {
    #aiProvider;
    constructor({ aiProvider = null } = {}) {
        this.#aiProvider = aiProvider;
    }
    createContextWindow(opts = {}) {
        const modelName = this.#aiProvider?.model || '';
        const tokenBudget = ContextWindow.resolveTokenBudget(modelName, opts);
        return new ContextWindow(tokenBudget);
    }
    createSystemContext({ budget, trackerStrategy = 'analyst', label = 'default', lang, } = {}) {
        const memoryCoordinator = new MemoryCoordinator({ mode: 'bootstrap' });
        const scopeId = `scan:${label}`;
        const activeContext = memoryCoordinator.createDimensionScope(scopeId);
        const systemRunContext = createSystemRunContext({
            memoryCoordinator,
            scopeId,
            activeContext,
            contextWindow: this.createContextWindow({ isSystem: true }),
            tracker: ExplorationTracker.resolve({ source: 'system', strategy: trackerStrategy }, budget || {}),
            source: 'system',
            outputType: 'candidate',
            dimId: label,
            projectLanguage: lang || null,
            sharedState: {
                submittedTitles: new Set(),
                submittedPatterns: new Set(),
            },
        });
        return projectSystemRunContext(systemRunContext);
    }
    project(systemRunContext) {
        return projectSystemRunContext(systemRunContext);
    }
}
export default SystemRunContextFactory;

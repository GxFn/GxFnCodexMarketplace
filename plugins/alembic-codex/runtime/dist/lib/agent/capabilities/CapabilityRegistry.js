import { BootstrapAnalyze } from '#tools/v2/capabilities/BootstrapAnalyze.js';
import { BootstrapProduce } from '#tools/v2/capabilities/BootstrapProduce.js';
import { ConversationV2 } from '#tools/v2/capabilities/ConversationV2.js';
import { Evolution } from '#tools/v2/capabilities/Evolution.js';
import { ScanAnalyze } from '#tools/v2/capabilities/ScanAnalyze.js';
import { ScanProduce } from '#tools/v2/capabilities/ScanProduce.js';
import { SystemV2 } from '#tools/v2/capabilities/SystemV2.js';
export const CapabilityRegistry = {
    _registry: new Map([
        ['conversation', ConversationV2],
        ['code_analysis', BootstrapAnalyze],
        ['knowledge_production', BootstrapProduce],
        ['scan_production', ScanProduce],
        ['scan_analyze', ScanAnalyze],
        ['system_interaction', SystemV2],
        ['evolution_analysis', Evolution],
    ]),
    create(name, opts = {}) {
        const Cls = this._registry.get(name);
        if (!Cls) {
            throw new Error(`Unknown capability: ${name}`);
        }
        return new Cls(opts);
    },
    register(name, cls) {
        this._registry.set(name, cls);
    },
    get names() {
        return [...this._registry.keys()];
    },
};

import { AdaptiveStrategy } from './AdaptiveStrategy.js';
import { FanOutStrategy } from './FanOutStrategy.js';
import { SingleStrategy } from './SingleStrategy.js';
export const StrategyRegistry = {
    _registry: new Map([
        ['single', SingleStrategy],
        // 'pipeline' registers itself from PipelineStrategy.js to avoid circular imports.
        ['fan_out', FanOutStrategy],
        ['adaptive', AdaptiveStrategy],
    ]),
    create(name, opts = {}) {
        const Cls = this._registry.get(name);
        if (!Cls) {
            throw new Error(`Unknown strategy: ${name}`);
        }
        return Reflect.construct(Cls, [opts]);
    },
    register(name, cls) {
        this._registry.set(name, cls);
    },
};

import { AgentEventBus, AgentEvents } from '../runtime/AgentEventBus.js';
import { SingleStrategy } from './SingleStrategy.js';
import { Strategy } from './Strategy.js';
export class AdaptiveStrategy extends Strategy {
    #strategies;
    constructor(strategies = {}) {
        super();
        this.#strategies = {
            single: strategies.single || new SingleStrategy(),
            pipeline: strategies.pipeline || null,
            fanOut: strategies.fanOut || null,
        };
    }
    get name() {
        return 'adaptive';
    }
    async execute(runtime, message, opts = {}) {
        const complexity = this.#assessComplexity(message, opts);
        const bus = AgentEventBus.getInstance();
        bus.publish(AgentEvents.PROGRESS, {
            type: 'adaptive_classification',
            complexity,
            selectedStrategy: complexity,
        });
        if (complexity === 'fan_out' && this.#strategies.fanOut) {
            return this.#strategies.fanOut.execute(runtime, message, opts);
        }
        if ((complexity === 'fan_out' || complexity === 'pipeline') && this.#strategies.pipeline) {
            return this.#strategies.pipeline.execute(runtime, message, opts);
        }
        return this.#strategies.single.execute(runtime, message, opts);
    }
    #assessComplexity(message, opts) {
        const text = message.content.toLowerCase();
        if ((opts.items?.length ?? 0) > 1) {
            return 'fan_out';
        }
        if (/冷启动|cold[\s-]?start|bootstrap|全项目|所有.*维度|all.*dimensions/i.test(text)) {
            return 'fan_out';
        }
        if (/深度.*分析|扫描|审计|scan|deep.*analy|audit|知识提取|extract/i.test(text)) {
            return 'pipeline';
        }
        return 'single';
    }
}

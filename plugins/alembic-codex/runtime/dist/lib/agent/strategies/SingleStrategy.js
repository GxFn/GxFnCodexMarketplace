import { Strategy } from './Strategy.js';
export class SingleStrategy extends Strategy {
    get name() {
        return 'single';
    }
    async execute(runtime, message, opts = {}) {
        return runtime.reactLoop(message.content, {
            history: message.history,
            context: message.metadata.context || {},
            ...opts,
        });
    }
}

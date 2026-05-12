export class Strategy {
    get name() {
        throw new Error('Subclass must implement name');
    }
    async execute(_runtime, _message, _opts) {
        throw new Error('Subclass must implement execute()');
    }
}

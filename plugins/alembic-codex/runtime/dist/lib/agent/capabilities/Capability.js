export class Capability {
    get name() {
        throw new Error('Subclass must implement name');
    }
    get promptFragment() {
        throw new Error('Subclass must implement promptFragment');
    }
    get tools() {
        return [];
    }
    buildContext(_context) {
        return null;
    }
    onBeforeStep(_stepState) { }
    onAfterStep(_stepResult) { }
}

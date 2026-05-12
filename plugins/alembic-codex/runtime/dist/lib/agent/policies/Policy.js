export class Policy {
    get name() {
        throw new Error('Subclass must implement name');
    }
    validateBefore(_context) {
        return { ok: true };
    }
    validateDuring(_stepState) {
        return { ok: true, action: 'continue' };
    }
    validateAfter(_result) {
        return { ok: true };
    }
    applyToConfig(config) {
        return config;
    }
}

export class WorkflowRegistry {
    #workflows = new Map();
    register(definition) {
        if (!definition.id) {
            throw new Error('Workflow definition must have an id');
        }
        if (this.#workflows.has(definition.id)) {
            throw new Error(`Workflow '${definition.id}' already registered`);
        }
        this.#workflows.set(definition.id, {
            ...definition,
            parameters: definition.parameters || {},
        });
    }
    unregister(id) {
        return this.#workflows.delete(id);
    }
    get(id) {
        return this.#workflows.get(id) || null;
    }
    has(id) {
        return this.#workflows.has(id);
    }
    list() {
        return [...this.#workflows.values()];
    }
}
export default WorkflowRegistry;

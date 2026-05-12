export class CapabilityCatalog {
    #manifests = new Map();
    constructor(manifests = []) {
        this.registerAll(manifests);
    }
    register(manifest) {
        if (!manifest.id) {
            throw new Error('Capability manifest must have an id');
        }
        if (this.#manifests.has(manifest.id)) {
            throw new Error(`Capability '${manifest.id}' already registered`);
        }
        this.#manifests.set(manifest.id, manifest);
    }
    registerAll(manifests) {
        for (const manifest of manifests) {
            this.register(manifest);
        }
    }
    unregister(id) {
        return this.#manifests.delete(id);
    }
    has(id) {
        return this.#manifests.has(id);
    }
    getManifest(id) {
        return this.#manifests.get(id) || null;
    }
    list(filter = {}) {
        const ids = filter.ids ? new Set(filter.ids) : null;
        return [...this.#manifests.values()].filter((manifest) => {
            if (ids && !ids.has(manifest.id)) {
                return false;
            }
            if (filter.lifecycle && manifest.lifecycle !== filter.lifecycle) {
                return false;
            }
            if (filter.surface && !manifest.surfaces.includes(filter.surface)) {
                return false;
            }
            return manifest.lifecycle !== 'disabled';
        });
    }
    toToolSchemas(ids) {
        return this.list({ ids }).map((manifest) => ({
            name: manifest.id,
            description: manifest.description,
            parameters: manifest.inputSchema,
        }));
    }
    get size() {
        return this.#manifests.size;
    }
}
export default CapabilityCatalog;

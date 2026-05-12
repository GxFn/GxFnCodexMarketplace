import { classifyRecipeToDimension, DIMENSION_DISPLAY_GROUP, DIMENSION_REGISTRY, } from '#domain/dimension/DimensionRegistry.js';
const KNOWN_DIMENSION_IDS = new Set(DIMENSION_REGISTRY.map((dimension) => dimension.id));
export function isKnownDimensionId(value, options = {}) {
    if (typeof value !== 'string') {
        return false;
    }
    const normalized = value.trim();
    if (KNOWN_DIMENSION_IDS.has(normalized)) {
        return true;
    }
    for (const id of options.knownDimensionIds ?? []) {
        if (id === normalized) {
            return true;
        }
    }
    return false;
}
export function resolveRecipeDimensionId(entry, options = {}) {
    const scopedDimensionIds = new Set(options.knownDimensionIds ?? []);
    const scopedOptions = { knownDimensionIds: scopedDimensionIds };
    const explicit = pickString(entry.dimensionId);
    if (isKnownDimensionId(explicit, scopedOptions)) {
        return explicit;
    }
    const noteDimension = extractAgentNoteDimensionId(entry.agentNotes);
    if (isKnownDimensionId(noteDimension, scopedOptions)) {
        return noteDimension;
    }
    const category = pickString(entry.category);
    if (isScopedDimensionId(category, scopedDimensionIds)) {
        return category;
    }
    const knowledgeType = pickString(entry.knowledgeType);
    if (isScopedDimensionId(knowledgeType, scopedDimensionIds)) {
        return knowledgeType;
    }
    const tags = normalizeTags(entry.tags);
    for (const tag of tags) {
        const normalized = tag.startsWith('dimension:') ? tag.slice('dimension:'.length) : tag;
        if (isScopedDimensionId(normalized, scopedDimensionIds)) {
            return normalized;
        }
    }
    if (isKnownDimensionId(category)) {
        return category;
    }
    if (isKnownDimensionId(knowledgeType)) {
        return knowledgeType;
    }
    for (const tag of tags) {
        const normalized = tag.startsWith('dimension:') ? tag.slice('dimension:'.length) : tag;
        if (isKnownDimensionId(normalized)) {
            return normalized;
        }
    }
    const inferred = classifyRecipeToDimension(pickString(entry.topicHint) || '', category || '');
    return inferred && isKnownDimensionId(inferred, scopedOptions) ? inferred : null;
}
export function recipeBelongsToDimension(entry, dimension, options = {}) {
    const knownDimensionIds = options.knownDimensionIds ?? [dimension.id];
    const resolved = resolveRecipeDimensionId(entry, { ...options, knownDimensionIds });
    if (resolved) {
        return resolved === dimension.id;
    }
    const knowledgeType = pickString(entry.knowledgeType);
    return (dimension.knowledgeTypes ?? []).includes(knowledgeType);
}
export function recipeDimensionIdOrUnknown(entry, options = {}) {
    return resolveRecipeDimensionId(entry, options) || 'unknown';
}
export function recipeStorageBucket(entry, options = {}) {
    return resolveRecipeDimensionId(entry, options) || pickString(entry.category) || 'general';
}
export function dimensionTags(dimensionId, existing = []) {
    if (!dimensionId) {
        return existing;
    }
    return [
        ...new Set([
            ...existing,
            dimensionId,
            `dimension:${dimensionId}`,
            'bootstrap',
            DIMENSION_DISPLAY_GROUP[dimensionId] || dimensionId,
        ]),
    ];
}
function extractAgentNoteDimensionId(agentNotes) {
    if (!agentNotes) {
        return '';
    }
    if (typeof agentNotes === 'string') {
        try {
            return extractAgentNoteDimensionId(JSON.parse(agentNotes));
        }
        catch {
            return '';
        }
    }
    if (typeof agentNotes !== 'object' || Array.isArray(agentNotes)) {
        return '';
    }
    return pickString(agentNotes.dimensionId);
}
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags.filter((tag) => typeof tag === 'string');
    }
    if (typeof tags !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(tags);
        return Array.isArray(parsed)
            ? parsed.filter((tag) => typeof tag === 'string')
            : [];
    }
    catch {
        return tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
    }
}
function isScopedDimensionId(value, scopedDimensionIds) {
    return typeof value === 'string' && scopedDimensionIds.has(value.trim());
}
function pickString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

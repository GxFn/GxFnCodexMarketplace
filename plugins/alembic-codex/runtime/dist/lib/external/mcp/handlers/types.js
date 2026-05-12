/**
 * Shared type definitions for MCP handler modules.
 * Runtime-free — only interfaces and type aliases.
 */
/** Create a fresh idle IntentState */
export function createIdleIntent() {
    return {
        phase: 'idle',
        primeQuery: '',
        primeRecipeIds: [],
        primeAt: 0,
        primeLanguage: null,
        primeModule: null,
        primeScenario: 'search',
        toolCalls: [],
        searchQueries: [],
        mentionedFiles: [],
        mentionedModules: new Set(),
        decisions: [],
        driftEvents: [],
    };
}

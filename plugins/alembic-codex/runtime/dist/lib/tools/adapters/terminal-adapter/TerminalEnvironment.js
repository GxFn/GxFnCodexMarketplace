export const NON_INTERACTIVE_ENV = {
    CI: '1',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    LESS: '-FRX',
    PAGER: 'cat',
};
export function buildTerminalEnvironment(env, commandEnv = {}) {
    return {
        ...env,
        ...commandEnv,
        ...NON_INTERACTIVE_ENV,
    };
}
export function buildCommandEnvironment(sessionEnv, commandEnv) {
    return {
        ...sessionEnv,
        ...commandEnv,
    };
}
export function summarizeTerminalEnv(env, persistence) {
    return {
        keys: Object.keys(env).sort(),
        persistence,
    };
}

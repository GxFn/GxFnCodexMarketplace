import { getTestModeConfig } from '#shared/test-mode.js';
const TOOLSET_MODES = {
    baseline: [],
    'terminal-run': ['run'],
    'terminal-shell': ['run', 'shell'],
    'terminal-pty': ['run', 'shell', 'pty'],
};
const ANALYZE_TOOLS = {
    run: 'terminal',
    shell: 'terminal_shell',
    pty: 'terminal_pty',
};
const EVOLUTION_TOOLS = {
    run: 'terminal',
    shell: 'terminal_shell',
};
export function resolveBootstrapTerminalToolset() {
    const terminalCfg = getTestModeConfig().terminal;
    const envToolset = terminalCfg.toolset;
    const requestedToolset = normalizeToolset(envToolset);
    const toolset = requestedToolset || 'terminal-run';
    const enabled = toolset !== 'baseline';
    const defaultModes = TOOLSET_MODES[toolset];
    return {
        enabled,
        toolset,
        modes: [...defaultModes],
    };
}
export function getBootstrapStageTerminalTools(stageName, config) {
    if (!config.enabled || config.toolset === 'baseline') {
        return [];
    }
    if (stageName === 'analyze') {
        return config.modes.map((mode) => ANALYZE_TOOLS[mode]).filter(Boolean);
    }
    if (stageName === 'evolve' || stageName === 'evolution') {
        return config.modes
            .map((mode) => EVOLUTION_TOOLS[mode])
            .filter((tool) => typeof tool === 'string');
    }
    return [];
}
export function buildBootstrapTerminalPolicyHints(config) {
    return {
        terminalCapability: {
            enabled: config.enabled,
            toolset: config.toolset,
            modes: [...config.modes],
            scriptAllowed: false,
        },
        constraints: [
            'Terminal tools are optional code-analysis evidence tools for analyze/evolve only.',
            'Prefer terminal({ action: "exec" }). Use terminal_shell only for pipes/redirection/substitution.',
            'Use terminal_pty only when a TTY transcript is required.',
            'No installs, network operations, project writes, deletions, chmod/chown, sudo, or daemons.',
        ],
    };
}
function normalizeToolset(value) {
    return value === 'baseline' ||
        value === 'terminal-run' ||
        value === 'terminal-shell' ||
        value === 'terminal-pty'
        ? value
        : null;
}

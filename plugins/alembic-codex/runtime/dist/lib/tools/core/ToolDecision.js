export function allowToolDecision(stage, extras = {}) {
    return { allowed: true, stage, ...extras };
}
export function denyToolDecision(stage, reason, extras = {}) {
    return { allowed: false, stage, reason, ...extras };
}

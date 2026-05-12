export function presentToolResult(envelope) {
    return envelope.text;
}
export function isToolResultEnvelope(value) {
    return (!!value &&
        typeof value === 'object' &&
        'toolId' in value &&
        'callId' in value &&
        'status' in value &&
        'text' in value &&
        'trust' in value);
}

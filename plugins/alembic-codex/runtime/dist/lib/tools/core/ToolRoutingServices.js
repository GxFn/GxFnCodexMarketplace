export function createToolRoutingServiceContract(toolRouter) {
    return {
        toolRouter: toolRouter || null,
    };
}
export function resolveToolRouterFromContext(context) {
    const routed = context.serviceContracts?.toolRouting?.toolRouter;
    if (isToolRouterContract(routed)) {
        return routed;
    }
    return null;
}
function isToolRouterContract(value) {
    return (!!value &&
        typeof value === 'object' &&
        typeof value.execute === 'function' &&
        typeof value.executeChildCall === 'function' &&
        typeof value.explain === 'function');
}

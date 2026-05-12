export const CHAT_PROFILES = [
    {
        id: 'chat-default',
        title: 'Default Chat',
        serviceKind: 'conversation',
        lifecycle: 'active',
        basePreset: 'chat',
        defaults: {
            actionSpace: { mode: 'listed', toolIds: [] },
        },
        strategy: { type: 'preset' },
        projection: 'chat-reply',
    },
    {
        id: 'lark-chat',
        title: 'Lark Chat',
        serviceKind: 'conversation',
        lifecycle: 'active',
        basePreset: 'lark',
        defaults: {
            actionSpace: { mode: 'listed', toolIds: [] },
        },
        strategy: { type: 'preset' },
        projection: 'chat-reply',
    },
];

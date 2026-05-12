---
name: codex-lark-remote
description: Use when the user asks to start, configure, diagnose, or use Codex Lark Remote, or when Codex is responding to a Feishu/Lark message through codex-lark-remote. Defaults to continuing the current Codex conversation from Feishu/Lark.
---

# Codex Lark Remote

Use this skill when the user asks to start this plugin, configure Feishu/Lark,
or continue Codex from Feishu/Lark.

## Default Startup

Treat the product as one default flow: Feishu/Lark takes over the current Codex
conversation. Do not explain alternate task, repo, webhook, worktree, or approval
flows unless the user explicitly asks for advanced behavior.

When the user says "start this plugin" or similar:

1. Use the plugin MCP tools only. Do not inspect plugin files, explain cache
   paths, run local bridge scripts, or fall back to shell commands during normal
   startup.
2. If `codex_lark_*` tools are not available in the current tool list, stop and
   tell the user the plugin MCP server is not loaded. Ask them to enable or
   refresh the plugin and start a new Codex conversation. Do not attempt a local
   script fallback unless the user explicitly asks for plugin development
   debugging.
3. Before calling `codex_lark_handoff`, clearly tell the user that handoff stores
   local routing state for this Codex thread in the local Codex Lark Remote
   bridge. Existing chat history is not sent to Feishu/Lark; future Feishu/Lark
   messages and Codex replies may pass through the configured bot while handoff
   is active. Ask for explicit consent in the current chat. Do not call
   `codex_lark_handoff` from a generic "start" request alone.
4. After the user explicitly consents to local bridge handoff, call
   `codex_lark_handoff` with `confirmedLocalBridgeHandoff: true`, preferably
   with auth checking enabled when available. Handoff must bind the exact Codex
   thread from MCP request metadata or an explicit `threadId`; it must not guess
   from workspace path. If the tool says the current thread id is unavailable,
   report that startup is blocked instead of falling back to local scripts. This
   is the default startup action after consent. On macOS, handoff starts the
   plugin's built-in keep-awake process unless `handoff.keepAwake` is disabled.
5. If Feishu/Lark `appId` or `appSecret` is missing, ask for the missing values
   and give the short platform path: create an internal/custom app in
   Feishu/Lark Open Platform, enable bot capability, copy App ID/App Secret from
   Credentials & Basic Info, choose long connection/WebSocket in Event
   Subscriptions, and subscribe to `im.message.receive_v1`.
6. If the user already supplied the values in chat, call `codex_lark_configure`.
   Never echo raw secrets back. Then ask for explicit consent before calling
   `codex_lark_handoff`.
7. Keep the final startup response short: whether Feishu takeover is ready, what
   is missing, and the one next action.

## Remote Replies

Feishu/Lark text should be treated as the next normal Codex user message in the
same conversation. Continue naturally and avoid queue/task boilerplate. Mention
skill paths, cache layouts, MCP loading internals, local scripts, internal ids,
queues, repo keys, worktrees, approval commands, or alternate routes only when
the user asks for diagnostics or plugin development debugging.

When a Feishu/Lark turn is completed, answer in the same concise style you would
use in Codex chat. Include changed files and validation only when they matter to
the user's request.

Normal shell commands and command output are hidden from Feishu/Lark by default.
If the user asks to inspect command details, tell them to send
`/codex commands on`. Risky commands are still shown with a warning even when
normal command display is off.

Feishu/Lark cannot approve native Codex Desktop permission UI. If a request
needs MCP approval, sandbox escalation, network/install permission, writing
outside allowed roots, or another native permission dialog, do not wait silently.
Turn it into a clear Feishu/Lark prompt that says what permission is needed and
whether the user must approve it in Codex Desktop or can reply with explicit
text consent in Feishu/Lark.

If another Feishu/Lark message arrives while Codex is already running, treat the
next turn as supplemental guidance for the same conversation. Reconcile it with
any work already completed by the previous turn instead of restarting from
scratch.

Observation is separate from takeover. Use `/codex observe` in Feishu/Lark to
list observable Codex sessions, `/codex observe <number or thread prefix>` to
stream read-only progress from a selected session, and `/codex observe off` to
stop. Observation must never route Feishu/Lark user messages into the observed
session.

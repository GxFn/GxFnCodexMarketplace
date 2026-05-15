---
name: codex-lark-remote
description: Use when the user asks to start, configure, diagnose, or use Lark Remote, or when Codex is responding to a Feishu/Lark message through codex-lark-remote. Defaults to connecting Feishu/Lark to the local Codex project/session console.
---

# Lark Remote

Use this skill when the user asks to start this plugin, configure Feishu/Lark,
or control local Codex projects and sessions from Feishu/Lark.

## Default Startup

Treat the Feishu/Lark control console as the product's main entry point. Codex
starts the local bridge, then Feishu/Lark manages local Codex projects and sessions.
Do not explain alternate task, repo, webhook, worktree, or approval flows unless
the user explicitly asks for advanced behavior.

When the user says "start this plugin" or similar:

1. Use the plugin MCP tools only. Do not inspect plugin files, explain cache
   paths, run local bridge scripts, or fall back to shell commands during normal
   startup.
2. If `codex_lark_*` tools are not available in the current tool list, stop and
   tell the user the plugin MCP server is not loaded. Ask them to enable or
   refresh the plugin and start a new Codex conversation. Do not attempt a local
   script fallback unless the user explicitly asks for plugin development
   debugging.
3. Before calling `codex_lark_handoff`, clearly tell the user that startup stores
   local routing state for this Codex thread in the local Lark Remote bridge and
   opens the Feishu/Lark control console. Existing chat history is not sent to
   Feishu/Lark; future Feishu/Lark messages may select, observe, or take over
   local Codex sessions through the configured bot. Ask for explicit consent in
   the current chat. Do not call `codex_lark_handoff` from a generic "start"
   request alone.
4. After the user explicitly consents to local bridge handoff, call
   `codex_lark_handoff` with `confirmedLocalBridgeHandoff: true`, preferably
   with auth checking enabled when available. Handoff must bind the exact Codex
   thread from MCP request metadata or an explicit `threadId`; it must not guess
   from workspace path. If the tool says the current thread id is unavailable,
   report that startup is blocked instead of falling back to local scripts. This
   initial thread may be attached as a target, but Feishu/Lark can later choose
   other allowed local sessions from the console. On macOS, handoff starts the
   plugin's built-in keep-awake process unless `handoff.keepAwake` is disabled.
5. If Feishu/Lark `appId` or `appSecret` is missing, ask for the missing values
   and give the short platform path: create an internal/custom app in
   Feishu/Lark Open Platform, enable bot capability, copy App ID/App Secret from
   Credentials & Basic Info, choose long connection/WebSocket in Event
   Configuration for `im.message.receive_v1`, choose long connection/WebSocket
   in Callback Configuration for `card.action.trigger`, then publish/enable the
   app. Tell the user to copy App ID/App Secret to the clipboard and reply
   naturally with `已复制` or `copied`. When the user says they copied the
   values, read the clipboard with the local clipboard command if available,
   parse `appId` and `appSecret`, and call `codex_lark_configure`; do not echo
   the secret. Then run `codex_lark_check_auth` and `codex_lark_verify_setup`
   so the user can verify Feishu's long-connection setup while the bridge is
   running. After the Feishu Event Configuration and Callback Configuration
   pages are both verified and published, ask for explicit consent before
   calling `codex_lark_handoff` to connect this Codex conversation. Only after
   handoff reports connected should you ask the user to send `whoami` from
   Feishu/Lark. For first private setup, use `allowedUsers: []` only long enough
   for that post-connection `whoami`; after that, add the returned senderId to
   `lark.allowedUsers` before using project/session takeover.
6. If the user already supplied the values in chat, call `codex_lark_configure`.
   Never echo raw secrets back. Then ask for explicit consent before calling
   `codex_lark_handoff`.
7. Keep the final startup response short: whether Feishu takeover is ready, what
   is missing, and the one next action.

After bridge startup or handoff, the plugin may push a startup intro to
Feishu/Lark. `startup.receiveId` enables an immediate proactive send; without
that configured target, the first allowed Feishu/Lark message supplies and
remembers the current chat, then receives the intro once. Use
`startup.once: false` only for local debugging when the user wants to see the
intro repeatedly.

## Remote Replies

After a session is taken over, Feishu/Lark text should be treated as the next
normal Codex user message for that selected session. Continue naturally and
avoid queue/task boilerplate. Mention skill paths, cache layouts, MCP loading
internals, local scripts, internal ids, queues, repo keys, worktrees, approval
commands, or alternate routes only when the user asks for diagnostics or plugin
development debugging.

When a Feishu/Lark turn is completed, answer in the same concise style you would
use in Codex chat. Include changed files and validation only when they matter to
the user's request.

Normal shell commands and command output are hidden from Feishu/Lark by default.
If the user asks to inspect command details, tell them to send
`commands on`. Risky commands are still shown with a warning even when
normal command display is off.

Feishu/Lark cannot approve native Codex Desktop permission UI. If a request
needs MCP approval, sandbox escalation, network/install permission, writing
outside allowed roots, or another native permission dialog, do not wait silently.
Turn it into a clear Feishu/Lark prompt that says what permission is needed and
whether the user must approve it in Codex Desktop or can reply with explicit
text consent in Feishu/Lark.

`退出接管` / `exit handoff` / `handoff off` exits the current Codex session
handoff only and keeps the Feishu/Lark bridge connected. `关闭飞书连接` /
`close Lark connection` is the explicit command to stop the local bridge and
disconnect the Feishu/Lark WebSocket; it must ask for confirmation before
stopping because replies cannot continue after shutdown.

If another Feishu/Lark message arrives while the selected Codex Desktop session
is already running, do not queue or reinterpret it. Tell the user the selected
session is busy, the message was not sent, and they should resend it after the
current turn finishes or after takeover becomes active.

Observation is separate from takeover. Use `observe` in Feishu/Lark to
list observable Codex sessions, `observe <number or thread prefix>` to
stream read-only progress from a selected session, and `observe off` to
stop. Observation must never route Feishu/Lark user messages into the observed
session.

Cross-thread takeover is controlled from Feishu/Lark. Full-project takeover
requires a non-empty `lark.allowedUsers` allowlist. The user can use Chinese or
English phrases such as `项目列表` / `project list`, `进入项目 1` /
`enter project 1`, `观察会话 2` / `observe session 2`, and `接管 1` /
`takeover 1`. They choose a local Codex project, then choose any window inside
that project, including the window that started takeover. Window cards offer
read-only Observe and confirmed Takeover actions. Do not choose the target in
Codex unless the user explicitly asks for manual diagnostics.

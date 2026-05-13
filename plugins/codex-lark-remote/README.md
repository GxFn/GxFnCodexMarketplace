# Lark Remote

Control and take over local Codex sessions from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Marketplace page: [codex-lark-remote](https://www.codex-marketplace.com/plugins/codex-lark-remote)

This README ships inside the installable Codex plugin bundle. The repository
homepage also has a full first-time user guide.

## Core Entry

Lark Remote's main entry point is the Feishu/Lark control console. Start the
local bridge from Codex, then use Feishu/Lark to manage local Codex projects and
sessions.

The conversation that starts the bridge can be attached as the first target, but
Feishu/Lark can also list projects, choose another session, observe progress, or
take over a selected Codex session.

## Start With The Console

The Feishu/Lark side has one main entry point: the natural-language console.
After the bridge is connected, send `console` or click the console button on
the startup card.

Console display language is bound per Feishu/Lark chat. Enter with English to
keep later console cards in English; enter with Chinese to keep them in Chinese.
Sending a control phrase in the other language switches that chat's later
display language.

In the console, use short phrases:

```text
console
project list
session list
open project 1
observe session 2
takeover 1
```

The same controls also work in Chinese, such as `控制台`, `项目列表`,
`会话列表`, `进入项目 1`, `观察会话 2`, and `接管 1`.

When you take over a Codex session, the chat switches to direct task mode.
Ordinary Feishu/Lark messages are then sent straight to that Codex session as
new tasks or follow-up instructions. They no longer go through project/session
intent routing.

To temporarily return to the console, say `console` or `jump out of handoff`.
To end the current takeover but keep the Feishu/Lark bridge connected, say
`handoff off` or `exit handoff`. To stop the local bridge and disconnect
Feishu/Lark, say `close Lark connection`; the bot asks for confirmation first.

## Daily Flow

1. Install the plugin and configure the Feishu/Lark app once.
2. In Codex, start Lark Remote to connect the local bridge.
3. In Feishu/Lark, enter the console and choose a project/session.
4. Take over the session, then send normal coding requests.
5. Use `console` when you need to choose another project or session.

## Install

Install from the approved Codex Marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

For the pinned reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.3/plugins/codex-lark-remote --plugin
```

If Codex asks for a GitHub target or direct artifact path, use:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.3/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.2.3

Sparse path:
plugins/codex-lark-remote
```

Enable `codex-lark-remote` from the plugin list after installation.

To add the whole `gxfn` repository marketplace instead of only this plugin, use
the repository root with an empty sparse path. Use `main` only when you want
unreleased changes.

## Configure Feishu/Lark

For first-time setup, use this path:

1. Create the Feishu/Lark bot app.
2. Copy App ID and App Secret to the clipboard.
3. Return to Codex and say `copied` or `已复制`.
4. Codex reads the clipboard, saves config, and runs `codex_lark_check_auth`.
5. Codex runs `codex_lark_verify_setup` to start/reuse the bridge and confirm
   that WebSocket is connected.
6. In Feishu/Lark Open Platform, click verify/save on the Event Configuration
   and Callback Configuration pages.
7. Return to Codex and explicitly approve connecting this Codex conversation to
   Lark Remote.
8. After Codex confirms the connection is active, send `whoami` to the bot from
   Feishu/Lark.
9. Add the returned `senderId` to `lark.allowedUsers`, then use the console.

Create the Feishu/Lark app:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. Copy **App ID** and **App Secret** from **Credentials & Basic Info**.
5. In **Event Configuration**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1`.
6. In **Callback Configuration**, choose long connection/WebSocket and subscribe
   to `card.action.trigger`. Keep Codex Lark Remote bridge running when you
   click Feishu/Lark's verify/save buttons.
7. If you switch to webhook mode, configure
   `/bridge/lark/event` as the callback URL and keep verification token /
   encrypt key in sync.
8. Enable the message receive, send/reply, and card interaction callback
   permissions requested by the platform, then publish or enable the app for
   your tenant.

`codex_lark_verify_setup` is mainly for first-time setup, reconfiguration, and
troubleshooting. It reports whether credentials work, whether the bridge is
running, whether WebSocket is connected, and whether the plugin has actually
received `im.message.receive_v1` message events and `card.action.trigger` card
callbacks. You do not need to run it repeatedly during normal use.

Copy App ID and App Secret to the clipboard. If you do not know your sender id
yet, leave `allowedUsers` empty for this first private setup. The clipboard can
use this shape:

```text
Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: []

Optional takeover tuning:
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

Optional startup intro:
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }
```

After copying it, return to Codex and say `copied` or `已复制`. Codex reads the
clipboard, calls `codex_lark_configure`, then runs `codex_lark_check_auth` and
`codex_lark_verify_setup`. Do not send App Secret to a Feishu/Lark group chat.
After the Feishu/Lark Event Configuration and Callback Configuration pages are
verified and published, return to Codex and explicitly approve connecting the
current conversation.

Private config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

After Codex confirms the current conversation is connected to Lark Remote, send
`whoami` to the bot from Feishu/Lark, then paste the returned `senderId` back
into Codex and ask it to update `lark.allowedUsers`. Project/session takeover
stays blocked until `allowedUsers` is non-empty.
The `whoami` reply includes an `allowedUsers: ["..."]` line you can paste back
directly.

`startup.receiveId` is an optional proactive target. When configured, the bridge
sends a startup intro card after the first successful Feishu/Lark
connection or handoff activation. When it is not configured, the first allowed
Feishu/Lark message supplies the current `chat_id`, receives the intro once,
and becomes the default target for later bridge starts. If card delivery fails,
the bridge falls back to a text intro. The sent marker and last remembered chat
are stored in `~/.codex-lark-remote/startup-notice.json`; set `startup.once` to
`false` while debugging.

The bridge will not start until `appId` and `appSecret` are configured.

## Start From Codex

From a trusted Codex conversation, say:

```text
Start codex-lark-remote.
```

Codex must ask for explicit consent before starting the bridge. After consent,
the plugin stores local routing state for this Codex thread in the local bridge.
Existing chat history is not sent to Feishu/Lark.

When a specific Codex thread is attached, handoff is strict about that
session/window. It uses the exact thread id or session path provided by Codex
for this tool call. After the bridge is connected, Feishu/Lark can choose other
allowed local sessions from the console.

On macOS, handoff also starts `caffeinate -dimsu` so the display may turn off
while the Mac stays awake. The keep-awake process is stopped when handoff or the
bridge stops.

## Take over Codex sessions from Feishu/Lark

Feishu/Lark controls target selection with `takeover` or `windows`.
Full-project takeover requires `lark.allowedUsers`; if the
allowlist is empty, the bot refuses to list projects or execute takeover. The
bot first shows local Codex projects, then the sessions/windows inside the chosen
project, including the session that started takeover. This is based on local
Codex session records, not macOS window handles. Use **Observe** for
read-only progress streaming, or **Takeover** to open confirmation before
handoff. If cards are unavailable, reply `1`, `2`, `3`, etc. to choose a
project, then a session, then send `takeover now`.
Active sessions attach after they become idle.

## Observe another Codex session

Observation is read-only and separate from handoff. `observe` lists
observable Codex sessions. `observe <number>` or
`observe <thread-prefix>` streams progress from the selected session into
Feishu/Lark. Feishu/Lark messages are not sent to the observed session. Use
`observe off` to stop observing.

## Feishu/Lark output

Remote replies are optimized for coding on a phone or in chat:

- No `Codex progress` title is added to progress messages.
- Internal task ids are not shown in normal progress replies.
- Long replies are split into multiple Feishu/Lark messages.
- Normal shell commands and `Output:` are hidden by default.
- Use `commands on` or say "show commands" to enable command display.
  Use `commands off` to hide them again.
- Potentially risky commands are always shown with a `Warning:` line, even when
  normal command display is off.
- When command display is on, command `Output:` is still limited to one
  high-signal line with line/character counts when more content was omitted.
- Source/code inspection output is summarized when it comes from commands such
  as `cat`, `nl`, `sed`, `grep`, or ordinary `rg` searches.
- Secrets in command text are redacted before they are sent to Feishu/Lark.

## Permission boundaries

Lark Remote takes over the conversation stream, not the native Codex
Desktop UI. Feishu/Lark cannot click permission dialogs, MCP approvals,
sandbox-escalation prompts, network/install approvals, or other native Codex UI
popups.

When Codex hits one of those boundaries, the bridge and prompt contract ask the
agent to send a clear Feishu/Lark message instead of waiting silently. The
message explains what permission is needed and whether you must approve it in
Codex Desktop on the Mac or can reply in Feishu/Lark with explicit text consent.

## Mid-run guidance

If you send another Feishu/Lark message while Codex is still working, the plugin
does not try to hot-inject text into the already running Codex process. Instead,
it stores the message as supplemental guidance for the same handoff thread,
acknowledges it in Feishu/Lark, and runs it as the next turn as soon as the
current turn finishes.

## Mac keep-awake

Enabled by default:

```json
{
  "handoff": {
    "keepAwake": true,
    "keepAwakeCommand": "caffeinate",
    "keepAwakeArgs": ["-dimsu"]
  }
}
```

Set `handoff.keepAwake` to `false` in `~/.codex-lark-remote/config.json` to turn
this off. This feature is macOS-only.

## Troubleshooting

`codex_lark_*` tools are missing:

The plugin MCP server is not loaded in this Codex conversation. Refresh or
re-enable the plugin, then start a new Codex conversation. Normal startup should
not fall back to local scripts.

`status` says `websocket disabled`:

Check `~/.codex-lark-remote/config.json` and confirm that `appId` and
`appSecret` are present.

The same Feishu/Lark message gets two replies:

Stop any stale bridge process or duplicate plugin installation, then start
handoff again.

Codex edits the plugin cache instead of your project:

Start handoff from a Codex conversation whose working directory is the project
you want Codex to edit.

## Local development

Register this repository as a local marketplace:

```toml
[marketplaces.gxfn]
source_type = "local"
source = "/absolute/path/to/codex-lark-remote"

[plugins."codex-lark-remote@gxfn"]
enabled = true
```

Run tests:

```text
npm test
```

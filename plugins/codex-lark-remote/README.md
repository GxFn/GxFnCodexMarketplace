# Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Marketplace page: [codex-lark-remote](https://www.codex-marketplace.com/plugins/codex-lark-remote)

This README ships inside the installable Codex plugin bundle. The repository
homepage also has a full first-time user guide.

## Default flow

Lark Remote is designed around one default flow: start from an active
Codex conversation, approve handoff, then continue that same conversation from
Feishu/Lark.

Feishu/Lark messages are passed to Codex as normal user messages. The bot sends
back the final Codex answer and useful progress while work is running.

## Start With The Console

The Feishu/Lark side has one main entry point: the natural-language console.
After the bridge is connected, send `console` or click **Console** on the
startup card.

In the console, use short phrases:

```text
console
project list
session list
open project 1
observe session 2
takeover 1
```

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
2. In Codex, start Lark Remote from the conversation you want to continue.
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
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote --plugin
```

If Codex asks for a GitHub target or direct artifact path, use:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.2.1/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.2.1

Sparse path:
plugins/codex-lark-remote
```

Enable `codex-lark-remote` from the plugin list after installation.

To add the whole `gxfn` repository marketplace instead of only this plugin, use
the repository root with an empty sparse path. Use `main` only when you want
unreleased changes.

## Configure Feishu/Lark

Create a Feishu/Lark app:

1. Open [Feishu Open Platform](https://open.feishu.cn/) or
   [Lark Open Platform](https://open.larksuite.com/).
2. Create an internal/custom app.
3. Enable the bot capability.
4. Copy **App ID** and **App Secret** from **Credentials & Basic Info**.
5. In **Event Subscriptions**, choose long connection/WebSocket and subscribe to
   `im.message.receive_v1` and `card.action.trigger`.
6. In **Callback Configuration**, keep **receive callbacks through long
   connection** selected. If you switch to webhook mode, configure
   `/bridge/lark/event` as the callback URL and keep verification token /
   encrypt key in sync.
7. Enable the message receive, send/reply, and card interaction callback
   permissions requested by the platform, then publish or enable the app for
   your tenant.

Startup intro cards and takeover buttons require `card.action.trigger`. If text
messages work but card buttons do nothing, verify that the app is published,
`card.action.trigger` is subscribed, callback mode is still long connection, and
the app was republished after permission changes.

Paste the values into a trusted local Codex chat:

```text
Please configure codex-lark-remote.

Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: ["ou_xxx"]

Optional takeover tuning:
- takeover: { projectLimit: 20, selectionTtlMs: 600000 }

Optional startup intro:
- startup: { receiveId: "oc_xxx", receiveIdType: "chat_id", once: true }

Please call codex_lark_configure with these values, then run
codex_lark_check_auth.
```

Private config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

If you do not know your sender id, leave `allowedUsers` empty at first, send
`whoami` to the bot, then add the returned `senderId`.

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

In the Codex conversation you want to continue from Feishu/Lark, say:

```text
Start codex-lark-remote.
```

Codex must ask for explicit consent before starting handoff. After consent, the
plugin stores local routing state for the current Codex thread in the local
bridge. Existing chat history is not sent to Feishu/Lark.

Handoff is strict about the current Codex session/window. It uses the exact
thread id or session path provided by Codex for this tool call. If that
per-session metadata is not available, handoff is blocked instead of guessing by
workspace path.

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

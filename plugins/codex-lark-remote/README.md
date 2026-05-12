# Codex Lark Remote

Continue the current Codex conversation from Feishu/Lark.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Marketplace page: [codex-lark-remote](https://www.codex-marketplace.com/plugins/codex-lark-remote)

This README ships inside the installable Codex plugin bundle. The repository
homepage also has a full first-time user guide.

## Default flow

Codex Lark Remote is designed around one default flow: start from an active
Codex conversation, approve handoff, then continue that same conversation from
Feishu/Lark.

Feishu/Lark messages are passed to Codex as normal user messages. The bot sends
back the final Codex answer and useful progress while work is running.

## Install

Install from the approved Codex Marketplace artifact:

```bash
npx codex-marketplace add GxFn/codex-lark-remote/plugins/codex-lark-remote --plugin
```

For the pinned reviewed release:

```bash
npx codex-marketplace add https://github.com/GxFn/codex-lark-remote/tree/v0.1.24/plugins/codex-lark-remote --plugin
```

If Codex asks for a GitHub target or direct artifact path, use:

```text
https://github.com/GxFn/codex-lark-remote/tree/v0.1.24/plugins/codex-lark-remote
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
https://github.com/GxFn/codex-lark-remote.git

Git ref:
v0.1.24

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
   `im.message.receive_v1`.
6. Enable the message receive/reply permissions requested by the platform, then
   publish or enable the app for your tenant.

Paste the values into a trusted local Codex chat:

```text
Please configure codex-lark-remote.

Feishu/Lark app:
- appId: cli_xxx
- appSecret: xxx

Allowed users:
- allowedUsers: ["ou_xxx"]

Please call codex_lark_configure with these values, then run
codex_lark_check_auth.
```

Private config is stored outside the repository:

```text
~/.codex-lark-remote/config.json
```

If you do not know your sender id, leave `allowedUsers` empty at first, send
`/codex whoami` to the bot, then add the returned `senderId`.

The bridge will not start until `appId` and `appSecret` are configured.

## Start handoff

In the Codex conversation you want to continue from Feishu/Lark, say:

```text
Start codex-lark-remote.
```

Codex must ask for explicit consent before starting handoff. After consent, the
plugin stores local routing state for the current Codex thread in the local
bridge. Existing chat history is not sent to Feishu/Lark.

Handoff is strict about the current Codex window. It uses the exact thread id or
session path provided by Codex for this tool call. If that per-window metadata is
not available, handoff is blocked instead of guessing by workspace path.

Then send normal messages to the Feishu/Lark bot. They will continue the same
Codex conversation.

On macOS, handoff also starts `caffeinate -dimsu` so the display may turn off
while the Mac stays awake. The keep-awake process is stopped when handoff or the
bridge stops.

Useful commands:

```text
/codex whoami
/codex status
/codex observe
/codex observe <number|thread-prefix>
/codex observe off
/codex commands on
/codex commands off
/codex handoff off
```

Plain language requests such as "disconnect" or "stop handoff" are also handled.

## Observe another Codex session

Observation is read-only and separate from handoff. `/codex observe` lists
observable Codex sessions. `/codex observe <number>` or
`/codex observe <thread-prefix>` streams progress from the selected session into
Feishu/Lark. Feishu/Lark messages are not sent to the observed session. Use
`/codex observe off` to stop observing.

## Feishu/Lark output

Remote replies are optimized for coding on a phone or in chat:

- No `Codex progress` title is added to progress messages.
- Internal task ids are not shown in normal progress replies.
- Long replies are split into multiple Feishu/Lark messages.
- Normal shell commands and `Output:` are hidden by default.
- Use `/codex commands on` or say "show commands" to enable command display.
  Use `/codex commands off` to hide them again.
- Potentially risky commands are always shown with a `Warning:` line, even when
  normal command display is off.
- When command display is on, command `Output:` is still limited to one
  high-signal line with line/character counts when more content was omitted.
- Source/code inspection output is summarized when it comes from commands such
  as `cat`, `nl`, `sed`, `grep`, or ordinary `rg` searches.
- Secrets in command text are redacted before they are sent to Feishu/Lark.

## Permission boundaries

Codex Lark Remote takes over the conversation stream, not the native Codex
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

`/codex status` says `websocket disabled`:

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

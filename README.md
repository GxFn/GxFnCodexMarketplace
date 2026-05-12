# GxFn Codex Marketplace

Aggregated Codex plugin marketplace for GxFn plugins.

Installing this marketplace makes all listed GxFn plugins available together in Codex instead of replacing one plugin repository with another under the same marketplace id.

## Install

```bash
codex plugin marketplace add GxFn/GxFnCodexMarketplace --ref main
```

In the Codex UI, use:

```text
Source: GxFn/GxFnCodexMarketplace
Git ref: main
Sparse path: leave empty
```

## Included Plugins

- Alembic: local project memory, Recipes, Guard checks, and recoverable bootstrap jobs for Codex.
- Codex Lark Remote: continue a Codex conversation from Feishu/Lark chat.

## Development

The plugin directories are vendored release snapshots:

```bash
plugins/alembic-codex
plugins/codex-lark-remote
```

Codex does not initialize Git submodules when adding a marketplace from Git, so this repository intentionally vendors the installable plugin roots instead of tracking them as submodules. When a plugin repository is released, refresh the corresponding directory, verify the marketplace in Codex, then commit the snapshot update here.

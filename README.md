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

The plugin repositories are tracked as Git submodules:

```bash
git submodule update --init --recursive
```

When a plugin repository is released, update the corresponding submodule pointer, verify the marketplace in Codex, then commit the pointer change here.

Note: `codex-lark-remote` is a workspace repository, so its Codex plugin root is `plugins/codex-lark-remote/plugins/codex-lark-remote`.

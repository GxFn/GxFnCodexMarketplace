# Alembic Codex Plugin

Alembic for Codex gives Codex local project memory without turning every chat into a setup session. It starts with a lightweight MCP shim, reports diagnostics and workspace status without initializing the database, initializes in Ghost mode by default, then starts or connects to the per-workspace daemon only when project knowledge, Guard, Dashboard, bootstrap, or rescan work is requested.

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Use it when you want Codex to:

- Prime itself with project Recipes before coding.
- Run Guard checks against the current change.
- Build or refresh project knowledge through recoverable daemon jobs.
- Open the local Dashboard only when a visual handoff is useful.

## Install

Install this repository as a Codex plugin marketplace:

```bash
codex plugin marketplace add GxFn/AlembicCodex --ref main
```

For a pinned release after the matching Git tag exists:

```bash
codex plugin marketplace add GxFn/AlembicCodex --ref v0.1.0
```

If Codex asks for a GitHub target or direct artifact path, use:

```text
GxFn/AlembicCodex
```

If the Codex dialog separates source, ref, and sparse path, fill it like this:

```text
Source:
GxFn/AlembicCodex

Git ref:
main

Sparse path:
leave empty
```

Enable `alembic-codex` from the plugin list after installation.

## Runtime

- Node.js 22 or newer is required. Node 22 LTS is recommended for local development; keep the MCP shim and daemon on the same Node executable.
- The plugin ships Alembic business runtime code in `./runtime`; that embedded package is `alembic-ai@0.1.0`.
- The marketplace MCP config runs `npx --package ./runtime alembic-codex-mcp`, so `npx` installs the plugin-local runtime package and resolves its production npm dependencies instead of downloading Alembic code from the registry.
- The marketplace MCP config sets `ALEMBIC_CHANNEL_ID=codex`; project feature checks should use that stable channel id.
- The marketplace MCP config explicitly sets `ALEMBIC_MCP_MODE=1` and `ALEMBIC_CODEX_MCP_MODE=1`; the binary still applies the same defaults as a safety net.
- The MCP launch command runs `npx` with `--prefix /tmp` so dependency installation does not write into the installed plugin directory.
- The MCP environment sets `npm_config_cache=/tmp/alembic-codex-npm-cache` so a broken or root-owned user npm cache cannot block plugin startup.
- The default MCP tier is `agent`; admin tools stay hidden unless both `ALEMBIC_MCP_TIER=admin` and `ALEMBIC_CODEX_ENABLE_ADMIN=1` are set.

## First Checks

Use `alembic_codex_diagnostics` first. It reports Node, npm, npx, package version, daemon version, plugin metadata checks, offline fallback guidance, cleanup policy, and structured `issues` / `nextActions`.

Use `alembic_codex_status` to inspect workspace initialization and daemon state without starting the daemon. The response includes an `onboarding` block with a concise state, primary recommended tool call, whether that call starts the daemon, and follow-up actions.

Outside Codex, the same runtime checks are available from the CLI:

```bash
alembic codex diagnostics --json
alembic codex status --json
```

The normal first minute is:

1. `alembic_codex_diagnostics`
2. `alembic_codex_status`
3. `alembic_codex_init` when status reports `needs_init`
4. `alembic_codex_bootstrap` for first project knowledge, or `alembic_task` with `operation=prime` before coding work

## Long-Running Jobs

`alembic_codex_bootstrap` and `alembic_codex_rescan` return a durable job id immediately. Use `alembic_codex_job` with that id to resume status checks after Codex reconnects or the Dashboard refreshes.

If the Alembic daemon shuts down or restarts before an active job completes, the next daemon lifecycle marks that job as `failed` with an interruption reason instead of leaving it stuck in `queued` or `running`. Start a new bootstrap or rescan job to retry.

## Release Verification

Before publishing, run:

```bash
npm run release:codex-plugin
```

The release check builds the runtime and Dashboard, prepares `plugins/alembic-codex/runtime`, verifies the local Codex marketplace entry, validates the embedded MCP runtime package, checks the lightweight `alembic-codex-mcp` binary, default agent tier, disabled admin gate, declared assets, shipped skills, default prompts, README runtime fallback, package tarball contents, local install simulation, and real MCP stdio calls.

For the full local daemon path, run:

```bash
npm run release:codex-plugin:daemon
```

That optional variant also starts the daemon on a temporary localhost port and verifies interrupted job recovery. `prepublishOnly` runs `release:codex-plugin`.

After release checks pass, commit and push any changed plugin files from inside this submodule, then commit the updated `plugins/alembic-codex` pointer in the Alembic monorepo.

For the full release, testing, and promotion plan, see [RELEASE-PLAYBOOK.md](./RELEASE-PLAYBOOK.md).

## Local Marketplace

This distribution repository includes `.agents/plugins/marketplace.json` so Codex can add the repository itself as a plugin marketplace. The marketplace is named `alembic-codex`, the single entry points to `.`, installation is `AVAILABLE`, and authentication is `ON_INSTALL`.

Register this repository as a local marketplace during development:

```toml
[marketplaces.alembic-codex]
source_type = "local"
source = "/absolute/path/to/AlembicCodex"

[plugins."alembic-codex@alembic-codex"]
enabled = true
```

The Alembic monorepo still keeps its local development marketplace at `.agents/plugins/marketplace.json`, named `gxfn`, pointing to `./plugins/alembic-codex`.

`npm run smoke:codex-plugin` packages the runtime, resolves this marketplace entry from the packed tarball, copies the plugin into a temporary install root, validates the installed manifest, embedded `./runtime` package, MCP config, assets, skills, and stdio MCP calls.

## Offline Fallback

The default plugin config launches the embedded `./runtime` package through `npx`. If the first run cannot reach the npm registry to resolve production dependencies, install the same runtime version globally and run the MCP binary from `PATH`:

```bash
npm install -g alembic-ai@0.1.0
alembic-codex-mcp
```

## Cleanup Policy

Uninstalling the plugin never removes Alembic data automatically. Use `alembic_codex_cleanup` for an explicit cleanup flow. The default call is a dry run; `confirm=true` only removes daemon runtime state, logs, locks, and job files. Knowledge, Recipes, candidates, and project data are left intact.

# lisa-monorepo

The Lisa monorepo is the primary ingestion source for this wiki.

## Repository

- Local path: `.`
- Remote: `git@github.com:CodySwannGT/lisa.git`
- Branch at initial ingestion: `fix/audit-exclusions-load-set-e`
- HEAD at initial ingestion: `610f410cb4955734365acdcd1c94e5a74edcbfc0`
- Full fetched commit count across refs: 1814
- Merged PRs captured: 425

## Package

- Package name: `@codyswann/lisa`
- Version at ingestion: `2.16.3`
- CLI binary: `lisa`
- Package manager: Bun

## Current Snapshot

- Ingest branch: `wiki/ingest-2026-05-29-093858` created from synced `origin/main`
- HEAD at 2026-05-29 incremental ingest: `f9999af37312b136cd52edd169564a04d85a7a42`
- Current package version: `2.124.2`
- Total commits on HEAD: 2569
- Latest merged PR captured in the incremental git snapshot: `#1066`
- New commits since the previous incremental git cursor: `9`
- Project-scoped memory skipped this cycle because no Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- Release automation advanced the monorepo to `2.124.2`.
- The automation checkout fetched `origin` and rebased the existing wiki branch onto `origin/main` without conflicts before this 2026-05-29 ingest.
- The previous same-day git source note was preserved as `wiki/sources/git/2026-05-29-133933-lisa-monorepo-git.md` before refreshing the current `2026-05-29` connector note.
- Agy parity hardening delivered runtime-correct native MCP and hook behavior: agy MCP now installs through the user-global `~/.gemini/config/mcp_config.json` path, plugin-bundled hooks use root-level `hooks.json`, and stale plugin-bundled MCP / subdirectory hook shapes were removed from generated artifacts.
- The agy plugin generator now tolerates missing optional source material and cleanup paths, and the agy hook command resolves against the installed plugin directory name.
- Claude Remote routine readiness work added `/lisa:analyze-claude-remote` and `/lisa:generate-claude-remote-build-script` from `plugins/src/base`, with generated `lisa`, Cursor, agy, and Copilot variants. The audit inventories cloud-session requirements such as CLIs, environment variable names, startup hooks, MCP scope and auth, user-scoped config gaps, and network constraints; the generator writes an idempotent setup script, env-var template, and domain allowlist for Claude Code remote routine environments.
- Coding-agent parity work shipped per-agent plugin variant generation, Codex plugin-bundled hook corrections, Copilot probe cache evidence, and `lisa apply --harness fleet` dispatch fixes.
- The Pattern B fan-out now covers every built Claude plugin, producing cursor, agy, and copilot variants for the base plugin plus stack and standalone plugins.
- Agy rule delivery now resolves rules the same way as `inject-rules.sh`: prefer `rules/eager/`, then fall back to flat `rules/`, leaving only `rules/reference/` on-demand.
- Expo support advanced to SDK 56 and `/src` directory conventions, including Jest, ESLint, prettier, knip, and documentation updates.

## Workspace Packages

| Path | Package |
| --- | --- |
| eslint-plugin-code-organization | @codyswann/eslint-plugin-code-organization |
| eslint-plugin-component-structure | @codyswann/eslint-plugin-component-structure |
| eslint-plugin-ui-standards | @codyswann/eslint-plugin-ui-standards |

## Source Notes

- `wiki/sources/repository/2026-05-14-monorepo-baseline.md`
- `wiki/sources/github/2026-05-14-git-and-pr-history.md`
- `wiki/sources/git/2026-05-25-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-26-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-27-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-28-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-094151-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-133933-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-lisa-monorepo-git.md`
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/memory/2026-05-28-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`
- `wiki/sources/roles/2026-05-28-roles.md`
- `wiki/sources/roles/2026-05-29-094151-roles.md`
- `wiki/sources/roles/2026-05-29-roles.md`

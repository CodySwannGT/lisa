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

- Ingest branch: `wiki/ingest-2026-05-30-134237` created from synced `origin/main`
- HEAD at 2026-05-30 incremental ingest: `c162e448b8589392b572843a641147ebddaf2e53`
- Current package version: `2.125.0`
- Total commits on HEAD: 2608
- Latest merged PR captured in the incremental git snapshot: `#1077`
- New commits since the previous incremental git cursor: `7`
- Project-scoped memory skipped this cycle because no Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- Release automation advanced the monorepo to `2.125.0`.
- The automation checkout fetched `origin`, rebased the current branch onto `origin/main` without conflicts, and created `wiki/ingest-2026-05-30-134237` before this 2026-05-30 ingest.
- PR `#1077` introduced the Lisa-internal 3rd-party plugin parity subsystem for classifying curated Claude plugins across Codex, Cursor, agy, and Copilot, using approved routing artifacts, deterministic implementation, and drift detection for reimplemented skills.
- PR `#1076` merged the prior wiki ingestion through Lisa `2.124.11`.
- PR `#1075` merged the earlier wiki ingestion through Lisa `2.124.10`.
- PR `#1074` merged the wiki ingestion through Lisa `2.124.8`.
- PR `#1073` fixed the Copilot plugin variant for issue `#1056`: unsupported `subagentStart` hook entries are stripped so Copilot does not reject the entire inline hook config, bundled `.mcp.json` content is emitted as an inline `mcpServers` object, and the generator now skips invalid or empty `mcpServers` shapes.
- PR `#1072` merged the prior wiki ingestion through Lisa `2.124.7`.
- PR `#1068` merged the prior wiki ingestion through Lisa `2.124.2`.
- PR `#1069` completed the Cursor plugin-shape correction for issue `#1055`, including flat `.mdc` rules, Cursor hook artifact regression coverage, and the dedicated Cursor plugin artifact tests.
- PR `#1070` corrected Cursor hook command paths to use `${CURSOR_PLUGIN_ROOT}` instead of cwd-relative paths.
- PR `#1071` documented the auto-merge ancestry rule used to avoid enabling auto-merge on PRs whose head is no longer based on the current target branch.
- PR `#1067` fixed Codex hook emission so Codex-specific hook metadata lives under `.codex-plugin/`, preventing Claude startup from reading Codex-shaped hook files.
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
- `wiki/sources/git/2026-05-29-213947-previous-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-30-094116-previous-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-2026-05-30-134245.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git.md`
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/memory/2026-05-28-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`
- `wiki/sources/roles/2026-05-28-roles.md`
- `wiki/sources/roles/2026-05-29-094151-roles.md`
- `wiki/sources/roles/2026-05-29-213947-previous-roles.md`
- `wiki/sources/roles/2026-05-29-roles.md`
- `wiki/sources/roles/2026-05-30-roles-previous-2026-05-30-134245.md`
- `wiki/sources/roles/2026-05-30-roles.md`

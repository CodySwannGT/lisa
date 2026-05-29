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

- Ingest branch: `wiki/ingest-2026-05-28-133543` rebased onto `origin/main`
- HEAD at 2026-05-29 incremental ingest: `ecb6a093d767203add54de4d0d703783c80abda0`
- Current package version: `2.123.2`
- Total commits on HEAD: 2554
- Latest merged PR captured in the incremental git snapshot: `#1053`
- New commits since the previous incremental git cursor: `71`
- Project-scoped memory skipped this cycle because the only available Claude memory directory was scoped to `/Users/cody/workspace/lisa`, not this automation checkout; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- Release automation advanced the monorepo to `2.123.2`.
- The prior local connector-ingest commit was rebased onto current `origin/main`, preserving the 2026-05-28 connector cursor before this 2026-05-29 ingest advanced it again.
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
- `wiki/sources/git/2026-05-29-lisa-monorepo-git.md`
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/memory/2026-05-28-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`
- `wiki/sources/roles/2026-05-28-roles.md`
- `wiki/sources/roles/2026-05-29-roles.md`

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

- Ingest branch: `wiki/ingest-2026-05-28-013419` from `origin/main`
- HEAD at 2026-05-28 incremental ingest: `3e99859c0c73e29c341c441f2c34976f4fab2806`
- Current package version: `2.116.0`
- Total commits on HEAD: 2466
- Latest merged PR captured in the incremental git snapshot: `#1035`
- New commits since the previous incremental git cursor: `6`
- Project-scoped memory files captured: `22` from the Lisa Claude project memory directory; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- The previous wiki ingest PR merged, advancing the wiki cursor through PR `#1034`.
- Release automation advanced the monorepo to `2.116.0`.
- Lisa added a base rule that makes `wiki/` the durable knowledge source for wiki work while preserving `docs/`, `research/`, `docs/wiki-inbox/`, and `transcripts/` as possible ingestion inputs or evidence locations.
- The new documentation-source-path guidance reinforces that successful ingestions preserve reader-safe evidence under `wiki/sources/` and record runs in `wiki/log.md`.

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
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/memory/2026-05-28-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`
- `wiki/sources/roles/2026-05-28-roles.md`

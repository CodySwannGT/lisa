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

- Ingest branch: `wiki/ingest-2026-05-26-173027` from `origin/main`
- HEAD at 2026-05-26 incremental ingest: `1d85bcb3acff15cdf89216c81ceb7efe975b1565`
- Current package version: `2.106.0`
- Total commits on HEAD: 2372
- Latest merged PR captured in the incremental git snapshot: `#971`
- New commits since the previous incremental git cursor: `292`

## Recent Changes Since The 2026-05-14 Baseline

- Wiki operations gained status/freshness surfaces, source freshness parsing, read-only status verification, and distribution parity coverage.
- Queue and intake automation hardened around unsupported vendor readers, default GitHub reader labels, invalid PRD role overrides, verified PRD closure, and missing build lifecycle namespaces.
- CI and GitHub automation improved author-association gating, loop-guard issue handling, automation-status fleet matching, and Claude schedule cadence normalization.
- Council and usage-accounting fixes continued, including guarded workspace handling, executor exceptions, non-dry-run council execution, currency rollups, and decimal/cost token handling.
- Release automation continued its rapid cadence, advancing the monorepo from `2.100.1` through `2.106.0` during this incremental window.

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
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`

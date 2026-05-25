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

- Ingest branch: `wiki/ingest-2026-05-25` from `origin/main`
- HEAD at 2026-05-25 incremental ingest: `45c1d709337ba550d4e589fab1ea1f6ad6642cc3`
- Current package version: `2.63.1`
- Total commits on HEAD: 1841
- Total merged PRs captured from GitHub: 518
- Merged PRs since the 2026-05-14 baseline ingestion: 90

## Recent Changes Since The 2026-05-14 Baseline

- Wiki operations now include native automation setup and teardown flows, and the ingest workflow itself now standardizes a pre-ingest branch sync plus PR auto-merge.
- PRD lifecycle coverage expanded with a durable `verified` state, `verify-prd` PASS and FAIL paths, idempotent reruns, and broader rollup propagation across trackers.
- Build intake behavior hardened around blocker holds, ready-container repair, repo-scoped claiming for multi-repo trackers, and implementation rebases to the ticket's target-environment branch.
- Codex artifact generation and distribution checks continued to expand across skill metadata, `openai.yaml` emission, byte-stability tests, and plugin registration/distribution safeguards.

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
- `wiki/sources/roles/2026-05-25-roles.md`

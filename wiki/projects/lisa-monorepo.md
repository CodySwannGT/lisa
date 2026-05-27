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

- Ingest branch: `wiki/ingest-2026-05-27-173325` from `origin/main`
- HEAD at 2026-05-27 incremental ingest: `9e52f0d12bc01a85754f30b5ec70c97e6204bfab`
- Current package version: `2.113.0`
- Total commits on HEAD: 2441
- Latest merged PR captured in the incremental git snapshot: `#1017`
- New commits since the previous incremental git cursor: `44`
- Project-scoped memory files captured: `21` from the last successful memory ingest; this run skipped memory because the connector could not prove the available memory directory matched this worktree path.

## Recent Changes Since The 2026-05-14 Baseline

- The previous wiki ingest PR merged, advancing the wiki cursor through PR `#999`.
- Release automation advanced the monorepo to `2.113.0`.
- Lisa added Expo-specific skills and an Expo MCP server to the shipped plugin surface.
- Wiki query is now the primary rule-backed way for agents to answer project questions from durable wiki knowledge.
- Exploratory QA split into a human-experience pass and an e2e-coverage-gaps pass so product-facing findings and automation backlog gaps stay distinct.
- Repair intake now uses a two-hour stuck threshold and records PR/deploy blocker diagnosis for stale work.
- Project ideation automation now records durable run ledgers, including PRD and thread ideation metadata plus an idempotency harness.
- Nested team orchestration now adds specialists instead of collapsing nested flows to a single agent.
- TypeScript template rules block error-suppression directives on edit across Claude and Codex surfaces.
- Postinstall local installs re-enabled crash-safe template apply behavior.

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
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`

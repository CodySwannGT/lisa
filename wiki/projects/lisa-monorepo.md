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

- Ingest branch: `wiki/ingest-2026-05-27-213503` from `origin/main`
- HEAD at 2026-05-27 incremental ingest: `6dbfeb7ec507cfbb56bc905db47ea14f5bce9762`
- Current package version: `2.115.3`
- Total commits on HEAD: 2460
- Latest merged PR captured in the incremental git snapshot: `#1033`
- New commits since the previous incremental git cursor: `19`
- Project-scoped memory files captured: `22` from the Lisa Claude project memory directory; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- The previous wiki ingest PR merged, advancing the wiki cursor through PR `#1018`.
- Release automation advanced the monorepo to `2.115.3`.
- Wiki setup now treats the standard digital-staff roster as the default seed for new wiki setup flows.
- Queue-status and project ideation added a PRD pressure helper so auto-ready PRDs are blocked when the build queue is already under pressure.
- PRD pressure edge cases are covered by fixtures and the pressure gate is documented for ideation operators.
- Project-scoped memory now records Lisa hook-delivery semantics: Claude plugin hooks track the GitHub marketplace on `main`, while Codex hooks arrive through `lisa apply`.

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

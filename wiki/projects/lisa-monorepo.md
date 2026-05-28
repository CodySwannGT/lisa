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

- Ingest branch: `wiki/ingest-2026-05-28-133543` from `origin/main`
- HEAD at 2026-05-28 incremental ingest: `13d703327a00a157f1c9e8d546ec1c30df62c797`
- Current package version: `2.119.0`
- Total commits on HEAD: 2483
- Latest merged PR captured in the incremental git snapshot: `#1040`
- New commits since the previous incremental git cursor: `17`
- Project-scoped memory skipped this cycle because no memory directory was provably scoped to `/Users/cody/.codex/worktrees/lisa-automation-main`; unrelated Claude project memory and global Codex memory remain out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- The previous wiki ingest PR merged, advancing the wiki cursor through PR `#1036`.
- Release automation advanced the monorepo to `2.119.0`.
- Lisa added a CLI package-version update check and hardened its cached-version handling by validating semver and swallowing cache-write failures.
- Lisa wiki setup now merges a managed `.gitignore` block so wiki-local ignored files can be installed or repaired without clobbering project-owned ignore rules.
- Base rules were split into eager heads and reference bodies, with Codex and CI surfaces kept paired so agents can load concise always-on guidance while retaining full reference material.
- ESLint default ignores now include `wiki/**`, keeping the in-repository knowledge base out of normal code lint scope while the wiki keeps its own lint path.

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

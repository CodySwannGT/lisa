---
type: source
created: 2026-06-14
updated: 2026-06-14
related: []
sources: []
source_system: git
project: lisa-monorepo
---

# git history - lisa-monorepo (2026-06-14)

- Repo: `.`
- HEAD: `4bd9a9b749fa26376a5bfdd4d84cb1cb9fb51b93`
- Total commits on HEAD: 3167
- New commits since last ingest (`05853e6ce16319386f642adcc8a55fefbb3a0ec2`): 7
- Merged PRs since last cursor: `#1285`, `#1287`; latest #1287 "chore(security): exclude esbuild GHSA-gv7w-rqvm-qjhr from audit template"

## New commits

- 4bd9a9b7 - 2026-06-13 - chore(release): 2.165.6 [skip ci]
- 4f21d25a - 2026-06-13 - Merge pull request #1287 from CodySwannGT/chore/audit-exclude-esbuild
- c68a75ae - 2026-06-13 - chore(security): exclude esbuild GHSA-gv7w-rqvm-qjhr from audit template
- df3409fb - 2026-06-13 - chore(release): 2.165.5 [skip ci]
- b1dd966a - 2026-06-13 - Merge pull request #1285 from CodySwannGT/wiki/ingest-20260613T000000Z
- 61488cf1 - 2026-06-13 - fix(security): exclude esbuild GHSA-gv7w-rqvm-qjhr from audit
- 8f1b9dc9 - 2026-06-13 - docs(wiki): ingest Lisa wiki state

## Merged PRs captured

- #1287 - 2026-06-13T12:07:28Z - `chore/audit-exclude-esbuild` - chore(security): exclude esbuild GHSA-gv7w-rqvm-qjhr from audit template
- #1285 - 2026-06-13T06:59:45Z - `wiki/ingest-20260613T000000Z` - docs(wiki): ingest Lisa wiki state

## Changed surface

- Lisa advanced from `2.165.4` through `2.165.6`.
- The prior wiki ingestion PR merged after all CI and CodeRabbit checks passed.
- The shared TypeScript audit-ignore template now excludes `GHSA-gv7w-rqvm-qjhr` for the esbuild Deno install module advisory. The exclusion is scoped as a durable cross-project fix because Lisa-managed projects use esbuild as dev/build tooling through bun/npm dependency chains rather than the Deno install path, and the note should be removed once the transitive toolchain reaches esbuild `>=0.28.1`.

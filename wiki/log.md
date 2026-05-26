# Lisa Wiki Log

## 2026-05-14 - In-repository wiki setup

- Created the initial Lisa LLM Wiki structure inside the existing monorepo.
- Registered the monorepo itself as the primary project ingestion source.
- Preserved the existing repository and branch model rather than creating a wrapper repository.
- Recorded that `.mcp.json` currently configures Linear MCP only.

## 2026-05-14 - Initial repository and GitHub ingestion

- Ingested the Lisa monorepo working tree, docs, specs, plans, commands, rules, skills, templates, workflows, package metadata, and source structure.
- Captured full fetched commit history across refs and merged PR metadata from GitHub.
- Wrote source notes under `wiki/sources/repository/` and `wiki/sources/github/`.
- Synthesized Lisa architecture, template governance, workflow, requirements, vocabulary, project, and open-question pages.
- Advanced repository and GitHub state under `wiki/state/`.

## 2026-05-14 - Documentation migration and ingestion

- Moved durable root docs, docs workflows, and specs into `wiki/documentation/` so the wiki is the canonical documentation home.
- Preserved `docs/wiki-inbox/` as an ingestion inbox and left operational `plans/` and product/template `plugins/` markdown in place.
- Added documentation provenance under `wiki/sources/docs/` and advanced docs state under `wiki/state/docs/`.

## 2026-05-25 - Full connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25`, and ran a full no-argument ingest against every enabled non-external-write connector that was available.
- Ingested `git` into `wiki/sources/git/2026-05-25-lisa-monorepo-git.md` and `roles` into `wiki/sources/roles/2026-05-25-roles.md`.
- Skipped `memory` because no provably project-scoped memory directory was available for this repository in the current runtime.
- Updated the monorepo snapshot synthesis, refreshed `wiki/index.md`, and initialized incremental connector state under `wiki/state/git/` and `wiki/state/roles/`.

## 2026-05-25 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25-2`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 47 new commits through `362e4bf1248d47e406b19d56f2d3d8b27e7740c9` and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime.
- Updated the monorepo snapshot synthesis for the latest GitHub project-coordination, usage-accounting, intake-filtering, and release-history changes.

## 2026-05-25 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25-3844`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 65 new commits through `7a56fd065774adb22bcb7ff7857e1d89170f5f75`, advanced the merged-PR cursor to `#789`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because the only Codex memory store available in this runtime was the global `/Users/cody/.codex/memories`, which the project-scoped memory connector correctly refuses to ingest.
- Updated the monorepo snapshot synthesis for the latest council-planning, doctor-surface, GitHub build-intake, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-0130`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 31 new commits through `ea144c8b5ffbc29d5f42f35ec6daa2d3bdcbaaeb`, advanced the merged-PR cursor to `#812`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime; the isolated worktree path had no matching project memory, and global Codex memory remains out of scope.
- Updated the monorepo snapshot synthesis for the latest automation-status delivery, smoke coverage, operator documentation, and release-history changes.

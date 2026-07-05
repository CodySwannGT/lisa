---
name: lisa-wiki-ingest
description: Use when ingesting Lisa repository, GitHub, Linear, document, or transcript knowledge into the in-repository wiki.
---

# Lisa Wiki Ingestion Skill

Use this skill when ingesting Lisa repository, GitHub, Linear, document, or transcript knowledge into the in-repository wiki.

## Contract

Follow `wiki/schema/llm-wiki-contract.md`.

For every ingestion:

1. Preserve source notes under `wiki/sources/<source>/`.
2. Synthesize durable knowledge into stable wiki pages.
3. Update `wiki/index.md`.
4. Append `wiki/log.md`.
5. Advance `wiki/state/<source>/` only after source notes, synthesis, index, and log are complete.
6. Run verification checks.
7. Commit only the ingestion changes, push, open a PR targeting `main`, and enable auto-merge. If ingestion started on `main`, create a dedicated ingestion branch before committing.

## Initial Repository Ingestion

Initial ingestion should capture:

- README, wiki documentation, docs inbox files, specs, plans, package metadata, workflows, commands, skills, templates, and source structure.
- Full fetched git commit history across refs.
- Merged PR metadata through `gh` when available.
- Monorepo workspace package roles.
- Template family roles and strategy directories.
- CI/CD and quality gate workflows.
- Durable open questions and maintenance notes.

## Incremental Repository Ingestion

After initial ingestion, use state cursors to ingest:

- Commits since the last successful ingestion.
- Merged PRs since the last successful ingestion.
- Changed docs, specs, plans, workflows, commands, skills, templates, and source structure.

## Safety

- Keep wiki content scoped to Lisa.
- Do not copy unrelated client project source material into Lisa wiki pages.
- Do not preserve raw secrets, tokens, OAuth artifacts, or private credentials.
- Do not stage unrelated working tree changes.

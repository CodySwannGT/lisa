# Lisa Wiki Usage Skill

Use this skill when explaining how to query, browse, update, maintain, or contribute to the Lisa LLM Wiki.

## What This Wiki Is

This wiki is an in-repository markdown knowledge base for Lisa. It helps agents and humans answer questions about Lisa architecture, workflows, quality gates, templates, commands, skills, releases, and repo history.

## Where To Start

- `wiki/start-here.md` for orientation.
- `wiki/index.md` for the maintained map.
- `wiki/projects/registry.md` for the monorepo registry.
- `wiki/log.md` for ingestion history.
- `wiki/sources/` for provenance.
- `wiki/state/` for ingestion cursors.

## Good Questions To Ask

- What is Lisa and what problem does it solve?
- What are the major architecture layers?
- How do rules, skills, hooks, commands, and CI gates fit together?
- Which templates does Lisa install into downstream projects?
- How do copy-overwrite, create-only, merge, and package-lisa strategies differ?
- What changed in recent merged PRs?
- What should a new contributor read first?
- Which workflows enforce quality, release, and automation?

## Useful Actions To Request

- Ingest the latest repository commits and merged PRs.
- Ingest this design plan into the Lisa wiki.
- Ingest these meeting notes.
- Update the Lisa architecture overview from recent source changes.
- Summarize what changed since the last ingestion.
- Add this decision to the wiki.

## Contribution Rules

- Keep source notes and synthesis separate.
- Preserve provenance for ingested knowledge.
- Update `wiki/index.md` when creating or materially changing pages.
- Append `wiki/log.md` for every ingestion.
- Commit and push after each successful ingestion.

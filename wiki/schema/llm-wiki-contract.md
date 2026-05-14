# Lisa LLM Wiki Contract

This contract defines how Lisa knowledge is stored, updated, verified, and traced inside the Lisa monorepo.

## Source Of Truth

The durable source of truth is markdown under `wiki/`.

This repository is not a wrapper. The wiki shares the existing Lisa git repository and branch.

## Ingestion Inputs

Default ingestion inputs:

- The Lisa monorepo working tree and git history.
- GitHub merged pull request metadata for `CodySwannGT/lisa`.
- Repository docs, specs, plans, package metadata, workflows, commands, skills, templates, and source structure.
- Linear only when an available MCP tool is explicitly configured and a Linear ingestion is requested.
- `docs/wiki-inbox/` and `transcripts/` when the user provides local documents or meeting notes.

## Required Provenance

Every ingestion must write source notes before synthesis:

- Repository source notes: `wiki/sources/repository/`
- GitHub source notes: `wiki/sources/github/`
- Linear source notes: `wiki/sources/linear/`
- Document source notes: `wiki/sources/docs/`
- Transcript source notes: `wiki/sources/transcripts/`

Source notes should preserve enough information for a future reader to understand what was ingested, when, from where, and with what scope.

## Synthesis Categories

Durable knowledge belongs in stable category pages:

- `wiki/projects/`
- `wiki/architecture/`
- `wiki/requirements/`
- `wiki/decisions/`
- `wiki/playbooks/`
- `wiki/open-questions/`
- `wiki/concepts/`
- `wiki/entities/`

Do not use `wiki/log.md` as the only home for important knowledge.

## State

Ingestion cursors live under `wiki/state/`.

Advance state only after:

1. Source notes are written.
2. Synthesis pages are updated.
3. `wiki/index.md` is updated.
4. `wiki/log.md` is appended.
5. Verification passes.

## Verification

Before committing:

- `git diff --check` must pass.
- `wiki/` content must not include unrelated client project names or source material.
- No secrets, tokens, private keys, MCP OAuth artifacts, dependency directories, build outputs, coverage output, or generated distribution files may be staged.
- Existing unrelated working tree changes must remain unstaged unless the user explicitly requests otherwise.

## Commit And Push

After every successful ingestion, commit and push automatically to the current branch of the existing Lisa repository.

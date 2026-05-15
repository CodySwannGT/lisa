# Lisa Agent Instructions

This repository is the Lisa monorepo. It now also contains an in-repository git-native LLM Wiki under `wiki/`.

Before changing wiki structure, ingestion behavior, or setup conventions, read:

- `wiki/schema/llm-wiki-contract.md`
- `wiki/projects/registry.md`
- `README.md`
- `wiki/documentation/overview.md`

Codex skills for Lisa wiki work live under `.agents/skills/`.

## Core Rules

- Treat `wiki/` as the durable source of truth for Lisa project knowledge.
- Keep the wiki inside this existing monorepo; do not create a wrapper repository.
- Treat the monorepo itself as the primary repository ingestion input.
- Treat `docs/wiki-inbox/` and `transcripts/` as ingestion inboxes. After ingestion, preserve reader-safe source notes under `wiki/sources/`.
- Record every ingestion in `wiki/log.md`.
- Update `wiki/index.md` whenever creating or materially changing wiki pages.
- Preserve unrelated working tree changes. In particular, do not stage or modify `.lisa.workspaces.json` unless explicitly requested.
- Do not commit local secrets, MCP OAuth artifacts, tokens, private keys, dependency directories, build outputs, coverage output, or generated distribution files unless the user explicitly requests release artifacts.
- After every successful ingestion, verify, commit only the ingestion changes, push, open a PR targeting `main`, and enable auto-merge. If ingestion started on `main`, create a dedicated ingestion branch before committing.

## Lisa-Specific Notes

- Lisa is a Bun/TypeScript monorepo published as `@codyswann/lisa`.
- The repo includes workspace packages for ESLint plugins and template directories for supported project stacks.
- Existing `.mcp.json` configures Linear MCP. Do not add unrelated client MCPs to this repository.
- Claude is Lisa's production harness today. Codex support must improve without reducing Claude behavior, install flows, hooks, commands, agents, skills, settings, or tests.
- Whenever adding or changing Lisa features, keep the Claude and Codex implementations in parity where Codex has an equivalent surface. If a Claude behavior cannot be represented in Codex, document the gap in code comments, tests, or user-facing guidance instead of silently dropping it.

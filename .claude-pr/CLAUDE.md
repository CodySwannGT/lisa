# Lisa Claude Instructions

This repository is the Lisa monorepo. Durable LLM Wiki knowledge lives in `wiki/`.

Before changing wiki structure or ingestion behavior, read:

- `wiki/schema/llm-wiki-contract.md`
- `wiki/projects/registry.md`
- `README.md`
- `wiki/documentation/overview.md`

Claude skills for Lisa wiki work live under `.claude/skills/`.

Core rules:

- Keep the wiki inside this existing monorepo.
- Treat the monorepo itself as the primary ingestion source.
- Record every ingestion in `wiki/log.md`.
- Update `wiki/index.md` when creating or materially changing wiki pages.
- Preserve unrelated working tree changes.
- Do not stage local secrets, dependency directories, build output, coverage output, or generated distribution files unless explicitly requested.
- Commit and push after each successful ingestion.
- Claude is Lisa's production harness today. Codex support must improve without reducing Claude behavior, install flows, hooks, commands, agents, skills, settings, or tests.
- Whenever adding or changing Lisa features, keep the Claude and Codex implementations in parity where Codex has an equivalent surface. If a Claude behavior cannot be represented in Codex, document the gap in code comments, tests, or user-facing guidance instead of silently dropping it.

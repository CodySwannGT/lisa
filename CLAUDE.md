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
- After each successful ingestion, verify, commit only the ingestion changes, push, open a PR targeting `main`, and enable auto-merge. If ingestion started on `main`, create a dedicated ingestion branch before committing.

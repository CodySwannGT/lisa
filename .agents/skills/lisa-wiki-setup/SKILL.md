# Lisa Wiki Setup Skill

Use this skill when setting up, repairing, or verifying the Lisa in-repository LLM Wiki.

## Scope

Lisa is a monorepo at `/Users/cody/workspace/lisa`. The wiki lives inside the repo at `wiki/`.

Do not create a wrapper repository. Do not move the monorepo into `projects/`.

## Required Files

Verify these files exist:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `wiki/documentation/overview.md`
- `wiki/schema/llm-wiki-contract.md`
- `wiki/projects/registry.md`
- `wiki/index.md`
- `wiki/log.md`
- `wiki/start-here.md`
- `.agents/skills/lisa-wiki-setup/SKILL.md`
- `.agents/skills/lisa-wiki-ingest/SKILL.md`
- `.agents/skills/lisa-wiki-usage/SKILL.md`

## Existing Repo Rules

- Preserve unrelated working tree changes.
- Do not stage `.lisa.workspaces.json` unless explicitly requested.
- Do not stage `node_modules/`, `dist/`, `coverage/`, local MCP state, secrets, tokens, or build artifacts.
- Commit and push to the current branch after successful setup or ingestion.

## Verification

Run:

```bash
git status --short
git diff --check
rg -n -i "<unrelated-client-term-pattern>" wiki AGENTS.md CLAUDE.md .agents/skills/lisa-wiki-* .claude/skills/lisa-wiki-* || true
rg -n "<secret-token-private-key-pattern>" wiki AGENTS.md CLAUDE.md .agents/skills/lisa-wiki-* .claude/skills/lisa-wiki-* || true
```

The contamination and secret scans should return no results for wiki/setup content.

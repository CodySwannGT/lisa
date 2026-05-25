---
name: harness-parity-council
description: Lisa-only advisory workflow for consulting external coding-agent CLIs about runtime parity without bundling this skill into host projects
---

# Harness Parity Council

Use this skill inside the Lisa repository when Claude needs structured parity advice from external coding-agent CLIs before changing Lisa behavior.

This skill is Lisa-only. Keep it under `.agents/skills/` and do not move or mirror it into `plugins/`, generated plugin artifacts, host-project templates, install output, or marketplace bundles.

## Use Cases

- Research a new runtime-support PRD before decomposition or implementation.
- Review a design sketch, branch diff, or issue for Claude/Codex/Cursor/Copilot/Antigravity parity risks.
- Collect runtime-specific naming, packaging, permission, testing, or migration advice before editing Lisa features.

## Invocation Contract

Run this skill from Claude as the lead orchestrator. Claude remains the final decision-maker. External CLI output is evidence, not authority.

Base invocation shape:

```text
/harness-parity-council <topic-or-artifact> [--runtime <name>] [--second-round] [--dry-run] [--write-mode <mode>]
```

Examples:

```text
/harness-parity-council "Codex parity for install-time hooks"
/harness-parity-council https://github.com/CodySwannGT/lisa/issues/721 --runtime codex
/harness-parity-council "review current diff for Cursor/Codex parity gaps" --second-round
/harness-parity-council "plan Antigravity support" --dry-run
```

## Arguments

- `<topic-or-artifact>`: Required. Plain-language feature prompt, issue URL, PRD URL, branch/diff summary, or other Lisa-local context to review.
- `--runtime <name>`: Optional. Narrow to one runtime. Supported names: `cursor`, `codex`, `copilot`, `antigravity`.
- `--second-round`: Optional. After the first advisory round, share Claude's sanitized synthesis back to available runtimes for critique.
- `--dry-run`: Optional. Print planned adapter invocations and safety settings without calling external CLIs.
- `--write-mode <mode>`: Optional and opt-in only. Reserved for guarded future use. Default behavior is read-only advisory mode.

## Runtime Adapters

The skill is designed around these configurable CLI command slots:

- `cursor` via `LISA_CURSOR_CLI`, default candidate `cursor-agent`
- `codex` via `LISA_CODEX_CLI`, default candidate `codex`
- `copilot` via `LISA_COPILOT_CLI`, default candidate `copilot`
- `antigravity` via `LISA_ANTIGRAVITY_CLI`, default candidate `agy`

Adapter implementation details, safe flags, timeout handling, auth detection, and output capture are handled by follow-on council tickets. This scaffold defines the contract they must satisfy.

The current adapter source of truth lives in `./runtime-adapters.mjs`. Run `node .agents/skills/harness-parity-council/runtime-adapters.mjs` to print the resolved command slots, read-only-safe base flags, timeout budget, and local help/version probe results for each runtime.

## Operating Rules

- Default to read-only advisory execution.
- Do not let external CLIs edit files, install dependencies, commit, push, or open PRs unless the user explicitly requests a guarded write mode.
- Do not send secrets, token files, `.env` contents, private keys, or MCP auth artifacts to external CLIs.
- Treat missing or unauthenticated CLIs as non-fatal. Record them as unavailable and continue.
- Keep Claude's final synthesis separate from raw runtime responses.
- Prefer inline summaries or gitignored Lisa-local temp artifacts over durable repo files unless a later ticket explicitly adds storage.

## Expected Output

Each run should produce a concise synthesis with:

- runtimes consulted and runtimes unavailable
- native feature surfaces each runtime claims to support
- parity gaps or risks
- testing and documentation implications
- open questions Claude should resolve before implementation

## Notes For Maintainers

- This skill intentionally lives only in `.agents/skills/`.
- The follow-on implementation tickets should add adapter execution, safety enforcement, redaction, packaging checks, and fixture-backed verification without changing this Lisa-only placement.

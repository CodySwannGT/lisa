---
name: lisa-wiki-add-role
description: Scaffold a domain-expert "digital staff" role over the wiki — a dual-runtime subagent (Claude + Codex) plus a staff doc page — from a config.staff[] entry. Use when a project wants a role-scoped expert (e.g. Legal, Finance, Sales) whose knowledge is a slice of the wiki. The plugin only SETS UP the subagent; whether it is ever invoked, scheduled, or routed is out of scope.
---

# lisa-wiki-add-role

Turn a role definition into two generated artifacts: a documentation page in the wiki and a runnable,
brain-pointed subagent on both runtimes. **Running the subagent (invocation, scheduling, Telegram /
agent-team routing, private notebooks) is out of scope** — this skill only creates it.

## Workflow
1. **Resolve the role** from a `config.staff[]` entry (or interview to add one): `id`, `role`,
   `expertise`, `owns` (categories / connectors / skills), `sensitivity`.
2. **Doc page:** generate `wiki/staff/<id>.md` describing the role, its owned domain, and who it
   reports to. This page is wiki content and is itself ingestible (the `roles` connector).
3. **Subagents (dual-runtime), rendered from the role-agent templates:**
   - Claude: `.claude/agents/<id>.md`.
   - Codex: `.codex/agents/<id>.toml` (keys `name`, `description`, `developer_instructions`; optional
     `model`, `model_reasoning_effort`, `sandbox_mode`).
4. **Brain-pointed, not baked:** the subagent's instructions say *"your domain is `wiki/<owned>/`;
   `/query` it first, contribute via `/ingest`; stay in your lane."* It points at the live wiki so it
   never goes stale. Only its one-line `description` is synthesized from the wiki at generation time.
5. **Serialize the description before rendering:** derive `roleDescriptionSerialized` with
   `JSON.stringify(roleDescription)` or an exact equivalent that emits one JSON string literal on one
   physical line. Substitute that serialized literal, including its surrounding quotes, directly for
   `{{roleDescriptionSerialized}}` in both templates. Do not add another layer of quotes. This keeps
   colon-space sequences, quotes, backslashes, and runtime newlines exact in both YAML and TOML.

## Rules
- v1 instructs lane-keeping but does not *enforce* per-role write isolation (deferred).
- Setup seeds the starter roster by delegating here per `config.staff[]` entry.

## Related
`lisa-wiki-setup` (seeds the roster), `lisa-wiki-add-ingest`, `lisa-wiki-onboard-me`.

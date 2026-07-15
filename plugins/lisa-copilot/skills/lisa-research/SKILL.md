---
name: lisa-research
description: "Research a problem space and create a PRD in the configured PRD source. Investigates the codebase, defines user flows, assesses technical feasibility, synthesizes the spec, then creates it in the source (Notion / Confluence / GitHub / Linear per .lisa.config.json `source`) via lisa-prd-source-write — there is no loose document artifact. Vendor-agnostic. Accepts an optional `prd_ready` flag (default false → the PRD is created in the `draft` role; true → created `ready` so lisa-intake auto-claims it) and an optional dedupe `marker`/`dedupe_key` (used when invoked by lisa-project-ideation) so re-runs reference the existing PRD instead of duplicating it."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Research

Produce a PRD for the problem in `$ARGUMENTS`, then create it in the configured PRD source.

## Inputs

- The problem statement / feature idea (required) — free text, a feasibility card, or a URL.
- `prd_ready` (optional, default `false`) — `false` creates the PRD in the source's `draft` role for
  human review; `true` creates it in the `ready` role so `lisa-intake` (PRD side) auto-claims it.
- `dedupe_key` / `marker` (optional) — a stable dedupe marker (e.g. supplied by
  `lisa-project-ideation`) embedded in the created PRD so re-runs reference the existing PRD rather
  than creating a duplicate.
- `ideation_ledger_payload` (optional, required when invoked by `lisa-project-ideation`) — a
  structured metadata object to forward unchanged to `lisa-prd-source-write`. It carries the
  selected marker, automation id/path when available, persona names, persona evidence references,
  rejected overlap candidates, repo identity, `prd_ready`, selected idea title/key, and expected
  empirical verification artifact. `research` may use these fields to inform the PRD body, but must
  not discard, rename, or vendor-render them.

## Orchestration: agent team

You are "inside an agent team" only if you are yourself a spawned teammate or subagent — you were spawned into a team context, or your context names a team lead you report to. A lead/root session that has previously spawned subagents is still the lead and retains full authority to create this flow's team.

If you are NOT inside an agent team by that definition, the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude Code >= 2.1.178: there is no `TeamCreate` tool; the team forms automatically when you spawn the first teammate with `Agent`. That first spawn should be the bounded specialist needed to start this flow. On older Claude Code that still exposes `TeamCreate`, the explicit team-create path is also acceptable.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. The initial Claude `Agent` spawn described above is the only pre-team exception because it establishes the team. Gathering context inline as the lead is the exact bypass path that produces ad-hoc work instead of a real team flow.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Flow

Execute the **Research** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, deliverables). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

A PRD **created in the configured PRD source** (per the intent-routing rule's Research flow
definition) structured as: problem statement, high-level solution description, links (if needed),
user stories (each with its own functional/non-functional requirements and, only for stories with
new UI/visual work, a design-file pointer), overall acceptance criteria, open questions, and the
"Recommended Tooling for Plan Phase" section. The final
flow step invokes `lisa-prd-source-write`, which creates the PRD in the configured `source` (Notion
page in the PRD database, Confluence page under the lifecycle parent, GitHub issue, or Linear
project) in the `draft` role by default or `ready` when `prd_ready=true`. **The PRD lives in the
source — there is no loose document artifact.** Before handing the synthesized PRD to
`lisa-prd-source-write`, record the Research run's direct usage on that artifact through
`lisa-usage-accounting` so the PRD body carries the canonical `## Lisa Usage` ledger from creation
time onward. If the runtime does not expose trustworthy usage, the direct entry must still be
written with `source: unavailable` and nullable token/cost fields rather than silently omitting the
Research row. If the call includes `ideation_ledger_payload`, pass that object through in the
`lisa-prd-source-write` spec unchanged alongside `marker`, `dedupe_key`, and `initial_role`; this is
the vendor-neutral handoff that lets the configured writer render an auditable run ledger without
`research` bypassing source selection. A `source` must be configured; if it is not, stop and report
it rather than emitting a document. The Plan flow consumes the created PRD next.

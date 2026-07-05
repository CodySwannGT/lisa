---
name: lisa-debrief
description: "Run the Debrief flow over a shipped initiative. Input: a PRD URL (Notion / Confluence / Linear / GitHub Issue / file), a JIRA epic key, or a GitHub epic issue URL. Output: a triage-ready learnings document covering every work item in the initiative — edge cases, gotchas, process friction, tooling gaps, convention drift — each with structured evidence and a human-disposition field. Persistence is deferred to lisa-debrief-apply."
allowed-tools: ["Skill", "ToolSearch", "Bash", "Read", "Glob", "Grep"]
---

# Debrief: $ARGUMENTS

Walk the original Plan for `$ARGUMENTS`, mine the completed work items and their PRs, and produce a triage-ready learnings document for human review.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude Code >= 2.1.178: there is no `TeamCreate` tool; the team forms automatically when you spawn the first teammate with `Agent`. That first spawn should be the bounded specialist needed to start this flow. On older Claude Code that still exposes `TeamCreate`, the explicit team-create path is also acceptable.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Resolving the work-item set, fetching tickets, walking PRs — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Input

`$ARGUMENTS` is one of:

| Input shape | Resolution |
|-------------|------------|
| Notion / Confluence / Linear / GitHub Issue PRD URL | Fetch the PRD; read its `## Tickets` (or equivalent) back-link section written by the Plan flow |
| File path to a PRD markdown | Read the file; parse its `## Tickets` section |
| JIRA epic key (e.g. `SE-1234`) or epic URL | Fetch the epic; list its child issues (Stories, Tasks, Bugs) |
| GitHub epic issue URL or `<org>/<repo>#<n>` | Fetch the epic issue; list its sub-issues / linked items |

If the PRD has no `## Tickets` section AND the input is not an epic, stop and report — the Plan flow's PRD back-link step (`lisa-prd-backlink`) was likely skipped. Suggest re-running Plan to populate the section, or pass the epic key directly.

## Gate

Run before mining begins:

1. **All work items terminal.** Every linked work item must be in a terminal state (Done / Closed / Cancelled equivalent for the tracker). If any item is still open, stop and list the unfinished items — Debrief is post-shipping by definition.
2. **PR coverage.** Every Done item that was implementable (Story / Task / Bug; not Spike) must have at least one merged PR linked. Items missing a PR are recorded as **anomalies** to surface in the report rather than silently excluded — a Done item with no PR is itself a learning ("how did this ship?").
3. **Headless safety.** In headless / `-p` / scheduled mode, do not block on missing input — fail fast with a clear error listing what was needed.

## Flow

Execute the **Debrief** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gate, mining, synthesis, output, hand-off). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

The flow's mining step runs `tracker-mining-specialist` and `pr-mining-specialist` in parallel as separate tasks within the team. Both must complete before `learnings-synthesizer` runs. Express this with `blockedBy` so the synthesizer task is automatically gated on the two mining tasks.

## Exhaustiveness expectation

Debrief is deliberately exhaustive — the human, not the agent, decides what is worth keeping. Specialists should err toward surfacing more candidates, not fewer. A candidate that the synthesizer rates low confidence is still a row in the triage doc; only outright duplicates are dropped.

## Output

A markdown triage document at `./debrief/<initiative-slug>-<YYYY-MM-DD>.md` (or wherever the project's debrief output directory is configured) containing:

1. **Header** — initiative name, source PRD/epic link, work-item count, PR count, generation date, gate results.
2. **Anomalies** — work items missing PRs, items with abnormal status-transition timing, PRs with no review comments at all (signal-of-absence is a learning), etc.
3. **Candidate learnings** — one row per candidate, grouped by category (Edge case / Recurring gotcha / Process friction / Tooling gap / Convention drift). Each row has:
   - `Summary` — one sentence
   - `Category`
   - `Evidence` — links to the source ticket comment / PR comment / commit / test file (multiple allowed)
   - `Recommended persistence destination` — the agent's best guess for where this should land if accepted (e.g., "Edge Case Brainstorm checklist → Navigation & URL state", "PROJECT_RULES.md", "memory: project_*.md", "new tooling-gap ticket")
   - `Disposition` — empty checkbox-style field the human will fill: `[ ] Accept` / `[ ] Reject` / `[ ] Defer` plus a free-text reason
4. **Source map** — appendix listing every work item and PR walked, so the human can verify completeness.

Before returning, write the Debrief run's direct usage onto the triage document through
`lisa-usage-accounting` so the markdown artifact carries its own `## Lisa Usage` section separate
from delivery-time usage. If runtime usage is unavailable, record a debrief entry with
`source: unavailable` and nullable token/cost fields instead of skipping the row.

The skill's terminal output is the path to the triage document and a one-line summary of counts per category. Persistence does not happen here — that is `lisa-debrief-apply`'s job.

## Hand-off

After producing the triage document, print:

```text
Triage document written to: <path>
Counts: <n> edge cases, <n> gotchas, <n> friction, <n> tooling gaps, <n> convention drift; <n> anomalies
Next: human triage. When done, run `/lisa:debrief:apply <path>` to persist accepted learnings.
```

Then stop. Debrief never persists learnings on its own.

---
name: debrief
description: "Run the Debrief flow over a shipped initiative. Input: a PRD URL (Notion / Confluence / Linear / GitHub Issue / file), a JIRA epic key, or a GitHub epic issue URL. Output: a triage-ready learnings document covering every work item in the initiative — edge cases, gotchas, process friction, tooling gaps, convention drift — each with structured evidence and a human-disposition field. Persistence is deferred to lisa:debrief-apply."
allowed-tools: ["Skill", "ToolSearch", "TeamCreate", "Bash", "Read", "Glob", "Grep"]
---

# Debrief: $ARGUMENTS

Walk the original Plan for `$ARGUMENTS`, mine the completed work items and their PRs, and produce a triage-ready learnings document for human review.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), the very first thing you do is create the team. Two tool calls only, in this exact order:

1. `ToolSearch` with `query: "select:TeamCreate"` — `TeamCreate` is a deferred tool whose schema must be loaded before it can be invoked. A cold call returns `InputValidationError` and tempts a fallback to direct `Agent` calls, which bypasses the team.
2. `TeamCreate` — actually create the team.

Until `TeamCreate` returns successfully, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Resolving the work-item set, fetching tickets, walking PRs — all of those are tasks for the team you are about to create, not for the lead session before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team.

## Input

`$ARGUMENTS` is one of:

| Input shape | Resolution |
|-------------|------------|
| Notion / Confluence / Linear / GitHub Issue PRD URL | Fetch the PRD; read its `## Tickets` (or equivalent) back-link section written by the Plan flow |
| File path to a PRD markdown | Read the file; parse its `## Tickets` section |
| JIRA epic key (e.g. `SE-1234`) or epic URL | Fetch the epic; list its child issues (Stories, Tasks, Bugs) |
| GitHub epic issue URL or `<org>/<repo>#<n>` | Fetch the epic issue; list its sub-issues / linked items |

If the PRD has no `## Tickets` section AND the input is not an epic, stop and report — the Plan flow's PRD back-link step (`lisa:prd-backlink`) was likely skipped. Suggest re-running Plan to populate the section, or pass the epic key directly.

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

The skill's terminal output is the path to the triage document and a one-line summary of counts per category. Persistence does not happen here — that is `lisa:debrief-apply`'s job.

## Hand-off

After producing the triage document, print:

```text
Triage document written to: <path>
Counts: <n> edge cases, <n> gotchas, <n> friction, <n> tooling gaps, <n> convention drift; <n> anomalies
Next: human triage. When done, run `/lisa:debrief:apply <path>` to persist accepted learnings.
```

Then stop. Debrief never persists learnings on its own.

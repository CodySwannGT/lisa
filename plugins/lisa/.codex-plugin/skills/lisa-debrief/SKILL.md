---
name: lisa-debrief
description: "Run a Debrief over a shipped…"
allowed-tools: ["Skill", "ToolSearch", "Bash", "Read", "Glob", "Grep", "Agent"]
---
Run a Debrief over a shipped initiative (PRD, epic, or issue) and produce a learnings document of edge cases, gotchas, friction, tooling gaps, and drift with evidence; ledger-bound learnings are persisted right away.


# Debrief: $ARGUMENTS

Walk the original Plan for `$ARGUMENTS`, mine the completed work items and their PRs, and produce a triage-ready learnings document for human review.

## How to work

Do the work yourself, in this session. Delegate to a subagent only when a piece of work is sizeable and genuinely independent, such as mining the tracker and the pull requests in parallel — and give it the exact result you need back. Do not delegate work you can finish in a handful of tool calls.


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

Execute the **Debrief** flow as defined in the `intent-routing` reference rule (read on demand). The rule contains the canonical step sequence (gate, mining, synthesis, output, hand-off). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

The flow's mining step runs `tracker-mining-specialist` and `pr-mining-specialist` in parallel as subagents. Both must complete before `learnings-synthesizer` runs.

## Exhaustiveness expectation

Debrief is deliberately exhaustive — the human, not the agent, decides what is worth keeping. Specialists should err toward surfacing more candidates, not fewer. A candidate that the synthesizer rates low confidence is still a row in the triage doc; only outright duplicates are dropped.

## Output

A markdown triage document at `./debrief/<initiative-slug>-<YYYY-MM-DD>.md` (or wherever the project's debrief output directory is configured) containing:

1. **Header** — initiative name, source PRD/epic link, work-item count, PR count, generation date, gate results.
2. **Anomalies** — work items missing PRs, items with abnormal status-transition timing, PRs with no review comments at all (signal-of-absence is a learning), etc.
3. **Candidate learnings** — one row per candidate, grouped by category (Edge case / Recurring gotcha / Process friction / Tooling gap / Convention drift / Decomposition infidelity / PRD defect / Missing tool access, plus `Uncategorized` for a finding none of the eight fit). The category set is owned by `learnings-synthesizer` — every category it can emit must have a section here and a route in `lisa-debrief-apply`, or an accepted row cannot be applied. Each row has:
   - `Summary` — one sentence
   - `Category`
   - `Evidence` — links to the source ticket comment / PR comment / commit / test file (multiple allowed)
   - `Recommended persistence destination` — the agent's best guess for where this should land if accepted (e.g., "Edge Case Brainstorm checklist → Navigation & URL state", "learnings ledger via the executable contract", "new tooling-gap ticket", "upstream Lisa issue"). Never name machine-local auto-memory, the host-rules directory `.agents/rules/`, or `AGENTS.md` — those are not persistence destinations.
   - `Disposition` — empty checkbox-style field the human will fill: `[ ] Accept` / `[ ] Reject` / `[ ] Defer` plus a free-text reason
4. **Source map** — appendix listing every work item and PR walked, so the human can verify completeness.

Before returning, write the Debrief run's direct usage onto the triage document through
`lisa-usage-accounting` so the markdown artifact carries its own `## Lisa Usage` section separate
from delivery-time usage. If runtime usage is unavailable, record a debrief entry with
`source: unavailable` and nullable token/cost fields instead of skipping the row.

The skill's terminal output is the path to the triage document and a one-line summary of counts per category. Persistence does not happen here — that is `lisa-debrief-apply`'s job.

## Capture learnings

After writing the triage document, route every candidate whose recommended destination is the learnings ledger through `lisa-persist-learning` (`rule` = its summary, `why`, `provenance` = its evidence links, `triggering_issue` = the source PRD or epic). The judge is the quality gate, so these do not wait for human triage; record each verdict in the row's `Disposition`. Learnings about this debrief run itself (a source that could not be read, missing access) go through the same skill. Every other destination — tickets, upstream issues, checklist edits — stays with `lisa-debrief-apply`.

## Hand-off

After producing the triage document, print:

```text
Triage document written to: <path>
Counts: <n> edge cases, <n> gotchas, <n> friction, <n> tooling gaps, <n> convention drift, <n> decomposition infidelity, <n> PRD defects, <n> missing tool access, <n> uncategorized; <n> anomalies
Next: human triage. When done, run `/lisa:debrief:apply <path>` to persist accepted learnings.
```

Then stop. Debrief persists ledger-bound learnings only through `lisa-persist-learning`; everything else waits for `lisa-debrief-apply`.

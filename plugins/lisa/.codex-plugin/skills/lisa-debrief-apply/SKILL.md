---
name: lisa-debrief-apply
description: "Apply human-marked dispositions…"
allowed-tools: ["Skill", "Bash", "Read", "Edit", "Write", "Glob", "Grep"]
---

# Debrief Apply: $ARGUMENTS

Read the triage document at `$ARGUMENTS` and persist every Accepted candidate learning to its destination.

This skill is intentionally **single-agent** — there is no team. Routing is deterministic given the disposition column. Spawning sub-agents would only add latency.

## Input

A path or URL to a Debrief triage document produced by `lisa-debrief`. The document is expected to follow the structure that skill produces — a header, an anomalies section, candidate-learning rows grouped by category, and a source-map appendix.

## Pre-flight

1. **Verify the doc exists and parses.** If the file cannot be read or the expected sections are missing, stop and report — do not guess.
2. **Confirm dispositions exist.** If every row is unmarked, stop and ask the human to triage first. A pristine doc is a no-op, not an error to silently swallow.
3. **Identify the destination map.** Read the project's `.lisa.config.json` (or stack defaults) for: edge-case checklist file (default: `plugins/src/base/rules/intent-routing.md`'s Edge Case Brainstorm sub-flow), `projectRulesFile` (default: `.claude/rules/PROJECT_RULES.md`), memory directory (per the auto-memory system path), tracker for new tickets.

## Routing rules

For every row marked **Accept**:

| Category | Destination | Action |
|----------|-------------|--------|
| Edge case | Edge Case Brainstorm checklist in `intent-routing.md` | Append the new pattern + question to the matching group (Navigation, Data, Failure, Input, Auth, or a new group if none fit). Use the row's `Summary` and `Evidence` link as a citation comment. |
| Recurring gotcha | Memory file (`project_*.md`) | Write a new memory entry with `type: project`, structured as: rule, **Why:**, **How to apply:**. Add an index line to `MEMORY.md`. |
| Process friction | Configured project rules file | Append a one-line guideline to the `.lisa.config.json` `projectRulesFile` destination (default `PROJECT_RULES.md`) under an appropriate heading (or create one). |
| Tooling gap | Configured tracker — or upstream Lisa when harness-level | **Split by level.** Project-level (a missing project script, hook, or automation) → create a ticket via `lisa-tracker-write` with `issue_type: Task`, summary derived from the row's `Summary`, description citing the evidence and the originating debrief doc, labeled `type:tooling` / `lifecycle-improvement`. Harness-level (a Lisa skill/gate/agent that should have caught the issue but didn't) → file an upstream Lisa issue exactly per the "Filing upstream" procedure in `lisa-rework-triage` (dedupe search first, three-audience description, evidence chain, `self-hardening` label; repo from `.lisa.config.json` `hardening.upstreamRepo`, default `CodySwannGT/lisa`). |
| Convention drift | `CLAUDE.md` for project-wide agent operating instructions; otherwise the configured project rules file for codebase conventions | Append the convention as a one-paragraph note under the relevant section. If no relevant section exists, create one. |
| Decomposition infidelity | Upstream Lisa repo | File an upstream Lisa issue per the "Filing upstream" procedure in `lisa-rework-triage`, citing the PRD text vs. the distorted ticket AC and naming the gate that passed it. |
| PRD defect | Source PRD | Comment on the PRD via the `lisa-prd-backlink` lineage quoting the defective requirement and the failure it missed; flag for product review. Never silently edit the spec. |
| Missing tool access | Configured tracker | Create a provisioning ticket via `lisa-tracker-write` (`issue_type: Task`, `type:tooling`) describing the missing tool/credential/environment and which flow needs it. |

For every row marked **Reject** or **Defer**: no action. Defer is a no-op for `apply` but worth surfacing in the run summary — the human may want to revisit at the next debrief.

## Idempotency

`apply` is safe to re-run. Each Accepted row carries an evidence link that doubles as a fingerprint — before writing, check whether the destination already cites that fingerprint. If it does, skip the write and note the row as `already-applied` in the run summary. This lets the human triage a doc incrementally (mark a few, run apply, mark more, run apply again) without producing duplicates.

## Updating the triage doc

After each Accepted row is persisted, replace its `[ ] Accept` checkbox with `[x] Applied — <one-line summary of what was written>`. This makes the triage doc itself the audit log of what was acted on. If a write fails (e.g., tracker is unreachable), mark the row `[!] Apply failed — <reason>` and continue with the rest. Never abort the whole run because one row failed.

## Output

A run summary printed to the user:

```text
Applied <n> learnings:
  <n> edge cases → intent-routing.md
  <n> gotchas → memory
  <n> friction → PROJECT_RULES.md
  <n> tooling gaps (project) → <tracker> (<key1>, <key2>, ...)
  <n> tooling gaps (harness) → upstream Lisa (<issue-url1>, ...)
  <n> convention drift → CLAUDE.md
  <n> decomposition infidelity → upstream Lisa (<issue-url1>, ...)
  <n> PRD defects → PRD comments (<prd-link1>, ...)
  <n> missing tool access → <tracker> (<key1>, ...)
Skipped:
  <n> rejected, <n> deferred, <n> already-applied
Failed:
  <n> (see <path> for details)
Triage doc updated in place: <path>
```

If anything is written to a tracker, suggest the human commit the local file changes (memory, rules, intent-routing) when ready — `apply` does not commit.

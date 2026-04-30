---
name: debrief-apply
description: "Apply human-marked dispositions from a Debrief triage document. Reads the triage doc produced by lisa:debrief, parses each row's disposition (Accept / Reject / Defer), and routes Accepted items to their persistence destination. Deterministic and idempotent — safe to re-run if dispositions are added incrementally."
allowed-tools: ["Skill", "Bash", "Read", "Edit", "Write", "Glob", "Grep"]
---

# Debrief Apply: $ARGUMENTS

Read the triage document at `$ARGUMENTS` and persist every Accepted candidate learning to its destination.

This skill is intentionally **single-agent** — there is no team. Routing is deterministic given the disposition column. Spawning sub-agents would only add latency.

## Input

A path or URL to a Debrief triage document produced by `lisa:debrief`. The document is expected to follow the structure that skill produces — a header, an anomalies section, candidate-learning rows grouped by category, and a source-map appendix.

## Pre-flight

1. **Verify the doc exists and parses.** If the file cannot be read or the expected sections are missing, stop and report — do not guess.
2. **Confirm dispositions exist.** If every row is unmarked, stop and ask the human to triage first. A pristine doc is a no-op, not an error to silently swallow.
3. **Identify the destination map.** Read the project's `.lisa.config.json` (or stack defaults) for: edge-case checklist file (default: `plugins/src/base/rules/intent-routing.md`'s Edge Case Brainstorm sub-flow), project-rules file (default: `.claude/rules/PROJECT_RULES.md`), memory directory (per the auto-memory system path), tracker for new tickets.

## Routing rules

For every row marked **Accept**:

| Category | Destination | Action |
|----------|-------------|--------|
| Edge case | Edge Case Brainstorm checklist in `intent-routing.md` | Append the new pattern + question to the matching group (Navigation, Data, Failure, Input, Auth, or a new group if none fit). Use the row's `Summary` and `Evidence` link as a citation comment. |
| Recurring gotcha | Memory file (`project_*.md`) | Write a new memory entry with `type: project`, structured as: rule, **Why:**, **How to apply:**. Add an index line to `MEMORY.md`. |
| Process friction | Project rules file | Append a one-line guideline to `PROJECT_RULES.md` under an appropriate heading (or create one). |
| Tooling gap | Configured tracker | Create a new ticket via `lisa:tracker-write` with `issue_type: Task`, summary derived from the row's `Summary`, description citing the evidence and the originating debrief doc. Label appropriately (`type:tooling`, `lifecycle-improvement`, etc.). |
| Convention drift | `CLAUDE.md` (project) or `PROJECT_RULES.md` | Append the convention as a one-paragraph note under the relevant section. If no relevant section exists, create one. |

For every row marked **Reject** or **Defer**: no action. Defer is a no-op for `apply` but worth surfacing in the run summary — the human may want to revisit at the next debrief.

## Idempotency

`apply` is safe to re-run. Each Accepted row carries an evidence link that doubles as a fingerprint — before writing, check whether the destination already cites that fingerprint. If it does, skip the write and note the row as `already-applied` in the run summary. This lets the human triage a doc incrementally (mark a few, run apply, mark more, run apply again) without producing duplicates.

## Updating the triage doc

After each Accepted row is persisted, replace its `[ ] Accept` checkbox with `[x] Applied — <one-line summary of what was written>`. This makes the triage doc itself the audit log of what was acted on. If a write fails (e.g., tracker is unreachable), mark the row `[!] Apply failed — <reason>` and continue with the rest. Never abort the whole run because one row failed.

## Output

A run summary printed to the user:

```
Applied <n> learnings:
  <n> edge cases → intent-routing.md
  <n> gotchas → memory
  <n> friction → PROJECT_RULES.md
  <n> tooling gaps → <tracker> (<key1>, <key2>, ...)
  <n> convention drift → CLAUDE.md
Skipped:
  <n> rejected, <n> deferred, <n> already-applied
Failed:
  <n> (see <path> for details)
Triage doc updated in place: <path>
```

If anything is written to a tracker, suggest the human commit the local file changes (memory, rules, intent-routing) when ready — `apply` does not commit.

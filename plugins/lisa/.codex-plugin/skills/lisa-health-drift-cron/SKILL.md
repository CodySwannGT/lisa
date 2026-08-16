---
name: lisa-health-drift-cron
description: "Scheduled health consumer"
allowed-tools: ["Skill", "Bash", "Read"]
---

# Lisa Health Drift Cron: $ARGUMENTS

Consumer #3 of the health layer: the cron. A health check you have to remember to run is a health check that goes stale, so this one runs on a schedule and turns drift into **tracked work** rather than silent decay.

It **files**. It never closes, edits, or repairs. Disposal belongs to humans and the Implement factory.

## Why idempotency is the whole job

A nightly cron that refiles the same drift every night is worse than no cron at all, because it teaches everyone to ignore the tickets it files. Every rule below exists to make *"the same drift"* a decidable question, and the decision is not made in this prose — it is made by `planDriftTickets` in `src/health/drift-tickets.ts`, which is unit-tested against each of these cases.

**Do not reimplement the dedupe here.** Call the planner and act on its answer. A second implementation in prose is a second implementation to drift.

## Phase 1 — Run the health check headless

Invoke **`/lisa-health`** and use the JSON it emits. Do not call the CLI directly and do not invent flags for it: `lisa health` takes `[path]`, `--prepare-agentic`, and `--agentic-evaluation`, and nothing else. There is no `--json` — the persisted result IS the command's stdout, and an unknown option makes commander exit non-zero, so a guessed flag turns the first phase of a scheduled run into a failure nobody is watching.

Routing through the skill also means the bounded harness-review step and its cleanup stay in one place rather than being re-described here and drifting.

Do not reconstruct, merge, or summarize findings; the result is passed to Phase 3 verbatim.

If the run itself fails, that is a **recovery-required** outcome. Report it and stop. Do not file a drift ticket about a health check that did not complete — a run that could not measure has not found drift, and saying otherwise is the same defect the health layer exists to catch.

## Phase 2 — Read the OPEN tickets only

Fetch the tracker's **open** items carrying the drift marker prefix `lisa-health-drift`.

**Open only, and this is load-bearing.** A closed ticket must not suppress live drift: if it did, closing a ticket without fixing anything would make that drift invisible forever, which is exactly the silent decay this consumer exists to prevent. Suppression should be a configured declaration visible in a diff — turn the check off in config — not a side effect of somebody tidying a backlog.

The planner enforces this by construction: it accepts an `openTickets` list and has no notion of a closed one. Passing closed tickets defeats the design, and the parameter is named to say so.

## Phase 3 — Plan

Feed the findings and the open tickets to `planDriftTickets`. It returns:

- `file` — one entry per drifting check with no open ticket, carrying `title`, `body`, and `marker`
- `alreadyTracked` — drift that an open ticket already covers, with the ticket id

Every unique drifting check lands in exactly one of the two after duplicate findings for the same check are collapsed, so a run reporting "nothing to do" is asserting it looked at all of them.

Dedupe is per **check**, not per drift set. Fingerprinting the whole finding set would mean one added finding produces a fresh ticket while the old one still stands, so a slowly-degrading project accumulates near-duplicates — the same "worse than no cron" outcome by another route.

## Phase 4 — File

For each entry in `file`, invoke **`/lisa-tracker-write`** with its title and body. **Never call a vendor writer (`lisa-github-write-issue` / `lisa-jira-write-ticket` / `lisa-linear-write-issue`) directly** — routing through the shim is what makes the tracker switchable per project.

The body already contains the marker. Do not strip it, and do not add a second one: the next run finds the ticket by that exact string.

## Run outcome

Per the automation runbook contract, end with exactly one outcome and a one-line operator-readable summary:

- **no-change** — the project is in band, or every drifting check is already tracked. Say which: `no-change — in band, nothing filed.` versus `no-change — 2 drifting checks, both already tracked (#41, #42).`
- **change-proved** — tickets were filed. `change-proved — filed 1 drift ticket: coverage-floor (#57).`
- **recovery-required** — the health run failed, or a write failed. Name what a human must do.

The distinction between the two `no-change` shapes matters. "Nothing filed" and "nothing wrong" are different facts, and collapsing them hides a project whose drift is real and simply already on somebody's list.

## Registration

Registered as `lisa-auto-<project>-health-drift` when `health.schedule` is set to `daily` or `weekly` in `.lisa.config.json`. `off` (the default) registers nothing. Torn down with the rest of the `lisa-auto-<project>-*` set.

Register at most **one** per project.

### What the dedupe does and does not guarantee

It guarantees **convergence, not mutual exclusion**, and the difference is worth stating plainly rather than leaving to be discovered.

Two runs that overlap — a manual invocation alongside the scheduled one, or a run still going when the next fires — can both read an empty open-ticket set and both file for the same check. A single registration makes that rare; it does not make it impossible, and no amount of care in this document would.

What the design does guarantee is that it stops there. The next run sees both open tickets carrying the marker, matches, and files nothing further, so duplicates do not compound. The transient duplicate persists until a human closes one, and closing it is safe: if the drift is still live, the remaining ticket still tracks it.

This is the same stance `lisa-learnings-audit` takes for the same reason, and the same advice applies — **a manual run should first confirm the cron is not due or running.** A project-scoped lease would buy true exclusion at the cost of a lock to acquire, hold, and expire correctly on a path that only runs daily; the failure it prevents is cosmetic and self-limiting, and the failure a stuck lease causes is a health check that silently stops running.

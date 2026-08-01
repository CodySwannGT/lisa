# Automation Runbook Contract (load-bearing)

**Every registered automation loop carries a checked-in runbook, and every run of that loop ends in
exactly one of six run outcomes** with a one-line, operator-readable summary. A registered loop with
no runbook, or a run that stops without naming its outcome, is a contract violation.

**One vendor-neutral contract, to be cited by (wired in the loop-conformance ticket)
`lisa-setup-automations`, `lisa-automation-status`, `lisa-tear-down-automations`, and every
registered loop skill** (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug,
never divergent per-loop prose).

## Membership

Membership is **registration, not skill-existence**: a loop is under this contract the moment it is
registered as a scheduled automation, and registering a new one pulls it in automatically. There is
no hardcoded roster of loops anywhere.

### Interactive flows are members too

The outcome vocabulary is **not cron-specific** — it answers "did this need me?", which an operator
asks of an interactive run exactly as often as of a scheduled one. Every Lisa flow that terminates
is a member: `lisa-implement`, `lisa-verify`, `lisa-plan`, `lisa-git-submit-pr`,
`lisa-drive-pr-to-merge`, `lisa-research`, and any skill invoked as a slash command.

For an interactive flow the record is the **final user-facing message**, not a JSONL row. It opens
with the outcome and the operator action, before any narrative:

```
change-proved — nothing for you. PR #6393 open, auto-merge on, CI running.
approval-requested — need a decision: ship the 135 Regular→Bold flips, or hold for design sign-off?
recovery-required — need you: staging E2E gate red for congestion; rerun or admin-merge.
```

The operator must learn whether they are needed **from the first line**, without reading the report.
Findings, evidence and caveats follow; they never replace the action line and never precede it.

An interactive flow that ends in prose with the action buried — or absent — is the same contract
violation as a silent cron exit. "I flagged X, I noticed Y, worth knowing Z" is narrative, not an
outcome. If nothing is needed, say **"nothing for you"** in those words and stop.

## The six run outcomes

Exactly one per run:
**`nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete`**

Health and operator action are **orthogonal** — a healthy run can still need an answer:

- `nothing-needed` — the loop ran and found nothing to act on. **Healthy.** Operator action: none.
- `candidate-proposed` — the loop proposed work (ticket, PRD, recommendation). **Healthy.** Operator
  action: review the proposed item and flip it ready when you want it built.
- `change-proved` — the loop made a change and proved it with evidence. **Healthy.** Operator
  action: none (informational).
- `approval-requested` — the loop reached a boundary it may not cross alone. **Healthy.** Operator
  action: answer the approval question.
- `recovery-required` — the loop itself could not complete (access, tooling, or substrate broken)
  and escalated a decision-ready packet. **Not healthy.** Operator action: restore the named
  capability, then close the escalation item.
- `policy-obsolete` — the loop's own retirement policy (the retirement condition written in its
  runbook) tripped, so it proposed its own teardown. **Healthy.** Operator action: approve the
  teardown, decline it (close the proposal as **Not planned**; the loop keeps running at cadence),
  or re-cadence it.

## A run outcome is NOT a work-item lifecycle terminal state (CRITICAL)

A **run outcome** describes the LOOP ITERATION. A **terminal state** describes a TICKET — Lisa
already uses that phrase for work-item lifecycles (`lisa-intake`: "`Blocked` is a valid terminal
state of the downstream lifecycles"). The two vocabularies never merge in an operator-facing report.
A healthy cycle that routes a work item to `Blocked` with clarifying questions is
`candidate-proposed` — it produced something — so it is **never `nothing-needed`**, which is
reserved for runs that found nothing at all, and **never `recovery-required`**, which means the
loop itself is broken, not that a work item was blocked.

## No silent exit

Every run — including a trivial early termination — ends by naming exactly one run outcome plus a
one-line operator summary of what happened, recorded where the status surface can read it —
there is no silent exit. The shared local substrate is
`plugins/src/base/scripts/automation-run-record.mjs`, which writes bounded JSONL records under
`.lisa/automations/runs/<loop-id>.jsonl`. Silence and health must never look identical to an
operator.

## Never block, always degrade

A missing runbook, an unreadable record surface, or an absent optional dependency **degrades** the
run — say so in the summary and finish with an outcome — it never crashes the loop, never blocks
other work, and never leaves the run unreported.

Full contract (template, outcome definitions, escalation packet, retirement): [reference/automation-runbook-contract.md](../reference/automation-runbook-contract.md).

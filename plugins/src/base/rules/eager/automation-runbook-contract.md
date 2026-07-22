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

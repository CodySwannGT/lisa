# Automation Runbook Contract (load-bearing)

**Every registered automation loop carries a checked-in runbook, and every run of that loop ends in
exactly one of six run outcomes** with a one-line, operator-readable summary. A registered loop with
no runbook, or a run that stops without naming its outcome, is a contract violation.

**One vendor-neutral contract, cited by `lisa-setup-automations`, `lisa-automation-status`,
`lisa-tear-down-automations`, and every registered loop skill** (the `leaf-only-lifecycle` /
`repo-scope-split` precedent: one shared slug, never divergent per-loop prose).

## Membership

Membership is **registration, not skill-existence**: a loop is under this contract the moment it is
registered as a scheduled automation, and registering a new one pulls it in automatically. There is
no hardcoded roster of loops anywhere.

## The six run outcomes

Exactly one per run:
**`nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete`**

- `nothing-needed` — the loop ran and found nothing to act on. **Healthy**; no operator action.
- `candidate-proposed` — the loop proposed work (ticket, PRD, recommendation) for a human or a
  downstream factory to pick up.
- `change-proved` — the loop made a change and proved it with evidence.
- `approval-requested` — the loop reached a boundary it may not cross alone and asked a human.
- `recovery-required` — the loop itself could not complete (access, tooling, or substrate broken)
  and escalated a decision-ready packet.
- `policy-obsolete` — the loop's retirement condition tripped; it proposed its own teardown.

## A run outcome is NOT a work-item lifecycle terminal state (CRITICAL)

A **run outcome** describes the LOOP ITERATION. A **terminal state** describes a TICKET — Lisa
already uses that phrase for work-item lifecycles (`lisa-intake`: "`Blocked` is a valid terminal
state of the downstream lifecycles"). The two vocabularies never merge in an operator-facing report.
A healthy cycle that routes a work item to `Blocked` is `nothing-needed` or `candidate-proposed` —
**never `recovery-required`**, which means the loop is broken, not that an item was blocked.

## No silent exit

Every run — including a trivial early termination — ends by naming exactly one run outcome plus a
one-line operator summary of what happened, recorded where the status surface can read it —
there is no silent exit. Silence and health must never look identical to an operator.

## Never block, always degrade

A missing runbook, an unreadable record surface, or an absent optional dependency **degrades** the
run — say so in the summary and finish with an outcome — it never crashes the loop, never blocks
other work, and never leaves the run unreported.

Full contract (template, outcome definitions, escalation packet, retirement): [reference/automation-runbook-contract.md](../reference/automation-runbook-contract.md).

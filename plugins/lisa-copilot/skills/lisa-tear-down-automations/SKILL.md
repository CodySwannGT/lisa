---
name: lisa-tear-down-automations
description: "Remove recurring Lisa automations that /setup-automations registered for this project — either the whole lisa-auto-<project>-* fleet by default, or one named loop registration when approving a policy-obsolete proposal — using the CURRENT runtime's native scheduler — Codex automations or, on Claude, /schedule. This skill is a declarative specification: it identifies WHICH automations to remove; it does not run teardown scripts. Carries no fixed list of loops for fleet teardown: the registration set is the roster. Removes only this project's Lisa automations — never other projects' automations or non-Lisa ones. Leaves checked-in runbook files on disk. The inverse of /setup-automations."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tear down Lisa automations: $ARGUMENTS

This skill is a **specification, not a script.** It tells the current runtime which recurring Lisa
automations to remove — the ones `/setup-automations` created for THIS project — and the runtime
removes them with its **native** scheduling mechanism. With no loop argument it removes the whole
project fleet. With a loop id argument (for example `monitor` or `learnings-audit`) it removes only
that one registered loop.

## Runtime scheduler (branch on the current runtime)

- **Codex** → list Codex automations and delete the `lisa-auto-<project>-*` set via the native
  automations mechanism (prefer the native delete over hand-removing
  `~/.codex/automations/<id>/`, which is only the backing store).
- **Claude** → use **`/schedule`** to list and remove the matching recurring routines.
- **Other runtimes** → use the runtime's native recurring-task mechanism. If it has none, state that
  and stop.

## Scope (remove only what setup created)

- By default, remove **every** automation `/setup-automations` registered for the current project — the whole
  set found under the stable `lisa-auto-<project>-` name prefix, whatever it currently contains.
  **Membership is registration, not a roster** (`automation-runbook-contract`): sweep the prefix and
  remove what is there. Do **not** work from a fixed list of loop names — a list drifts the moment a
  loop is added, which is exactly how the opt-in gardener came to be orphaned.
- When `$ARGUMENTS` names a loop id from a `policy-obsolete` teardown proposal, remove only that
  loop's registration under the same prefix, e.g. `lisa-auto-<project>-monitor`. Report every other
  project automation left in place. If the named loop is absent, that single-loop teardown is a clean
  no-op; do not widen it into a fleet teardown.
- This explicitly includes the opt-in **`learnings-audit`** gardener when it is registered:
  `/setup-automations learnings-audit=true` registers it under the same prefix, so teardown removes
  it with the rest. A conditionally-skipped loop (e.g. `exploratory-bugs` on a stack without
  `exploratory-qa`) simply is not in the sweep.
- **Never** remove automations for a different project, or any non-Lisa automation (e.g. unrelated
  crawlers/ingestors). Match strictly on the `lisa-auto-<project>-` prefix for THIS project; when in
  doubt about an automation's ownership, leave it and report it rather than deleting it.
- **Idempotent** — an automation that is already absent is a no-op, not an error. Re-running when
  the prefix sweep finds nothing is a clean, successful no-op.
- **Leave the runbooks alone.** The checked-in `.lisa/automations/<loop-id>.runbook.md` files that
  `/setup-automations` scaffolded are project knowledge and the historical record of what these
  loops did. Teardown removes scheduler registrations only; it never deletes, edits, or moves a
  runbook file. An operator who wants them gone removes them deliberately, in git.

## Answering a `policy-obsolete` teardown proposal

Running this skill with the proposing loop id is the **approve** answer to a loop's own retirement
proposal. When a registered loop's runbook **Retirement condition** trips, that loop records the
`policy-obsolete` run outcome and files exactly one ticket recommending its own teardown
(`automation-runbook-contract`) — and then keeps running at its normal cadence, because a loop never
removes its own registration.
Teardown is **always human-invoked**: it is never
triggered by a loop, on any schedule, for any outcome. The operator has three answers, and only the
first brings you here. The proposal authorizes only that loop's registration unless the human
explicitly asks for fleet teardown.

1. **Approve** — run this skill with the proposal's loop id, e.g.
   `/lisa:tear-down-automations monitor`. When it has run, close the proposal as **Completed**: the
   loop-scoped teardown it asked for actually happened, and Completed is the close reason that says
   so.
2. **Decline** — close the proposal as **Not planned** (that close reason is what stops the loop
   re-raising it; **Completed** would leave a later re-file open). The loop simply continues at its
   normal cadence, and nothing is removed.
3. **Re-cadence** — you pick the longer cadence and re-register the loop with
   `/lisa:setup-automations`; the loop never adjusts its own schedule. The proposal's evidence
   carries the loop's **current cadence** as the baseline to choose against, plus a one-line summary
   of its recent runs. Then close the proposal as **Completed** — the schedule change is the action
   it asked for.

## Report

List each automation removed by name. For "already absent", compare against the one source of truth
— the fleet `scripts/automation-status-expected-fleet.mjs` (`resolveExpectedAutomationFleet`)
resolves for this project — and name anything it expects that the sweep did not find; that is a
no-op, not an error. Do not invent an expected set of your own.

Then state, in the operator's words, that the runbook files under `.lisa/automations/` were left on
disk **and why**: they are the written record of what those jobs did, kept on purpose, and if you
do not want them you delete them yourself in git. Finally, confirm that nothing outside this
project's `lisa-auto-<project>-` prefix was touched. Write it so a non-technical operator can
confirm what happened without reading code.

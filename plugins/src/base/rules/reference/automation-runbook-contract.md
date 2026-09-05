# Automation Runbook Contract

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Automation Runbook Contract (load-bearing)

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

For an interactive flow the required run record is the **final user-facing message**, not a JSONL
row written by `automation-run-record.mjs`. Interactive flows may also record local JSONL telemetry
when a specific skill owns that surface, but this contract's mandatory record is the final answer.
It opens with the outcome and the operator action, before any narrative:

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
  A queue scanner's `nothing-needed` summary must name the lanes it swept and the total open — a dry
  queue and a wrong denominator are otherwise indistinguishable. See the reference body.
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

---

Scheduled loops are the busiest machinery in the factory and historically the least explicitly
contracted: what a loop maintains, what it may do on its own, what it must escalate, and when it
should stop existing all lived implicitly in each loop's prose. The cost lands on the operator — a
quiet run and a broken run look identical, and "what is this scheduled thing?" has a different
answer shape for every loop. This contract writes the answer down once.

It is a **single vendor-neutral contract** consumed by `lisa-setup-automations` (which scaffolds a
runbook per registered loop), `lisa-automation-status` (which reads runbooks and run outcomes back
to an operator), `lisa-tear-down-automations` (which acts on retirement proposals), and every
registered loop skill (which conforms its own run to it). Each consumer cites this slug; none of
them redefines it.

**Membership is registration, not skill-existence.** A loop falls under this contract when it is
registered as a scheduled automation on the host project's runtime scheduler — not when its skill
file happens to exist in the plugin tree. Registering a new loop pulls it in automatically, and
un-registering drops it. Nothing in this contract, in the scaffolder, or in the status surface may
carry a hardcoded roster of loops; the worked example below names one loop as illustration only.

## The runbook template

Every registered loop's runbook has these ten sections, in this order. Each is answered in prose a
non-technical operator can read (`factory-model` rule 5).

| Section | What a good answer looks like |
|---|---|
| Intent | One sentence naming what this loop maintains, in outcome terms, not mechanism terms. |
| Sources of truth | The exact surfaces the loop reads, each reachable through its access layer (`integration-access-layer`) — never a direct vendor API call. |
| Candidate selection | The query or filter that decides what this run acts on, and the bound on how many. |
| Scope/bounds | What the loop will never touch, and the cap that keeps one run finite. |
| Proof | What the loop must observe before claiming it changed anything — the evidence it records. |
| Autonomous-vs-approval boundary | The named line: what it does alone, and the first thing on the other side that requires a human. |
| Escalation | What it files when it cannot proceed — always the decision-ready packet below. |
| Recovery | What a human or the next run does to get the loop working again after `recovery-required`. |
| Next-run state | What the next run can observe from this one, derived from durable surfaces (tracker, records) rather than in-process memory. |
| Retirement condition | The stateless, tracker-derived condition under which this loop proposes its own teardown. |

### Worked example — the `intake-tickets` loop

```text
Loop: intake-tickets

Intent
  Keeps the build queue moving: work items a human marked ready get built, reviewed, and shipped
  without anyone having to hand them to an agent.

Sources of truth
  The configured tracker's build queue (the ready/claimed/done lanes from .lisa.config.json), read
  through the tracker access layer; the item's own comments and linked PRs.

Candidate selection
  The oldest eligible leaf work item currently in the ready lane, one per run. Containers with open
  children are repaired out of the queue, never built.

Scope/bounds
  Only items in this repo's configured queue. It never edits the ready lane's meaning, never
  invents work items, and never processes more than its per-run cap.

Proof
  A merged pull request plus the project's own verification evidence posted back to the work item;
  a claim of "done" without that evidence is not made.

Autonomous-vs-approval boundary
  Alone: claim, plan, implement, open the PR, drive it to merge. Requires a human: anything that
  needs a protected deployment approval, and any item whose requirements it cannot resolve — that
  becomes a blocked work item with clarifying questions, not a guess.

Escalation
  When the loop itself cannot proceed (tracker credentials revoked, queue unreadable), it files the
  decision-ready packet below, labeled status:blocked + human-needed.

Recovery
  A human restores the named access, then flips the escalation item closed; the next scheduled run
  resumes with no manual replay needed.

Next-run state
  Nothing in memory. The tracker lanes and the run records are the state: a claimed item that never
  finished is visible as claimed, and the repair path picks it up.

Retirement condition
  Propose teardown when BOTH hold: no work item has entered this queue for 30 consecutive days, AND
  this run proposed nothing. It files one teardown-proposal item and keeps running at its normal
  cadence until someone approves, declines, or re-cadences it.
```

That example's 30-day retirement row is **illustration of the shape, not the shipped default**: the
seed `lisa-setup-automations` writes declares the three `intake-*` loops structural to the factory,
whose runbooks state plainly that they do not retire. The mechanism below is normative; the numbers
above are only a filled-in example.

## The six run outcomes

Exactly one per run. The one-line operator summary is not optional — it is what the status surface
shows and what makes the outcome actionable.

Health and operator action are **orthogonal**: several healthy outcomes still want an answer, and
only `recovery-required` means the machinery itself is broken.

| Outcome | Definition | Healthy? | Operator action? | One-line summary must contain |
|---|---|---|---|---|
| `nothing-needed` | The loop ran end to end and found nothing to act on. | Healthy — **no operator action** | None. | What was scanned, how much was seen, and "nothing to propose". |
| `candidate-proposed` | The loop proposed work — a ticket, PRD, or recommendation — for a human or a downstream factory. | Healthy | Review the proposed item and flip it ready when you want it built. | What was proposed and where to find it (item refs). |
| `change-proved` | The loop made a change and proved it with evidence. | Healthy | None — informational. | What changed and the evidence that proves it. |
| `approval-requested` | The loop reached its autonomous/approval boundary and asked a human. | Healthy | Answer the approval question. | What is waiting, on whom, and what happens if nobody answers. |
| `recovery-required` | The loop itself could not complete: access, tooling, or substrate is broken. | **Not healthy** — needs a human | Restore the named capability, then close the escalation item. | What broke, and the escalation item to act on. |
| `policy-obsolete` | The loop's own retirement policy — the retirement condition written in its runbook — tripped, so it proposed its own teardown. | Healthy | Decide: approve the teardown, decline it (close the proposal as **Not planned**; the loop continues at cadence), or re-cadence it. | Why it looks obsolete and the teardown-proposal item. |

### Exemplar one-line summaries

These set the register every conforming loop copies — plain, specific, and actionable without
reading code:

```text
nothing-needed      Scanned 12 ready items; nothing to propose.
candidate-proposed  Proposed #1810 to fix the failing checkout step; awaiting your flip to ready.
change-proved       Merged #1811 raising coverage to 84%; CI green and evidence posted on the item.
approval-requested  Deploy to production is waiting on your approval; nothing ships until you answer.
recovery-required   Lost access to the tracker; filed #1812 with the one decision needed to restore it.
policy-obsolete     No work has reached this queue in 30 days; proposed teardown in #1813.
```

### `nothing-needed` states its denominator

A queue-scanning loop that reports nothing is only as trustworthy as the set it looked at, and a
summary of the form "scanned N items" hides the one thing worth checking: **which lanes N came
from.** So a `nothing-needed` summary from a queue scanner names the lanes it swept, the count in
each, and the total open — `Looked in every lane holding work that has not started — Backlog (20),
Todo (17), Ready (2), Blocked (61) — 100 items checked out of 343 still open.`

This is a measured requirement, not a style preference. One build lane reported 31 consecutive dry
cycles over a queue holding 61 unswept rows, at least one of them buildable for ~15 hours. Every
one of the 31 records was honest and every conclusion was false, because the scanner never said
what its denominator was. **A missing run record is noisy on inspection; a wrong denominator is
silent forever and looks exactly like a healthy dry queue.** Stating the swept set is what makes
the second failure mode visible at all.

The build-intake loop enforces this rather than requesting it: `automation-run-record.mjs` refuses
a `nothing-needed` row for `intake-tickets` unless the call carries a `--denominator` built by
`scripts/intake-prework-denominator.mjs`.

**No silent exit.** Every run posts its outcome and its one-line summary before stopping —
including the trivial early terminations (empty queue, nothing eligible, already-claimed) — so
there is no silent exit for an operator to misread as health. A run that ends without a
recorded outcome is indistinguishable from a crashed scheduler, which is exactly the ambiguity this
contract removes. This generalizes `lisa-improve-harness`'s result-record discipline — every
terminal step posts its result record before stopping, so there is no silent exit — from one flow to
every registered loop.

The local storage substrate is `plugins/src/base/scripts/automation-run-record.mjs`. It writes one
bounded JSONL file per loop at `.lisa/automations/runs/<loop-id>.jsonl`, with one object per line:
`{ ts, loop_id, outcome, summary, runbook, refs[], run_id }`. The helper rejects any outcome outside
the closed six-value vocabulary, requires a non-empty operator-readable summary, suppresses duplicate
re-appends for the same `run_id`, skips corrupt/truncated lines on read, and trims to the newest
configured records on write. The default bound is 50 records per loop, overridable via
`.lisa.config.json` / `.lisa.config.local.json` `automations.runHistory.maxEntries`. These records
are local scheduler observations, not project knowledge, so `.lisa/automations/runs/` is ignored;
the runbooks under `.lisa/automations/*.runbook.md` remain checked-in knowledge.

## A run outcome is not a work-item lifecycle terminal state

This is the highest-risk seam in the contract, so it is stated explicitly.

- A **run outcome** describes the LOOP ITERATION — how this scheduled execution ended.
- A **terminal state** describes a TICKET — Lisa already uses that phrase for work-item lifecycles
  (`lisa-intake`: "`Blocked` is a valid terminal state of the downstream lifecycles"; see
  `prd-lifecycle-rollup`).

They never merge in an operator-facing report. A perfectly healthy cycle that routes a work item to
`Blocked` — because the item's requirements are unresolvable and a human must answer — is
`candidate-proposed`: the run produced something (a blocked item carrying clarifying questions), so
it is **never `nothing-needed`**, which is reserved for runs that found nothing at all, and **never
`recovery-required`**, which means the machinery is broken. Conflating a blocked work item with a
broken loop would paint healthy intake cycles permanently red and train operators to ignore the
fleet verdict.

## Escalation — the decision-ready packet

A loop that cannot proceed escalates by filing a tracker item (through `lisa-tracker-write`, per
`tracked-work` and `integration-access-layer`) labeled **`status:blocked`** and **`human-needed`**,
containing exactly these fields.

Every escalation is a **declared human gate** under `ready-role-filing`: it passes
`human_gate: "<the smallest unresolved choice>"` so the writer stamps the auditable
`[lisa-human-gate]` marker. An escalation is precisely a filing whose readiness a human owns, so
omitting the flag and relying on a tracker default would make a deliberate gate indistinguishable
from the accidental non-ready filing that rule exists to catch.


| Field | Content |
|---|---|
| Current state | Where things stand right now, in plain terms — what is and is not working. |
| Work already attempted | What the loop tried on its own before escalating, so nobody repeats it. |
| Evidence | Links to the runs, items, logs, or records that show the problem (the evidence packet from the evidence PRD is the carrier; this contract names it and defines no evidence formats). |
| Risk of inaction | What degrades or stops if nobody acts, and how soon. |
| Smallest unresolved choice | The single smallest decision a human must make — one question, not a list — stated with **named options** (or as a yes/no), and what the loop will do with each answer. |
| How to answer | The mechanical response path: comment on the item, flip a label, or close it — so the operator never has to guess how to reply. |

The wording requirement is binding: a **non-technical operator must be able to act on the packet
without reading code** (`factory-model` rule 5). A stack trace may be attached as evidence, but the
packet must stand without it.

## Retirement condition

A loop that no longer earns its schedule should say so. The condition is **stateless — derived from
the tracker, never from a counter or a state file** (there is no durable home for a run counter, and
a tracker-derived condition is headless- and concurrent-safe by construction). This generalizes the
*Retirement condition* section of `lisa-learnings-audit`, which already retires itself this way; its
current wording still uses the older three-value "terminal states" vocabulary, and the
loop-conformance ticket conforms it to the six run outcomes above. A loop proposes retirement when
BOTH hold:

1. **Quiet trailing window** — a date-filtered tracker search finds nothing this loop produced
   within its trailing quiet window (sized to a small multiple of its cadence).
2. **This run proposes nothing** — the current run yields zero candidates (it is otherwise ending
   `nothing-needed`).

When both hold, the run ends `policy-obsolete` and files **exactly ONE marker-deduped**
teardown-proposal item — matched on the marker, never the title — carrying the date-filtered search
result and this run's summary as evidence, and proposing either a longer cadence or
`lisa-tear-down-automations`. The loop **keeps running at its normal cadence** until an operator
flips that proposal one of three ways: **approve** it (`lisa-tear-down-automations` runs and the
registration goes away), **decline** it (close the proposal as **Not planned** — closing it as
**Completed** leaves a later re-file open, per `rejection-detection`'s proposal rejection memory;
either way the loop simply continues), or
**re-cadence** it (register it at the longer cadence instead of tearing it down). Retirement is a
recommendation like any other, **never a self-executed exit**: a loop never deletes its own
registration, and a proposal nobody answers changes nothing.

## Never block, always degrade

A loop degrades rather than blocking. Three triggers are expected and must never crash a run:

- **A missing runbook** — the loop runs on the contract's defaults and says so.
- **An unreadable record surface** — the loop still reports its outcome and summary in its own run
  output, so the operator is never left with silence.
- **An absent optional dependency** — a skill or surface that ships with a sibling ticket is not
  yet installed; the loop skips that enrichment and continues.

A degraded run still **reports its actual outcome from the same six values** — degradation does not
mint a seventh token and, on its own, is not `recovery-required`. Its one-line summary **leads with
the degradation**, then states the outcome:

```text
Runbook missing — ran on defaults; nothing to propose.
```

Degradation becomes `recovery-required` only when it prevents the loop from doing its actual job
(the queue itself is unreadable, credentials are revoked) — and then it escalates the decision-ready
packet above. A degraded run never blocks other work and never leaves the run unreported.

## Citing adjacent work

Cite these by name. The run-record substrate ships with that ticket (#1797), do not assume its file
is present in older branches. The evidence packet ships with that ticket, do not assume its file is present in this branch. Other adjacent artifacts keep their own lifecycle: the runbook scaffolding
that instantiates this template (#1796), and the evidence packet defined by the evidence PRD (#1738)
— named here, with no evidence format defined by this contract. Rejection memory extends
`rejection-detection`; this contract neither restates nor overrides it.

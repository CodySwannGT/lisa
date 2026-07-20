---
name: lisa-learnings-audit
description: "The gardener of the learnings ladder (PRD #1729). Periodically audits every knowledge surface — ledger, rules trees (including Lisa's own shipped eager rules), skills, wiki index, and mechanical-control surfaces — gathers evidence per item (recurrence, staleness, redundancy, contradiction, budget pressure), classifies each candidate through the ladder router (skill-evaluator, advisory), and communicates exclusively through the tracker: one evidence-bearing ticket per PROMOTE/DEMOTE, one batch ticket per run for CONFIRM/RETIRE, upstream Lisa issues for upstream-scoped patterns. Everything is human-gated at v1 — the skill only files tickets; humans gate by flipping status:ready or closing as rejected, and rejections are remembered. Cron-able via lisa-setup-automations and runnable on demand via /lisa:learnings:audit."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Learnings Audit (the gardener): $ARGUMENTS

Run one audit cycle over this project's knowledge surfaces and convert what the
evidence supports into **human-gated tracker tickets** — nothing else. The
gardener is the only flow in Lisa that takes knowledge *back out* or moves it
*up* the ladder; it closes the loop that capture (learner, debrief-apply, MLD)
opens.

`$ARGUMENTS` (all optional): `max_candidates=<n>` (default **10** — cap on
per-item PROMOTE/DEMOTE tickets filed per run, following the
`lisa-repair-intake` bounded-cycle precedent; CONFIRM/RETIRE batch rows are
not capped), `surface=<ledger|rules|skills|wiki|all>` (default `all`),
`dry_run=true` (report what would be filed, file nothing).

## Intent

Keep the knowledge system from silting up: every learning lives at the
cheapest rung that still prevents the mistake (per the six-rung ladder,
PRD #1729), prose never duplicates a mechanical owner, the eager tier shrinks
over time, and every change to "what the agents believe" is approved by a
human through the tracker. A quiet run with nothing to propose is a healthy
outcome and says so in its one-line summary.

## Sources of truth

Inventory these surfaces each run — discover dynamically, never from a
memorized list:

1. **The ledger** — resolve via `.lisa.config.json` (`learnings.file`, default
   `.lisa/PROJECT_LEARNINGS.md`) and read it ONLY through the executable
   contract from `@codyswann/lisa/learnings`: `parseLearningsFile` for the
   **full parse** (the gardener is the maintenance loop — auditing requires
   every entry, and the contract-mediated full parse is its documented
   exemption from projection-only serving) plus `projectLearnings` for the
   bounded projection (to measure **budget pressure**: how many entries the
   projection omits). Never hand-parse or hand-edit the raw file.
2. **Rules trees** — the plugin `rules/eager/` + `rules/reference/` pairs AND
   the host project's `.claude/rules/` (e.g. `PROJECT_RULES.md`, which is
   human-authored only — its existing sections are still audit candidates;
   first-run candidates come from exactly there).
3. **Skills** — `.claude/skills/` and the plugin skill roots the runtime
   exposes (descriptions are eager context; bodies load on invoke).
4. **The wiki index** — `wiki/index.md` when the project has a wiki.
5. **Mechanical-control surfaces** — lint configs (ESLint/oxlint), ast-grep
   rules, git hooks, test suites, and `package.lisa.json` force sections:
   the surfaces that answer "does a mechanical owner already exist?".
6. **The tracker** — prior gardener tickets (open, done, and closed-rejected)
   are its memory; see Idempotency.

## Candidate-selection rules

A surface item becomes a candidate only when evidence supports a change.
Gather, per item, the five evidence axes:

| Axis | Question | How |
|------|----------|-----|
| **Recurrence** | Has the same failure class recurred since the entry's `last_confirmed` (or the rule's last touch)? | Search issues/PRs/commits since that date — reuse the `git-history-analyzer` agent for commit/PR archaeology; tracker search for issue recurrence. |
| **Staleness** | Does the item reference files, flags, versions, or tools that no longer exist? | Glob/Grep the referenced paths and configs. |
| **Redundancy** | Does a mechanical owner already enforce the invariant? (The double-payment hunter.) | Check lint/ast-grep/hook/test/force surfaces for the same invariant. |
| **Contradiction** | Does the item contradict another rule, skill, config, or observed current behavior? | Cross-reference the inventoried surfaces. |
| **Budget pressure** | Is the ledger projection omitting entries, or the eager tier growing? | `projectLearnings` omission count; eager-tree token/size trend. |

Selection outcomes per candidate: **PROMOTE** (up the ladder), **DEMOTE**
(down the ladder), **CONFIRM** (evidence the entry demonstrably applied —
a `last_confirmed` bump), **RETIRE** (provably redundant/stale — proof, not
vibes), or leave alone. No evidence ⇒ no candidate; the gardener never files
a recommendation it cannot evidence.

**The eager tier is audited every run** — including
**Lisa's own shipped eager rules**, not just host additions. Admission is demotion-biased and
earned only by repeated-miss evidence (see the `promotion-contract` rule);
an eager rule without that evidence gets a DEMOTE candidate citing the
admission policy, scoped upstream when the rule ships with the kernel.

**Exclusions (no learning loops about learning).** Never candidates, never
evidence:

- The gardener's own tickets, PRs, and comments (anything carrying the
  `[lisa-gardener]` marker).
- All learning-machinery artifacts: items carrying `[lisa-learning-drop]`,
  `[lisa-learning-pr]`, `[lisa-learning-upstream-handoff]` (any
  `[lisa-learning-*]` marker), `[lisa-rejection-candidate]`, or
  `[lisa-archaeology-candidate]`, and the `learning:needs-triage` label.

## Scope

- **In scope**: recommending placement changes for knowledge on any
  inventoried surface, in this repository (`project` scope) or upstream in
  `CodySwannGT/lisa` (`upstream` scope).
- **Out of scope**: executing any promotion/demotion/retirement (the factory
  does, per flipped tickets), editing any knowledge surface, auto-apply modes
  (v1 is fully gated), and the capture streams (learner, debrief, MLD).

## Proof

A run is proven, not asserted. The per-run report (and the run ticket, when
one exists) must show:

- The surfaces inventoried, with counts (ledger entries parsed, rules files,
  skills, wiki pages, mechanical controls).
- Per filed ticket: the fingerprint marker, the evidence refs behind it, and
  the router's rung — so any reviewer can replay the reasoning from links
  alone.
- Per skipped candidate: which dedupe hit suppressed it (open ticket URL,
  done ticket, or rejection date).
- For `nothing-needed`: the thresholds nothing met, in one line.

The tickets themselves are the durable artifacts; the report is how a human
audits the auditor without re-running it.

## The audit cycle

1. **Inventory** the sources of truth above.
2. **Evidence** — gather the five axes per item; drop items with none.
3. **Classify** — pass each candidate (`rule`, `why`, `provenance`,
   `evidence`) to the ladder router (the `skill-evaluator` agent). The router
   is **advisory**: it returns `rung`, `scope`, `rationale`, and
   `drafted_artifact`; the gardener decides whether the evidence clears the
   filing bar and attaches the router's draft to the ticket.
4. **Emit** (see Ticket emission).
5. **Report and record** the run outcome and one-line summary — post the
   outcome, then record **exactly one** run-record line through the CLI (see
   Run outcomes), including the escalation path when it ends
   `recovery-required`.

## Ticket emission

All project-tracker writes go through **`lisa-tracker-write`** so gardener
tickets pass the same validation gates as all factory work. Nothing is created
`status:ready` — the human flips.

**Per-item tickets — PROMOTE / DEMOTE** (`issue_type: Task`; GitHub trackers
carry the `type:Task` label) — one ticket per recommendation, capped by
`max_candidates`:

- A **three-audience description** (operator: what changes about what the
  agents believe and why it is safe; engineering: the surface, the invariant,
  the destination rung; QA: how to verify the move) with **evidence links**
  (the recurrence issues/PRs/commits, the staleness proof, the mechanical
  owner).
- The router's **`drafted_artifact`** verbatim (the lint/hook sketch +
  diagnostic text, proposed rule text, skill outline, page outline, or
  redundancy proof).
- For **EXECUTABLE-CONTROL** promotions, embed the promotion-contract AC
  template below **verbatim** (markers included — do not paraphrase, reorder,
  or partially quote it; it is the single source of truth from the
  `promotion-contract` rule):

<!-- promotion-contract-ac-template:start -->
### Acceptance Criteria (promotion-to-control contract)

One atomic PR that satisfies all four legs — a PR missing any of the four is
rejected by rule (see the `promotion-contract` rule):

- [ ] **Enables the control** — the lint / ast-grep / type constraint / test /
      hook / `package.lisa.json` force entry is active and blocking.
- [ ] **Fixes the existing violation population** — every current violation is
      migrated in this same PR, so the control lands green with no blanket
      ignores.
- [ ] **Ships a remediation-teaching diagnostic** — the failure message states
      the violated invariant, why it holds, and the concrete fix.
- [ ] **Deletes the superseded prose** — the ledger entry / rules section this
      control replaces is removed in this same PR, citing the new mechanical
      owner.
<!-- promotion-contract-ac-template:end -->

**One batch ticket per run — CONFIRM + RETIRE** (`issue_type: Task`): a single
ticket listing every CONFIRM row (`last_confirmed` bump, with the evidence the
entry demonstrably applied) and every **provably-redundant** RETIRE row (with
the mechanical owner / staleness proof per row). Rows are individually
strikeable — the human deletes rows they reject, then flips the ticket ready.
The gardener **never bumps `last_confirmed` itself**: the bumps are executed
by the **implementing factory run** that picks up the flipped batch ticket.
Embed the following execution contract **verbatim** (markers included — do
not paraphrase, reorder, or partially quote it) in every batch ticket, so the
implementing run receives its instructions inside the work item:

<!-- gardener-batch-ticket-template:start -->
### Execution contract (CONFIRM/RETIRE batch)

- Apply each surviving CONFIRM row via `confirmLearningEntry` from
  `@codyswann/lisa/learnings` — never hand-edit the ledger.
- Implement each surviving RETIRE row as a proof-citing deletion PR per the
  `promotion-contract` rule's reverse-atomicity clause: the deleting PR must
  cite the row's mechanical owner or staleness proof.
- Struck/deleted rows are human rejections — skip them; they are not re-filed
  without new postdating evidence.
<!-- gardener-batch-ticket-template:end -->

**Upstream scope** → an issue on `CodySwannGT/lisa` (resolve via
`hardening.upstreamRepo`, default `CodySwannGT/lisa`), following the
`lisa-rework-triage` "Filing upstream" procedure and its two lanes:
`self-hardening` for defects, `template-candidate` for generalizable patterns
(with the required `## Proposed template change` section). Same dedupe-marker
+ evidence-chain discipline; the gardener's fingerprint marker (below) rides
in the issue body.

## Idempotency

Every recommendation carries a stable fingerprint embedded as an HTML comment
marker in the ticket/issue body:

```
<!-- [lisa-gardener] key=<surface>+<invariant-hash> -->
```

where `<surface>` names the audited artifact (e.g. `ledger:<entry-id>`,
`rules-eager:<file>#<section>`, `skill:<name>`) and `<invariant-hash>` is
computed **deterministically — never estimated by the model**:

1. **Normalize** the invariant text: trim leading/trailing whitespace,
   collapse every internal whitespace run to a single space, lowercase.
2. **Hash** in Bash: `printf '%s' "$normalized" | shasum -a 256 | cut -c1-12`.

The same knowledge item therefore always produces the same key across runs,
regardless of which session computes it.

Before filing anything, search the tracker for the marker in
**open AND closed** issues — and key the search on the deterministic
`<surface>` prefix **first**, using the hash as disambiguation only, so even
a hash discrepancy can never cause a duplicate for the same surface:

```bash
gh search issues "[lisa-gardener] key=<surface>" --repo <upstream-or-tracker-repo> # searches open AND closed by default; --state all is NOT a valid gh search flag
```

plus a body-enumeration fallback for search-index lag (`gh issue list …
--json number,body` and grep bodies for `[lisa-gardener] key=<surface>`).
Among prefix hits, compare hashes to distinguish genuinely different
invariants on the same surface; a prefix hit with a mismatched hash is
resolved by reading the ticket, never by filing a sibling blind. Then:

- **Open** with the marker → do not re-file; append new evidence as a comment
  only if it is materially new.
- **Closed via merged work** → done; a genuine regression later is new
  evidence and a new ticket.
- **Closed unmerged / rejected** → the human declined. **Do NOT re-file**
  unless new evidence **postdates the rejection** — and when re-filing, state
  the postdating evidence explicitly in the ticket ("rejected <date>; recurred
  <date> in <ref>"). Closed-as-rejected tickets ARE the gardener's memory of
  declined recommendations.

Re-runs are quiet no-ops: same surfaces + same evidence ⇒ zero new tickets.

This open-and-closed marker search plus the "declined `<date>`; recurred `<date>` in `<ref>`"
re-file discipline is the shipped precedent for the **Proposal rejection memory** section of the
`rejection-detection` rule — the shared contract every proposing loop now consults so a
closed-as-not-planned proposal is never re-filed. The gardener already conforms; it is cited there,
not re-implemented. Like every proposing loop, each gardener-filed ticket MUST carry the
`rejection-detection` **operator footer** as a visible prose line so the human knows which
close-reason silences it: `To stop this from being raised again, close it as **Not planned**. Close
it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.`

## Autonomous-vs-approval boundary

**Everything is human-gated at v1 — this skill only files tickets.** The
gardener never edits, writes, or deletes any rule, skill, wiki page, ledger
entry, lint config, or hook itself; it never merges, transitions, or flips
anything to `status:ready`; it never bumps `last_confirmed`. Autonomous
actions are limited to: reading surfaces, gathering evidence, invoking the
advisory router, and creating/commenting marker-deduped tickets. Humans gate
by flipping a ticket to `status:ready` (the factory then executes it like any
work item, honoring the `promotion-contract` rule) or closing it as rejected.
A future `learnings.autoApply` config may widen this; v1 ships none.

## Escalation

Headless-safe: this skill **never prompts** — it is a cron target. When it
cannot proceed (tracker unreachable, contradictory config, ledger contract
error that blocks the parse), it labels its own run ticket — or, when it
cannot create one, reports in its summary — `status:blocked` + `human-needed`
with an **operator-readable** reason: what it was trying to do, what it
observed, and the smallest human action that unblocks it, in plain language a
non-technical operator standing at the gate can act on.

## Recovery

Every external write is marker-deduped, so a crashed or interrupted run
leaves no cleanup debt: re-running is the recovery procedure. A partial run's
already-filed tickets are found by their markers and not duplicated; a batch
ticket from an interrupted run is reused (append missing rows as a comment)
rather than reissued. **Filing order**: file the per-item PROMOTE/DEMOTE
tickets first and the CONFIRM/RETIRE **batch ticket last** — the batch is the
run's completion signal, so a crash mid-run leaves individually
marker-recoverable per-item tickets and a missing (not half-filled) batch:
the most recoverable state. Never attempt to "roll back" filed tickets —
close-out decisions belong to humans.

## Run outcomes

Exactly one per run, from the closed six-value vocabulary of the
`automation-runbook-contract` rule:
**`nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete`**.

This section supersedes the gardener's earlier three-value *terminal states*
vocabulary (`nothing-needed | candidates-proposed | blocked`); the mapping is
exact so nothing regresses:

- `candidates-proposed` → **`candidate-proposed`** — per-item and/or batch
  tickets filed. Report each ticket URL, its recommendation (PROMOTE/DEMOTE +
  rung), and the batch ticket URL with its row count.
- `nothing-needed` → **`nothing-needed`** (unchanged) — no candidate met any
  recommendation threshold. Report one line: surfaces scanned, entries seen,
  "nothing to propose".
- `blocked` → **`recovery-required`** when the loop itself could not complete
  (tracker unreachable, contradictory config, a ledger-contract parse error) —
  escalated per Escalation with the operator-readable reason; **or**
  **`approval-requested`** when the run finished and is waiting on a human gate
  rather than being broken.

The gardener also newly reaches **`policy-obsolete`** — the Retirement
condition below tripped and it filed its own teardown proposal. It never
produces **`change-proved`**: the gardener only files tickets and ships no
change itself, so proving a change is the implementing factory run's job.

Record exactly one outcome per run through the run-record CLI, naming this
loop's runbook (the `--summary` is the operator-readable one-liner in the
contract's exemplar voice — plain, specific, actionable):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id learnings-audit --outcome candidate-proposed \
  --summary "Proposed 2 promotions and 1 batch confirm; awaiting your flip to ready." \
  --runbook .lisa/automations/learnings-audit.runbook.md [--ref <ticket-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory
directly — the built copy `plugins/lisa/scripts/automation-run-record.mjs` or
the source `plugins/src/base/scripts/automation-run-record.mjs`. If recording
still fails, **degrade, never abort** (per `automation-runbook-contract`): note
the recording failure in the run output and finish the run — a recording
failure is a degradation to report, never a reason to block the loop.

## Retirement condition

The loop proposes retirement by the same discipline it applies to everything else,
conforming to the `automation-runbook-contract` rule's Retirement section
rather than restating or diverging from it. The condition is **stateless —
derived from the tracker, never from a
counter or state file** (there is no durable home for a run counter, and a
tracker-derived condition is headless- and concurrent-safe by construction).
Propose retirement when BOTH hold:

1. **Quiet trailing window** — a date-filtered search finds NO
   `[lisa-gardener]` ticket created in the
   **trailing six-week window** (six runs at the weekly cadence), e.g.
   `gh search issues '"[lisa-gardener] key="' --created ">=<six-weeks-ago>"`.
2. **This run proposes nothing** — the current run's inventory yields zero
   candidates (it is terminating `nothing-needed`).

When both hold, the gardener records `policy-obsolete` and files **exactly ONE**
marker-deduped ticket proposing to lengthen its cadence or tear down its
automation, through `lisa-tracker-write` (per `tracked-work` +
`integration-access-layer`):

- **Marker** `<!-- [lisa-automation-retire] key=learnings-audit -->` plus a
  visible prose line; matched on the marker, never the title; searched **open
  AND closed** per `rejection-detection`'s **Proposal rejection memory**. Treat
  matches by close state: **open** suppresses another proposal; **Not planned**
  suppresses another proposal unless new evidence postdates the rejection;
  **Completed** means the prior approved action happened, so a later recurrence
  may be re-filed. The `[lisa-gardener]` search above stays what it is — the
  candidate evidence, not the dedupe key. When an existing proposal suppresses
  filing, **the run still records `policy-obsolete` and files nothing** — the
  outcome describes this run, while the ticket is filed exactly once.
- **Labels** `status:blocked` + `human-needed`, carrying the contract's
  decision-ready packet. The `human-needed` label marks the proposal
  human-owned: `lisa-repair-intake` recognizes it and never re-dispatches it as
  stalled work.
- **Evidence** the date-filtered search result, this run's summary, **the
  loop's current cadence** (the baseline an operator needs to choose a longer
  one), and a one-line summary of recent runs read from
  `.lisa/automations/runs/learnings-audit.jsonl`. Fill the rest of the packet
  the same way every time: *Work already attempted* is the searches this run
  ran, and *Risk of inaction* is that the loop keeps consuming schedule slots
  and tokens for nothing.
- **How to answer** names the three operator responses: **approve** — run
  `/lisa:tear-down-automations learnings-audit` and only that loop registration goes away; **decline** —
  close the proposal as **Not planned** (closing it as **Completed** leaves a
  later re-file open) and the gardener simply continues; **re-cadence** — pick a
  longer cadence off that evidence and re-register with
  `/lisa:setup-automations` instead of tearing down.
- **Operator footer**, verbatim, as on every loop-filed proposal
  (`rejection-detection`):
  > To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

The gardener **keeps running at its normal cadence** until a human flips that
ticket — retirement is a recommendation like any other, never a self-executed
exit — and it never deletes its own
registration.

## Scheduling

Register as an **optional** recurring loop through `lisa-setup-automations`
(the `lisa-auto-<project>-*` naming convention): automation
`lisa-auto-<project>-learnings-audit`, running `/lisa:learnings:audit`, once
a **week** (Codex `rrule`: `FREQ=WEEKLY;INTERVAL=1`) — opt-in, created only
when the operator asks for the gardener loop, unlike the six default
automations. **Single-scheduled-runner assumption**: register at most ONE
learnings-audit automation per project. Also runnable on demand — but before
a manual `/lisa:learnings:audit`, confirm the scheduled automation is not due
or currently running (check the scheduler's last-run/next-run state) and
prefer waiting over racing it.

**Concurrency honesty.** Marker dedupe is search-then-write, not an atomic
claim: two truly concurrent runs can each miss the other's in-flight ticket
and file a transient duplicate. Dedupe therefore guarantees
**convergence, not mutual exclusion** — a duplicate is found and closed by
the next run's marker search (or by the human triaging the pair), and because
rejection memory keys on the surface prefix, a duplicate never multiplies.
This is an accepted trade-off for a weekly advisory loop; a tracker-side
locking protocol would be disproportionate to the risk.

## Rules

- Tracker-only output: no file edits, no PRs, no label flips beyond the
  gardener's own run-ticket escalation labels.
- Evidence or nothing: every recommendation cites concrete refs; RETIRE
  requires proof of redundancy/staleness, not vibes.
- One batch ticket per run, at most `max_candidates` per-item tickets.
- All ticket writes via `lisa-tracker-write` (or `gh` for the upstream repo,
  per the rework-triage upstream procedure) — never raw unvalidated creation.
- Never classify without the router, never file without the dedupe search,
  never re-file over a rejection without postdating evidence.
- No learning loops about learning: the exclusion registry is absolute.

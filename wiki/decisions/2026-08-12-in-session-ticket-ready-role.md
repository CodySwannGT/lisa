# Decision: In-Session Filed Tickets and the Ready Role

Date: 2026-08-12

Status: Accepted

Covers decision **D4** of `plans/improvement-notes-implementation.md` (work unit D,
with a fix routed to work unit M).

## Context

The originating observation: an agent closed a non-reproducing ticket, filed a real
defect it found next to it, and then left the new ticket sitting. Filing without the
ready role is an incomplete handoff — no other agent will ever pick it up.

Current behavior is inconsistent in three distinct ways.

**1. Loops differ, some deliberately.** `lisa-monitor`, `lisa-verify-prd`, and
`lisa-repair-intake` file with `build_ready: true`. `lisa-exploratory-qa` deliberately
defaults `ready=false`, creating findings in the backlog for a human to review and
promote. The standard in-session `lisa-track` path creates complete unmatched work as
a build-ready leaf before claiming it.

**2. Omitted `build_ready` means opposite things per provider.** On JIRA, omission
leaves the ticket in the project's default created status — **not ready**. On GitHub
and Linear, omission applies the ready role — **ready** (GitHub's validator even
documents normalizing omitted → true). The `lisa-tracker-write` shim does not
normalize; it is dispatch-only. So the same call produces different lifecycle
outcomes depending on a project's tracker.

**3. The Linear ready lane was corrupted upstream.** tunnlai `a8899a17` found Lisa's
Linear adapter mapping `workflow.ready` to `Todo` — which is where Linear puts a
brand-new issue. The ready lane therefore stopped meaning "a human explicitly flipped
this to build-ready" and started meaning "nobody has touched this": 20 issues sat in
the lane, 12 of them never marked ready, including decision tickets shaped like leaves
that the leaf-only gate could not catch.

## Decision

### 1. Complete defects found during other work are filed build-ready

Any defect discovered during other work that is complete enough to build goes through
`lisa-track` / `lisa-tracker-write` with **explicit `build_ready: true`**. No call site
relies on an omitted default. The SE-6799 case — a real defect found beside a
non-reproducing ticket — must be claimable by build-intake on the next cycle with no
human flipping status.

### 2. Omitted `build_ready` normalizes to **not ready**

All three vendor writers converge on: omission means the item does **not** enter the
ready role. Ready becomes an explicit claim, never an accident of which tracker a
project uses.

This changes GitHub and Linear behavior, so it is a breaking change for any caller
relying on the old implicit-ready default. That is acceptable and in fact the point:
every Lisa call site is being made explicit anyway (item 1 above), so the only paths
affected are ones that were silently depending on a provider-specific default — which
is exactly the class of bug this decision exists to eliminate. GitHub's validator
normalization (omitted → true) is removed in the same change.

### 3. Filing without ready and without a human-gate marker is incomplete

Writers treat "filed, not ready, no human-gate marker" as an incomplete handoff and
require one or the other: `build_ready: true`, or an explicit marker saying a human
product call is pending.

### 4. exploratory-qa keeps `ready=false` — it *is* the human-gate exception

This is ratified as correct, not fixed. Exploratory QA findings are candidate defects
whose product significance a human should judge; that is the same exterior-gate idea
as a held-back PRD. What was wrong was describing it as an inconsistency. It is now
documented as the named exception, and its `ready=false` is an explicit human-gate
marker rather than a bare omission.

### 5. The Linear ready-lane mapping is a bug, fixed separately

The `workflow.ready` → `Todo` mapping is corrected as a work-unit-M bug fix: the ready
state must be a lane a human moves an issue *into*, never the default state Linear
assigns on creation. Until that lands, no amount of correct filing behavior produces a
trustworthy queue on Linear.

### 6. Two claim-time guards are adopted from the fleet

Both come from geminisportsai's hand-rolled `sprint-loop` and address real observed
failures:

- **Already-implemented check.** A Ready ticket may already be implemented, because
  agents ship without transitioning. Before implementing, check `git log --all --grep`
  and open/merged PRs for the key; if found, switch to verify-and-close rather than
  building it twice.
- **Two-failed-attempts valve.** After two failed attempts on the same item, move it
  to blocked and stop the loop instead of burning cycles.

## Alternatives Considered

- **Normalize omitted `build_ready` to true.** Rejected: it makes the safe direction
  implicit. A ticket that reaches a build queue by accident is worse than one that
  waits, because the queue is the thing agents act on autonomously.
- **Leave per-provider defaults alone and just document them.** Rejected: the whole
  point of the vendor-neutral shim is that a project can switch trackers without
  changing behavior. A lifecycle outcome that depends on the vendor is a leak in that
  abstraction.
- **Auto-ready exploratory-qa findings too.** Rejected: exploratory findings are
  frequently non-defects or product questions. Auto-readying them would push judgment
  work into the build queue, which is precisely the failure the gate model prevents.

## Consequences

- Work unit D implements items 1–3 and 6; work unit M carries item 5.
- Any downstream caller that omitted `build_ready` on GitHub or Linear and relied on
  implicit ready must now pass it explicitly. Called out in release notes.
- `lisa-repair-intake` gains an optional sweep for recently filed tickets carrying
  neither the ready role nor a human-gate marker.

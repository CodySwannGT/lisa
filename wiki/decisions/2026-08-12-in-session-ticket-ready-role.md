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

**3. The Linear ready lane was corrupted upstream — since fixed.** acmeorgd `a8899a17`
found Lisa's Linear adapter mapping `workflow.ready` to `Todo` — which is where Linear
puts a brand-new issue. The ready lane therefore stopped meaning "a human explicitly
flipped this to build-ready" and started meaning "nobody has touched this": 20 issues
sat in the lane, 12 of them never marked ready, including decision tickets shaped like
leaves that the leaf-only gate could not catch.

**Verified against current source 2026-08-12: this is already fixed upstream.**
`LINEAR_WORKFLOW_DEFAULTS.ready` is `"Ready"`, not `"Todo"`
(`src/sync/lifecycle-defaults.ts:65-71`). The downstream evidence lagged current Lisa,
which is the same meta-finding the implementation plan records for the `skip_jobs`
row. The residual risk is *configuration*, not code: a project whose
`.lisa.config.json` pins `linear.workflow.ready` to a default-on-create state
reproduces the corruption locally. That is a `lisa-validate-tracker-mapping` concern,
not an adapter bug.

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

**The marker is `build_ready: false` passed explicitly.** There is no new field. Once
item 2 makes omission mean not-ready, the write-control input carries three distinct
states rather than two, and the third is the marker:

| `build_ready` | Lifecycle outcome | Handoff status |
|---|---|---|
| `true` | ready role applied | complete — build-intake claims it |
| `false` (explicit) | no ready role | complete — a human product call is pending |
| omitted | no ready role | **incomplete** — writers warn |

This is what makes item 4 coherent: exploratory-QA's `ready=false` is not an exception
to the marker rule, it *is* the marker, and the reason it reads as a deliberate gate
rather than a bare omission is precisely that it is explicit. The distinction is
caller-supplied and lives in the call, so it needs no persisted vendor field: what
persists is the absence of the ready role, and the marker's job is to certify at write
time that the absence was chosen. Writers surface omission as a warning rather than a
hard failure, so a legacy caller degrades to the safe direction instead of breaking.

**Scope.** This is a `lisa-tracker-write` contract obligation binding all three vendor
writers identically. Work unit D implements it together with item 2.

### 4. exploratory-qa keeps `ready=false` — it *is* the human-gate exception

This is ratified as correct, not fixed. Exploratory QA findings are candidate defects
whose product significance a human should judge; that is the same exterior-gate idea
as a held-back PRD. What was wrong was describing it as an inconsistency. It is now
documented as the named exception, and its `ready=false` is an explicit human-gate
marker rather than a bare omission.

### 5. The Linear ready-lane invariant holds; the code fix is already in

The invariant is ratified: the ready state must be a lane a human moves an issue
*into*, never the default state the tracker assigns on creation. The `workflow.ready`
→ `Todo` mapping that violated it **is already corrected upstream** (see Context 3),
so work unit M carries **no Linear adapter fix**. What M carries instead is the
narrower configuration guard: `lisa-validate-tracker-mapping` should fail when a
project's configured `ready` state is one the tracker assigns on creation, which is
the form the bug can still take in the field.

### 6. Two claim-time guards are adopted from the fleet

Both come from acmeorgb's hand-rolled `sprint-loop` and address real observed
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

- **Decision status is Accepted; implementation is entirely ahead of it.** Nothing in
  this record describes shipped behavior except item 5's adapter fix, which was
  already in before the record was written. Work unit D implements items 1–3 and 6;
  work unit M carries only item 5's configuration guard.
- Work unit D's surface for items 2–3 is concrete and currently *unchanged*: today
  `lisa-linear-write-issue` creates a leaf in the resolved `ready` state by default,
  `lisa-github-write-issue` applies `status:ready` unless `n: false`, and
  `lisa-github-validate-issue` explicitly normalizes an omitted `n` to `true`. All
  three must flip to not-ready-on-omission, and that validator normalization is
  removed. Test coverage must cover four cases per vendor — omitted, explicit `false`,
  explicit `true`, and exploratory-QA's explicit `ready=false` — in both the skill
  sources and the generated per-agent plugin artifacts, since the artifacts are what
  agents actually load.
- Any downstream caller that omitted `build_ready` on GitHub or Linear and relied on
  implicit ready must now pass it explicitly. Called out in release notes.
- `lisa-repair-intake` gains an optional sweep for recently filed tickets carrying
  neither the ready role nor a human-gate marker.

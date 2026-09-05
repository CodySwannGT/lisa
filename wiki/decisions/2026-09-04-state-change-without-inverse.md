# Decision: State Changes Must Carry Their Own Inverse

Date: 2026-09-04

Status: Accepted

Ticket: CodySwannGT/lisa#3865

## Context

Four defects were filed on one day — #3852, #3854, #3855, #3856 — and a fifth,
#3805, has the same shape. They are not four unrelated bugs. Each is **a state
change with no inverse**: something is applied to a work item or a config, and
nothing anywhere lifts it.

The class is hard to see because **each instance is correct at the moment it
fires**. A QA failure really did happen. A human really did need to judge that
item. A threshold exemption really was approved. Nothing is wrong at the site a
reviewer would inspect — the defect is entirely in the return path that was
never written, and **an absence does not appear in a diff**. That is why one
shape produced five separate tickets before anyone noticed it was one shape.

This page holds the census, the pattern that makes the next audit cheap, and one
ruling that should not be re-litigated.

## The pattern

> **Every control in this repository that has a working inverse got it by being
> self-voiding. Every control that lacks one is a durable record with no expiry.**

That is predictive, which is the point of writing it down. It says where to look
before anything is measured: find the durable records — a label, a marker
comment, a checked-in allow-list entry — and ask what removes each one. If the
answer is "a human remembers to", it belongs in the left column below.

One honest qualification, because the pattern was nearly stated too narrowly.
Three of the four defective controls are prose written onto a **work item**; the
fourth (#3856) is an entry in a **checked-in file**. The medium does not matter,
and including it would have made the rule miss that instance. **What matters is
durability without expiry**, whatever the substrate.

### Variant: an inverse that is prohibited rather than absent

A state change can also have an inverse that exists in principle and is
**refused by a second mechanism that is itself behaving correctly**. Observed
2026-09-04 in the agent harness rather than in this repository, which is why it
is not a census row: one component binds a session to a working tree without
being asked, and the isolation guard refuses operations that reach into another
tree — so the session cannot put back what it did not choose to take. Neither
component is wrong, which is why this is harder than a missing inverse rather
than easier.

This matters for the audit instruction below. Asking *"what removes this
state?"* returns **nothing** in both cases, but the remedies are opposite: an
absent inverse is fixed by writing one, while a prohibited inverse is fixed only
by changing the mechanism that refuses it. **Record which of the two you found**
— a ticket asking for a clear path where the clear path is forbidden cannot be
implemented, and it will read as ordinary work until someone tries.

## Census

Every row cites a location that supports its verdict. Line numbers are as of the
commit that introduced this page.

### No inverse

| Control | What sets it | What clears it | Citation | Ticket |
|---|---|---|---|---|
| `qa-fail` label | `lisa-qa-fail` applies it as the deterministic rework signal | **Nothing.** `lisa-qa-clear` moves tickets between *queue statuses* for non-user-facing repos; it never touches this label | `plugins/src/base/skills/lisa-qa-fail/SKILL.md:76`; `plugins/src/base/skills/lisa-qa-clear/SKILL.md:2-3` | #3855 |
| `[lisa-human-gate]` marker | Stamped into the item body when a human product call is pending | **Nothing.** The rule that defines the marker describes stamping it and reading it, and contains no removal, release, or lift path | `plugins/src/base/rules/reference/ready-role-filing.md:34,51,63` | #3852 |
| Threshold-ratchet allow list | Exemption additions are a Tier 3 change; the list is read from the baseline on a sync | **Nothing.** Entries are gated on the way in and never leave | `plugins/src/base/hooks/threshold-ratchet.mjs:14,29,203-204` | #3856 |
| Build attempt markers | Written into a work item's comments to count failed attempts | **Nothing.** The count is read fresh at every claim, and comments cannot be un-written — only superseded, which nothing checks for | #3854 | #3854 |
| Marker-only hold | A deliberately held item is filed with a marker and no ready role | **Nothing lifts it, and a label-keyed sweep can promote it anyway** — the hold and the sweep read different fields | #3805 | #3805 |

The last two rows cite their tickets rather than a file, because their evidence
is the measured behaviour recorded there rather than a single location. A reader
who wants a file citation for those should add one; **a row that cannot be
verified from this page is worth less than the four that can**, and saying so is
cheaper than implying a precision the row does not have.

### Has an inverse — the model to copy

| Control | Why it self-voids | Citation |
|---|---|---|
| Nightly-E2E bypass | **Auto-expires** (`bypass_max_hours`, hard ceiling 72). Returns the distinct verdict `bypassed` — a successful check carrying an immutable audit record that names *who waived what, under which ticket, and when the waiver expires* | `.github/workflows/nightly-e2e-health.yml:70-78` |
| Bootstrap window | While `bootstrap_until` is in the future, MISSING evidence is reported **with its expiry timestamp on screen** and does not block. A window beyond `bootstrap_max_days` is invalid configuration and fails, so the escape cannot be widened indefinitely | `.github/workflows/nightly-e2e-health.yml:57-66` |
| Grandfathered required contexts | The exemption **cannot grow**: membership was frozen when the ledger was written | `scripts/check-required-check-promotions.mjs:114-124` |

**The shape worth copying is in the first row's own words: the record says when
it expires.** An exemption that reports its own staleness needs nobody to
remember it — which is exactly what the five defective controls need and do not
have.

## The grandfathered ruling — settled, do not re-open

Contexts already required when the promotions guard shipped may declare
`"status": "grandfathered"`, which turns their problems into reported **debt**
(exit 0) rather than violations.

**This is deliberate and it is not an amnesty.** From the guard's own rationale:

> the entry must state in `debt` exactly what is unproven, and the context must
> appear in the ledger's frozen `grandfathered_contexts` list. That list was
> fixed when the ledger was written, so a NEW promotion cannot buy its way in by
> claiming to be old. Reddening `main` to punish yesterday's promotions would
> only get the guard deleted; recording what each incumbent has not proven is
> the part that keeps working.

Two reasons this survives the audit rather than failing it:

1. **The list is frozen**, so the exemption cannot grow — the failure mode of
   #3856 is structurally impossible here.
2. **The debt is named.** An incumbent is not excused; it carries a written
   statement of what it has not proven. That is an inverse in a different form:
   not an expiry, but a standing obligation a reader can act on.

A later audit encountering this list should read it as a considered exemption
with a stated rationale, not as an oversight of the class this page describes.

## Two things this page is not

**Not a demand that every exemption expire.** The grandfathered list is correct
without one, because it cannot grow and it names its debt. *Frozen* and
*self-voiding* are both acceptable; *durable and open-ended* is not.

**Not an argument for auto-clearing the five.** How each should be lifted is the
business of its own ticket — some want a command, some want an expiry, one
(#3805) may want the sweep to read a different field. This page says only that
each needs **some** inverse and currently has none.

## How to use this

When adding a control that marks, labels, holds, exempts, or blocks:

1. Name what removes it, before writing what applies it.
2. If the answer is "a human runs a command", say where that command is
   documented and who is expected to notice.
3. If the answer is "nothing", the control is not finished — and say
   whether the inverse is **missing** or **forbidden**, because those take
   different fixes.

And when auditing: **list the durable records, not the code paths.** The defect
is never visible at the site that applies the state — every one of the five reads
correctly there.

## Related

- CodySwannGT/lisa#3852 — human gate applied but never released
- CodySwannGT/lisa#3854 — attempt markers retire a work item permanently
- CodySwannGT/lisa#3855 — `qa-fail` never clears
- CodySwannGT/lisa#3856 — threshold exemptions never expire
- CodySwannGT/lisa#3805 — held work promoted by a label-keyed sweep

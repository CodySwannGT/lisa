# Repository Readiness Rubric

Lisa can already tell you whether it is *installed* correctly. It cannot tell you whether a
repository is somewhere an agent fleet can safely operate **unattended**. Those are two different
questions, and conflating them is how a brownfield onboarding ends in "we built a wiki, looks good"
instead of a verdict someone can act on.

This document writes the second question down once: **eight ownership dimensions** with concrete
warning signs, and **seven ship blockers** that, if any one of them stands, mean the answer is no.
It is documentation. Nothing here executes — the later tickets of PRD #1739 instantiate this rubric
rather than redefine it.

## Two readinesses, one report

| | Installation readiness | Repository readiness |
|---|---|---|
| Question | is Lisa installed and wired correctly here? | may an agent fleet operate here unattended? |
| Owner | `lisa doctor`'s shipped grouped checks (project detection, config, distribution, tracker preflight, automation prerequisites, …) | this rubric's eight dimensions |
| Answer shape | the shipped verdict ladder | the same shipped verdict ladder, plus a narrowed claim |

They are **orthogonal** — a repository can be perfectly installed and completely unready, or ready in
substance while Lisa's own wiring is incomplete. Both render in the same report, under separately
titled sections, so a reader is never left guessing which question a verdict answered. The doctor
mode that renders the repository-readiness group ships with **RRR-3 (#1855)**; do not assume that
surface is present in this branch.

## The eight ownership dimensions

Exactly eight, always reported, never silently omitted. Each row names what the dimension asks,
concrete warning signs an assessor can look for, and the **existing** Lisa rule or wiki page that
supplies its evidence. Cite those slugs; do not restate them, and do not invent a parallel vocabulary
for a concept another rule already owns.

| # | Dimension | The question | Warning signs | Evidence source (existing) |
|---|---|---|---|---|
| 1 | context/routing | Can an agent recover the real job from what is written down? | no canonical entry document; routing decided by tribal knowledge; ambiguous config resolution; a README that describes a system that no longer exists | `integration-access-layer`, `wiki-knowledge-source`, `config-resolution` |
| 2 | capabilities/tools | Is every tool the work needs *provably* reachable, not merely installed? | presence-on-PATH treated as access; no read-only probe before the work starts; agents inventing workarounds instead of breaking out | `tool-access-gate` |
| 3 | domain ownership | Are the business rules, glossary, and danger zones owned and written down? | undocumented money paths; migrations with no owner; irreversible jobs nobody has described | the wiki pages agent-ready's domain phase already produces |
| 4 | execution/proof | Can the claimed user-visible outcome be proved by running the system? | claims backed only by unit tests; no representative end-to-end journey; "verified" that names no boundary | `verification`, `empirical-inquiry`, `claim-evidence-mapping` |
| 5 | feedback/guardrails | Does a failing loop produce a named outcome and a runbook? | silent failures; no run-outcome vocabulary; no observability on the loops that run unattended | `automation-runbook-contract`, `observability-audit` |
| 6 | dependencies/supply chain | Is there a confidence model for what the repo depends on? | unpinned or unowned dependencies; no trust class; no decision record for why a risky dependency stays | `security-audit-handling` |
| 7 | delivery/authority | Does the thing that ships equal the thing that was validated, and does the credential that ships it carry only the authority it needs? | a release path that bypasses the validated artifact; broad-scope tokens; deploy credentials shared across environments | `claim-archaeology`, `security-audit-handling` |
| 8 | proportionality | Is the machinery proportional to the job, or is there scaffolding to subtract? | redundant checks that assert the same thing twice; abandoned harnesses still running in CI | `repo-scope-split`, and the scaffolding-subtraction candidates the journey work of **#1742** already surfaces |

**`SKIP` carries a reason and is never blank.** A dimension with no applicable evidence renders
`SKIP with a reason` — "no deployment target configured, so delivery/authority was not assessed" —
never an empty cell and never a silent omission. An unassessed dimension is a known unknown, and the
report says so.

## The seven ship blockers

A **ship blocker** is a condition that, standing alone, makes the claim "an unattended fleet may run
here" false. Each has a one-line test an assessor can apply and the dimension that owns it.

| # | Blocker | The test an assessor applies | Owning dimension |
|---|---|---|---|
| B1 | A realistic path causes **silent data loss** | can you name a plausible sequence that destroys or corrupts data with no error surfaced and no recovery path? | 3 |
| B2 | A **release path bypasses the validated artifact** | can something reach production that is not the artifact CI actually validated? | 7 |
| B3 | **Credentials carry material unintended authority** | does any credential used by automation grant authority materially beyond the job it does? | 7 |
| B4 | A **consequential operation has no gate and no recovery** | is there an irreversible or expensive operation reachable without a gate, with no way back? | 3, 5 |
| B5 | An **owned compatibility or security surface has no confidence model** | for a surface this repo owns, is there any basis beyond hope for believing it still works? | 6 |
| B6 | **Documentation overstates enforced guarantees** | does the written word claim something is enforced that nothing actually enforces? | 1 |
| B7 | There is **no way to prove the claimed user-visible outcome** | can the headline user-visible claim be demonstrated by running the system, at the boundary it claims? | 4 |

### The set is a closed set in v1

Seven, and only seven, in v1. The set is **not configurable** — there is no config key, no
host-defined blockers, no severity dial. Extending it is a deliberate **rule edit** here plus a
version bump, not a configuration surface to design, migrate, and support. Host-specific concerns
surface as *findings within a dimension*, which is enough to make them visible without fragmenting
the vocabulary.

### "Ship blocker" is net-new vocabulary

It is deliberately distinct from three terms other rules already own, and it never replaces them:

- `convergent-review`'s **blocking finding** — a review-level judgment about one change.
- `tool-access-gate`'s **break-out** — the escalation when a required tool is not provably reachable.
- `leaf-only-lifecycle`'s **safe-block** — a lifecycle-state repair on a work item.

A ship blocker is none of these: it is a property of the *repository*, asserted about *unattended
operation*, and it gates a claim rather than a change, a tool call, or a ticket.

## Verdict: the shipped ladder, plus a narrowed claim

The rubric reuses the shipped `READY` / `READY_WITH_WARNINGS` / `NOT_READY` verdict ladder that
`lisa doctor` already emits. There is **no new verdict** value and no new severity level — inventing
a parallel enum would make two reports disagree about what "ready" means.

- **`READY`** — eight dimensions assessed, no blocker stands, no warnings material to unattended
  operation.
- **`READY_WITH_WARNINGS`** — no blocker stands, but findings exist that a human should see.
- **`NOT_READY`** — **at least one ship blocker stands.**

**The narrowed claim is the net-new field.** When the verdict is `NOT_READY`, the report must also
state, in operator language, **what the repository IS ready for** — never just what it is not. A
verdict that only says no is unactionable at the gate; a narrowed claim tells the operator exactly
which mode of operation remains available and what would widen it.

## Consequence ordering

Two ordering contracts meet here, and they do not collide:

- **Section order stays stable.** The report renders its sections in a fixed order and **never
  silently omits** one — the discipline `lisa doctor`'s grouped output already guarantees.
- **Findings are ordered by consequence.** Within and across sections, the finding with the largest
  consequence if left standing comes first. Alphabetical, chronological, and discovery order are all
  wrong: the reader at the gate has limited attention, and it belongs on the worst thing first.

### The five fields a readiness finding carries

On top of the severity / blocking / failure-scenario / evidence / smallest-fix fields
`convergent-review` already requires, a readiness finding names:

| Field | What it states |
|---|---|
| `invariant_violated` | the invariant actually at risk, stated as a property of the system |
| `evidence` | what was observed that establishes the finding, at a boundary that reaches the claim (`claim-evidence-mapping`) |
| `why_proof_missed` | why the existing proof machinery did not catch this |
| `root_correction` | the correction at the **owning boundary**, not a patch at the symptom |
| `machinery_to_remove` | redundant machinery the correction makes unnecessary, if any |

Two of these — `invariant_violated` and `machinery_to_remove` — are folded into the shared
`convergent-review` finding shape by **RRR-2 (#1854)**; that extension ships with that ticket, so do
not assume the shared shape carries them in this branch.

### Worked example

```text
Repository: acme/checkout-service

  Verdict          NOT_READY
  Standing blocker B2 — a release path bypasses the validated artifact
  Owning dimension 7 (delivery/authority)

  invariant_violated   What ships to production is the artifact CI validated.
  evidence             The deploy job rebuilds from source at deploy time rather than
                       promoting the CI-built image; the deployed digest never matches
                       the one the test job signed off on.
  why_proof_missed     Every check is green — they all ran against a different artifact
                       than the one that shipped. Nothing compared the two.
  root_correction      Promote the validated image by digest at the delivery boundary.
  machinery_to_remove  The duplicate deploy-time build step.

  Narrowed claim   This repository IS ready for supervised, single-ticket agent work with a
                   human approving each release. It is NOT ready for unattended fleet
                   operation, because a release can ship code no check ever ran against.
```

## Where the evidence comes from

The rubric consumes evidence that already exists; it commissions no second harness.

- **execution/proof** consumes the existing qualification evidence recorded by the worker-epoch
  requalification path and, when that evidence is absent or stale, triggers a journey run through the
  shipped `lisa-use-the-product` skill — the machinery **#1742** already ships. There is no second
  journey harness, and the evidence is recorded in the shape `claim-evidence-mapping` defines. That
  wiring ships with **RRR-6 (#1858)**.
- **domain ownership** sources its findings from the danger-zone wiki pages agent-ready's domain
  phase already produces; the readiness assessment that reads them, and files standing blockers as
  tracker work rather than in-session questions, ships with **RRR-4 (#1856)**.
- The persisted report at `.lisa/readiness.json` (schema-versioned, read through a single resolver)
  and the doctor render group ship with **RRR-3 (#1855)**; the blocker gate that emits the narrowed
  claim ships with **RRR-5 (#1857)**; the `setup-automations` warning, six-agent parity fan-out, and
  vocabulary documentation ship with **RRR-7 (#1859)**. Each of those surfaces may not yet be present
  in a given branch — name what you can and continue.

## Warn-only, always

This rubric **gates a claim, not a process**. It is **warn-only** everywhere: no Lisa surface
hard-blocks on the readiness verdict. `lisa apply`, intake dispatch, and cron registration are
unaffected; the automation setup flow warns with the standing blocker count and the narrowed claim
and still completes, consistent with the shipped never-block-always-degrade posture. Where a surface
named here is not installed, **degrade, never block**: state what was assessed, state what was not,
and continue.

Read the eight dimension titles and the seven blockers to someone who has never seen Lisa. They
should be able to say, unprompted, why "the tests pass" is not the same as "an agent fleet can run
here unattended" — that is the bar this document is written to (`factory-model` rule 5).

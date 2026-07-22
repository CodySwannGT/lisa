# Repository Readiness Rubric (load-bearing)

**"Lisa is installed correctly" and "an agent fleet may run here unattended" are two different
questions.** Doctor's shipped grouped checks answer the first — *installation readiness*. This rubric
answers the second — *repository readiness* — and it is the only place that question is written down.
A green test suite is not an answer to it.

## Eight ownership dimensions

Repository readiness is assessed across exactly eight dimensions, never fewer, and a dimension with
no applicable evidence renders `SKIP` **with a reason** rather than a blank:

1. **context/routing** — can an agent recover the real job from what is written down?
2. **capabilities/tools** — is every tool the work needs *provably* reachable, not merely installed?
3. **domain ownership** — are the business rules, glossary, and danger zones owned and written down?
4. **execution/proof** — can the claimed user-visible outcome be proved by running the system?
5. **feedback/guardrails** — does a failing loop produce a named outcome and a runbook?
6. **dependencies/supply chain** — is there a confidence model for what the repo depends on?
7. **delivery/authority** — does the thing that ships equal the thing that was validated, and does
   the credential that ships it carry only the authority it needs?
8. **proportionality** — is the machinery proportional to the job, or is there scaffolding to
   subtract?

## Seven ship blockers (closed set, v1)

A **ship blocker** is a condition that, standing alone, means the answer to "may an unattended fleet
run here?" is no. The set is closed in v1 — seven, no more — and extended only by editing this rule:

- **B1** a realistic path causes **silent data loss**
- **B2** a **release path bypasses the validated artifact**
- **B3** **credentials carry material unintended authority**
- **B4** a **consequential operation has no gate and no recovery**
- **B5** an **owned compatibility or security surface has no confidence model**
- **B6** **documentation overstates enforced guarantees**
- **B7** there is **no way to prove the claimed user-visible outcome**

## Verdict and narrowed claim

The verdict reuses the shipped `READY` / `READY_WITH_WARNINGS` / `NOT_READY` ladder — cite doctor's
ladder, never fork a parallel enum. **A standing blocker is `NOT_READY`**, and the report must also
state the **narrowed claim**: what the repository *is* ready for, in operator language ("ready for
supervised single-ticket work; not ready for unattended fleet operation, because …").

## Ordering

**Report section order stays stable and never silently omits a section; findings are ordered by
consequence** — highest-consequence first — within and across sections. The two contracts do not
collide: sections are fixed, findings are ranked.

## Warn-only

This rubric **gates a claim, not a process**. No Lisa surface hard-blocks on the verdict: a standing
blocker narrows what may be claimed and files tracker work; it never stops `lisa apply`, intake
dispatch, or cron registration. Where a surface this rule names is not installed in a given branch,
name what you can and continue — degrade, never block. Written to be read by someone who does not
code (`factory-model` rule 5).

Full rubric (eight-dimension table, seven ship blockers, consequence ordering, worked example): [reference/readiness-rubric.md](../reference/readiness-rubric.md).

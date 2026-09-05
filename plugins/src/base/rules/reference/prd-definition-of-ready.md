# PRD Definition of Ready — Reference

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## PRD Definition of Ready (requirement atoms)

**A requirements document is ready when a planner can decompose it mechanically and a verifier can check the result against it.** Both properties come from the shape of the requirements, not the prose around them. Modeled on ISO/IEC/IEEE 29148's requirement quality characteristics and the EARS sentence patterns; the fit criterion is Volere's.

## The atom

Every requirement is an **identified atom**:

- **Identified** — carries an id (`R1`, `R2`, …). Ids are per-generation; the verbatim text is the durable anchor (same convention as the `*-to-tracker` Requirement Register).
- **Singular** — one behavior per atom. "The system shall X and Y when Z" is two atoms.
- **Unambiguous** — no vagueness lexicon: *as appropriate, user-friendly, fast, robust, handle gracefully, etc., and/or, optimize, seamless, intuitive, support* (unbounded). Each is a word no test can check.
- **Verifiable** — carries a **fit criterion**: the measurable test of satisfaction ("p95 upload completes < 4s for files ≤ 25 MB"). A requirement no test could check is a wish.
- **Pattern-shaped (SHOULD)** — one of the EARS patterns, which decompose into Gherkin mechanically:
  - Ubiquitous: *The `<system>` shall `<response>`*
  - Event-driven: *When `<trigger>`, the `<system>` shall `<response>`*
  - State-driven: *While `<state>`, the `<system>` shall `<response>`*
  - Unwanted behavior: *If `<condition>`, then the `<system>` shall `<response>`*
  - Optional feature: *Where `<feature>` is present, the `<system>` shall `<response>`*

## The document

Beyond the atoms, a ready PRD carries: problem statement · solution outline · user stories grouping their atoms · an explicit **non-functional checklist** (walk the ISO 25010 axes — performance, security, reliability, usability, compatibility, maintainability — and either state the requirement as an atom or state "no requirement"; silence is not a decision) · out of scope · open questions (the honest home for what is NOT ready).

## Enforcement points

- **Write time** — `lisa-research` authors to this shape; `*-write-prd` skills carry it as a body rule.
- **Intake time (the universal gate)** — `*-to-tracker` Phase 1.45 validates every register atom, because human-authored PRDs never pass through the write path. Failures are product clarifications quoting the atom verbatim with candidate rewrites.
- **Verify time** — `verify-prd` / spec-conformance consume the atoms; fit criteria become the conformance checks.

Downstream, ticket gate S16 quotes these atoms verbatim and `prd-ticket-coverage` audits atom→ticket coverage — both degrade when "one requirement" is secretly three welded together.

---

The eager head carries the atom definition and enforcement points; this
reference carries the rationale, the full vagueness lexicon, and worked
rewrites. The companion rule `work-item-definition-of-ready` governs the next
stage down (tickets); this rule governs what the Plan factory decomposes from.

## Why requirement shape is the whole game

The pipeline consumes requirements three times, and each consumer needs a
different property that only shaped atoms provide:

1. **Plan decomposes** — an EARS-shaped atom (*When X, the system shall Y*)
   maps to a Gherkin scenario (*When X / Then Y*) nearly mechanically. Prose
   paragraphs force the planner to invent the split, which is where scope
   quietly drifts between the PRD and the backlog.
2. **Tickets trace** — gate S16 quotes the requirement verbatim on every leaf.
   A verbatim quote of a paragraph containing three requirements is an
   ambiguous trace: which of the three does this ticket satisfy?
3. **Verification checks conformance** — spec-conformance and `verify-prd`
   read the PRD back against the shipped result. A fit criterion is a
   conformance check waiting to run; an adjective is not.

The standards being distilled: **ISO/IEC/IEEE 29148** (successor to IEEE 830)
supplies the per-requirement quality characteristics — necessary, appropriate,
unambiguous, complete, singular, feasible, verifiable, correct — and the
practice of banning untestable phrasing. **EARS** (Mavin et al.) supplies the
five sentence patterns. **Volere** supplies the fit criterion. **ISO 25010**
supplies the non-functional axes for the completeness walk. None of these are
imported wholesale; this rule takes exactly the parts a machine planner and a
machine verifier consume.

## The vagueness lexicon

Presence of these (and their kin) in a requirement atom FAILs it as
unverifiable — each is a phrase no test can check:

> as appropriate · as needed · if necessary · user-friendly · intuitive ·
> seamless · robust · flexible · fast · quickly · efficient · optimize ·
> minimize / maximize (unbounded) · handle gracefully · support (unbounded) ·
> etc. · and/or · TBD inside an atom (TBD belongs in Open Questions)

The lexicon is a floor, not a ceiling — validators should flag any phrasing
they cannot turn into a check.

## Worked rewrites

| Before (fails) | After (passes) |
|---|---|
| "Uploads should be fast and handle errors gracefully." | R4: *When a user uploads a file ≤ 25 MB, the system shall complete the upload within 4s at p95.* Fit: perf-trace on staging. R5: *If an upload fails, then the system shall show a retryable error naming the cause.* Fit: screenshot of the error state per failure class. |
| "The dashboard should be user-friendly and support filtering, sorting, etc." | R7: *The dashboard shall filter by status, owner, and date range.* R8: *The dashboard shall sort by any visible column.* Fit: each verb exercised in an E2E journey. ("etc." is deleted — unnamed features are unbuilt features.) |
| "Optimize the pipeline." | R2: *The nightly pipeline shall complete within 30 minutes for a 10k-item batch* (baseline: 47m measured 2026-07-01). Fit: pipeline duration metric. — note this is Improvement-shaped: baseline + target, per `work-item-definition-of-ready`. |

## Singularity repair

When an atom contains multiple behaviors, the register splits it (`R4` →
`R4a`, `R4b`) — **mechanically when the split preserves meaning**, as a
product clarification when it does not. The split is recorded in the dry-run
report; it is never silent, because the PRD author's numbering is part of the
traceability contract.

## The non-functional walk

A PRD is complete only when the ISO 25010 axes were each considered:
performance, security, reliability, usability, compatibility,
maintainability/operability. The required artifact is one line per axis —
either an atom or an explicit "no requirement." The point is not ceremony; it
is that **silence and "no requirement" are different facts**, and only one of
them is a decision a verifier can hold the product to.

## Relationship to the lifecycle

- **Write** — `lisa-research` authors atoms; `*-write-prd` carries the body
  rule. Factory-authored PRDs are born conforming.
- **Intake** — `*-to-tracker` Phase 1.45 is the universal gate (human-authored
  PRDs arrive here without passing any write path). Failures quote the atom
  verbatim, name the defect, and offer 1–3 candidate rewrites — the
  EARS-shaped rewrite is the default recommendation. Routed like every other
  intake failure: PRD to `blocked`, product-readable comments.
- **Verify** — fit criteria become the spec-conformance checks; the
  requirement register ids appear in the PRD backlink and the coverage audit.

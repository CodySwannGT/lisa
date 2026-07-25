# PRD Definition of Ready (requirement atoms)

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

Full rationale, the vagueness lexicon, and worked rewrites: [the reference body of this rule](../reference/prd-definition-of-ready.md).

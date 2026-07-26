# TASC Specification Draft Source Note

Date: 2026-07-25
Origin: `spec/tasc-0.1-draft.md` (authored in-repo during a Lisa console design
session on 2026-07-23 → 2026-07-25; the console's Factories/Readiness prototype
work in PR `#2026` and the readiness-questionnaire iteration produced the
content this specification formalizes)
Scope: first public draft of **TASC — Trust in Autonomous Software Criteria**, a
SOC 2-parity attestation specification for autonomous agentic software
development.

## What Was Ingested

A single specification document, `spec/tasc-0.1-draft.md` (current version
0.2.0-draft as of 2026-07-26):

1. **Part I — Introduction**: purpose, ten normative design principles
   (exercised evidence; unknown never conforms; earned inapplicability;
   server-side authority; named replacement for every human; operator
   legibility; monotonic quality; author-agnostic enforcement; scale changes
   quality; stochastic evidence), scope, RFC 2119 conformance language, and
   definitions (ADS, agent/staff, gate, loop, sensor, human touch, autonomy
   rate, agent program).
2. **Part II — Attestation model**: Types I and II at SOC 2 parity plus the
   novel **Type C (continuous, machine-verified) attestation**; the required
   System Description; evidence hierarchy (exercised > observed > asserted),
   evidence authenticity, artifact adjudication, and freshness lifetimes;
   subservice organizations including model vendors;
   **Complementary Human Controls** (the CUEC inversion — enumerated human
   duties with response-time SLAs); conformance Levels 1–3; reporting.
3. **Part III — Criteria**: common criteria **AC1–AC9 mirroring SOC 2 CC1–CC9
   one-for-one**, plus supplemental categories SI (Software Integrity), DP
   (Data Protection), and UX (User-Facing Integrity) with condition-scoped
   applicability. The 0.2.0 revision added AC4.6 finding integrity, AC4.7
   measurement integrity, AC4.8 root-cause closure, AC5.6 instruction-level
   residual risk, tighter AC1.6/AC3.1/AC8/SI3 criteria, and SI9 generative
   testing.
4. **Part IV — Annexes**: SOC 2 parity map, self-assessment instrument pointer
   (the console readiness questionnaire), non-normative illustrative controls,
   attestation report skeleton.

## Provenance Notes

- The specification is deliberately **vendor-neutral**: it names no Lisa
  surface, and Annex C states no specific product confers conformance. Lisa is
  positioned (outside the spec) as an open-source reference implementation.
- The name TASC is provisional pending trademark diligence; the document
  declares intended CC BY 4.0 licensing and open governance.
- The 93-question readiness intake in the Lisa console prototype
  (`ui/index.html`, Readiness section) is the working self-assessment
  instrument referenced by Annex B; the 0.2.0 pass added 12 rows for evidence
  authenticity, finding/measurement integrity, distributional qualification,
  observed rollout promotion, defect replay, generative testing, and residual
  instruction risk.

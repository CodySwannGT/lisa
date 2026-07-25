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

A single specification document, `spec/tasc-0.1-draft.md` (version 0.1.0-draft):

1. **Part I — Introduction**: purpose, seven normative design principles
   (exercised evidence; unknown never conforms; earned inapplicability;
   server-side authority; named replacement for every human; operator
   legibility; monotonic quality), scope, RFC 2119 conformance language, and
   definitions (ADS, agent/staff, gate, loop, sensor, human touch, autonomy
   rate, agent program).
2. **Part II — Attestation model**: Types I and II at SOC 2 parity plus the
   novel **Type C (continuous, machine-verified) attestation**; the required
   System Description; evidence hierarchy (exercised > observed > asserted)
   with freshness lifetimes; subservice organizations including model vendors;
   **Complementary Human Controls** (the CUEC inversion — enumerated human
   duties with response-time SLAs); conformance Levels 1–3; reporting.
3. **Part III — Criteria**: common criteria **AC1–AC9 mirroring SOC 2 CC1–CC9
   one-for-one**, plus supplemental categories SI (Software Integrity), DP
   (Data Protection), and UX (User-Facing Integrity) with condition-scoped
   applicability.
4. **Part IV — Annexes**: SOC 2 parity map, self-assessment instrument pointer
   (the console readiness questionnaire), non-normative illustrative controls,
   attestation report skeleton.

## Provenance Notes

- The specification is deliberately **vendor-neutral**: it names no Lisa
  surface, and Annex C states no specific product confers conformance. Lisa is
  positioned (outside the spec) as an open-source reference implementation.
- The name TASC is provisional pending trademark diligence; the document
  declares intended CC BY 4.0 licensing and open governance.
- The 70-question readiness intake in the Lisa console prototype
  (`ui/index.html`, Readiness section) is the working self-assessment
  instrument referenced by Annex B; its groups are expected to be re-keyed to
  criterion IDs in a later pass.

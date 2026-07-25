# 2026-07-25 — The Three-Layer Trust Play (TASC / Measurement SaaS / Lisa)

## Decision

Lisa's strategic position is the third layer of a deliberately decoupled
three-layer structure modeled on the SOC 2 ecosystem:

| Layer | SOC 2 analog | Ours | Commercial stance |
| --- | --- | --- | --- |
| 1. Specification | SOC 2 / Trust Services Criteria | **TASC** (`spec/tasc-0.1-draft.md`) | Open (CC BY intent), vendor-neutral governance |
| 2. Measurement & attestation | Vanta | The console/readiness product | **The commercial product** |
| 3. Enforcement | The security stack itself | **Lisa** | **Stays open source**; reference implementation |

## The Decoupling Discipline

Each layer must be independently valuable; coupling any two destroys the
credibility of both:

1. **The spec never says "Lisa."** Criteria in neutral MUST/SHOULD language;
   Lisa is merely *a* conforming implementation, citable in system
   descriptions.
2. **The measurement layer's integration surface is the contract**, and Lisa is
   one integration among many (the questionnaire's "via" mechanism selectors —
   including "In-house" — are that surface). No private Lisa APIs into the
   measurer.
3. **Lisa never requires the measurement layer** — it enforces locally and in
   CI regardless, and emits evidence the measurer can consume if present.

## Rationale

- A spec owned by the vendor selling compliance is marketing, not a standard;
  authority requires visible independence (the OWASP adoption path, not the
  AICPA one: publish open and useful, formalize governance after traction).
- The funnel still works: spec spreads the vocabulary → named gaps make the
  measurer worth paying for → a measured gap makes the fastest fix (Lisa)
  worth adopting. Terraform/Terraform Cloud and Git/GitHub are the shape.
- Buyers convert top-down (spec → measurer → their vendors adopt Lisa);
  engineers convert bottom-up (Lisa first). The spec therefore has two
  audiences from day one, and operator-legible language is normative, not
  cosmetic.
- The measurement layer's differentiator over human-audited SOC 2 is
  **attestation by exercise** (the spec's Type C): standing machine proof that
  controls fire, instead of periodic evidence sampling.

## Consequences

- The TASC draft lives in-repo at `spec/tasc-0.1-draft.md` only as a working
  convenience; it should be extracted to a standalone, neutrally-owned
  repository before external circulation.
- Lisa features that make controls demonstrable (exercised evidence, named run
  outcomes, work-item trailers, threshold ratchet, parity drift detection) are
  now also conformance assets, and should be described in TASC's neutral
  vocabulary where surfaced outward.
- The console readiness questionnaire doubles as TASC's Annex B self-assessment
  instrument and should eventually key its questions to criterion IDs.

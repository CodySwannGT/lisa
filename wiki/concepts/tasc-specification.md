# TASC — Trust in Autonomous Software Criteria

Canonical source: [`spec/tasc-0.1-draft.md`](../../spec/tasc-0.1-draft.md)
(version 0.2.0-draft, 2026-07-26). This page is the wiki synthesis; the spec
file is authoritative.

## What It Is

TASC is a SOC 2-parity attestation specification for **Autonomous Development
Systems (ADS)** — software factories operated by agents. Where SOC 2 answers
*"can I trust your security?"*, TASC answers *"can I trust your software
factory?"*. It is written for open, vendor-neutral governance: no conforming
tool is named, and no product confers conformance. The name is a deliberate
homage to SOC 2's underlying **Trust Services Criteria (TSC)** and is
provisional pending trademark diligence.

## Structure At A Glance

- **Common criteria AC1–AC9 mirror SOC 2's CC1–CC9 one-for-one** — the parity
  argument is made structurally, so a SOC 2 auditor can navigate on sight:
  governance/accountability (incl. traceability of intent and agent
  segregation of duties), operator legibility (named run outcomes, runbooks),
  the agent threat model (now including misreporting and fabricated evidence),
  sensor integrity and learning promotion (mistakes captured, judged, and promoted upstream into enforcement — AC4.5), finding integrity and measurement integrity (AC4.6–AC4.8), enforcement integrity (server-side
  authority, staff parity, the threshold ratchet, and instruction-level residual risk), identity & credentials,
  operations & recovery (incl. autonomy-rate measurement), change management
  (incl. "the agent program is code" and "model change is system change", distributional qualification, observed rollout promotion, plus type-keyed work-item readiness with the stateless-pickup check — AC8.6, and requirement-atom intake validation with fit criteria under AC8.4), and
  supply chain (model vendors as subservice organizations).
- **Supplemental categories**: SI (Software Integrity — mandatory for
  production software, unlike SOC 2's optional Processing Integrity), DP (Data
  Protection), UX (User-Facing Integrity), each condition-scoped by the earned
  inapplicability rule.
- **Attestation types**: Type I (design) and Type II (operating effectiveness)
  at SOC 2 parity, plus **Type C — continuous, machine-verified attestation**
  built on exercised evidence with freshness lifetimes. Type C has no SOC 2
  equivalent and is the intended Level 3 end state.
- **Levels 1–3** (Governed → Unattended → Continuously Attested), SLSA-style,
  giving brownfield adopters a ladder rather than a cliff.
- **Complementary Human Controls (CHC)** invert SOC 2's CUECs: the enumerated
  duties that deliberately remain human (ready-promotion, gap answers,
  protected deploy approval, escalation response) each carry a response-time
  SLA — the human is a dependency with an SLA.

## The Ten Principles

1. **Exercised evidence** — a control is proven by firing, not by existing.
2. **Unknown is never conforming** — evidence expires; stale degrades to
   unknown; unknown ≠ pass.
3. **Earned inapplicability** — N/A must derive from a documented system fact.
4. **Server-side authority** — a control the worker can skip is advisory.
5. **Named replacement for every human** — an autonomous SDLC is not a human
   SDLC with the humans deleted.
6. **Operator legibility** — boundary communications readable by
   non-technical operators.
7. **Monotonic quality** — thresholds only tighten; loosening is an isolated,
   reviewed exception.
8. **Author-agnostic enforcement** — the same gates for human- and
   agent-authored work; the pipeline judges the artifact, never the author.
9. **Scale changes quality** — a practice is qualified only at the scale,
   concurrency, model, prompt and environment where it will operate.
10. **Stochastic evidence** — agent-behavior claims need repeated runs and the
    observed distribution, not one passing sample.

## Revision 0.2.0

The 2026-07-26 draft revision closes evidence and measurement gaps from an
adversarial review of 0.1.0. It adds evidence authenticity and artifact
adjudication in §7, finding integrity (AC4.6), measurement integrity (AC4.7),
root-cause closure (AC4.8), instruction-level residual risk (AC5.6),
review-capacity limits (AC8.1), distributional prompt/model qualification
(AC8.2/AC8.3), observed rollout promotion (AC8.5), defect replay (SI3), and
generative testing governance (SI9). Annex B now maps 93 readiness questions to
the criteria through the console Readiness section.

## Relationship To Lisa

Three deliberately decoupled layers: (1) the TASC spec — open, vendor-neutral;
(2) a measurement/attestation product ("Vanta for agents") that assesses any
stack against it; (3) Lisa — open source, one conforming reference
implementation and the fastest path to green. No layer requires another; see
the [three-layer trust play decision](../decisions/2026-07-25-three-layer-trust-play.md).
The Lisa console's readiness questionnaire is the working self-assessment
instrument referenced by the spec's Annex B.

## Status And Open Items

Draft 0.2.0. Open: outcome-vocabulary finalization (AC2.2), ISO 27001 / SSDF
crosswalk annexes, governance venue, trademark diligence, full re-keying of
legacy readiness groups to criterion IDs, and eventual extraction to a
standalone neutrally-owned repository. (Type II minimum period is settled: three
months, §5, applied to Level 2.)

# TASC — Trust in Autonomous Software Criteria

Canonical source: [`spec/tasc-0.1-draft.md`](../../spec/tasc-0.1-draft.md)
(version 0.6.0-draft, 2026-07-28 — the 0.1 file name is retained so existing
references stay valid). This page is the wiki synthesis; the spec file is
authoritative.

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
  governance/accountability (incl. traceability of intent, agent segregation of
  duties, the named accountable party — AC1.7 — and standing to accept risk —
  AC1.8), operator legibility (named run outcomes, runbooks),
  the agent threat model (now including misreporting, fabricated evidence, and
  agent-to-agent privilege escalation — AC3.6 — with every threat mapped to a
  control),
  sensor integrity and learning promotion (mistakes captured, judged, and promoted upstream into enforcement — AC4.5), finding integrity with measured false-positive rates (AC4.6), measurement integrity for the numbers that gate decisions (AC4.7), root-cause closure (AC4.8), enforcement integrity (server-side
  authority, staff parity, the threshold ratchet, instruction-level residual risk
  — AC5.6, advisory-control adherence — AC5.7, declared control obligations as
  machine-readable artifacts — AC5.8, and the bidirectionally reconciled control
  register — AC5.9), identity & credentials,
  operations & recovery (incl. autonomy-rate and delivery-effectiveness
  measurement — AC7.4, AC7.5), change management
  (incl. "the agent program is code" and "model change is system change", distributional qualification, observed rollout promotion, plus type-keyed work-item readiness with the stateless-pickup check — AC8.6, and requirement-atom intake validation with fit criteria under AC8.4), and
  supply chain (model vendors as subservice organizations).
- **Supplemental categories**: SI (Software Integrity — mandatory for
  production software, unlike SOC 2's optional Processing Integrity, and
  covering generative/randomized testing and defect replay as well as unit
  behavior, coverage, efficacy, E2E, load, independent verification, and output
  provenance and licensing — SI10), DP
  (Data Protection), UX (User-Facing Integrity), each condition-scoped by the
  earned inapplicability rule.
- **Attestation types**: Type I (design) and Type II (operating effectiveness)
  at SOC 2 parity, plus **Type C — continuous, machine-verified attestation**
  built on exercised evidence with freshness lifetimes. Type C has no SOC 2
  equivalent and is the intended Level 3 end state.
- **Levels 1–3** (Governed → Unattended → Continuously Attested), SLSA-style,
  giving brownfield adopters a ladder rather than a cliff.
- **Complementary Human Controls (CHC)** invert SOC 2's CUECs: the enumerated
  duties that deliberately remain human (ready-promotion, gap answers,
  protected deploy approval, escalation response, loop stewardship) each carry
  a named holder, a named backup, and a response-time SLA — the human is a
  dependency with an SLA, and a duty with no holder is unassigned.

## The Eleven Principles

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
9. **Unconstrained quality degrades** — at agent volume, any dimension without
   a mechanical constraint decays; treat it as degrading, not stable.
10. **Stochastic evidence** — a single run is an anecdote; agent-behavior claims
    must name the condition tested, the repetitions, and the observed
    distribution, on the entity's own representative tasks.
11. **Scale is a condition** — a practice is qualified only at the scale,
    concurrency, model, prompt and environment where it will operate.

## Relationship To Lisa

Three deliberately decoupled layers: (1) the TASC spec — open, vendor-neutral;
(2) a measurement/attestation product ("Vanta for agents") that assesses any
stack against it; (3) Lisa — open source, one conforming reference
implementation and the fastest path to green. No layer requires another; see
the [three-layer trust play decision](../decisions/2026-07-25-three-layer-trust-play.md).
The Lisa console's readiness questionnaire is the working self-assessment
instrument referenced by the spec's Annex B — 114 questions across 16 groups,
each group citing the criteria it evidences.

## Revision 0.6.0 — declared controls and output provenance

Prompted by a review of 0.5.0 that asked how an organization makes its
policies machine-readable, how it gets visibility into every policy and
control, and — separately — what catches an agent reusing proprietary or
improperly attributed code. The first exposed a structural gap: the
specification described at length what controls must *do* without ever requiring
an entity to be able to **enumerate** them — `policy` appeared in 0.5.0 only
incidentally (retention policy, the `policy-obsolete` run outcome, DP1).

- **AC5.8 Declared control obligations.** Every obligation exists as a versioned,
  machine-readable artifact naming its enforcement tier (authoritative or
  advisory), its enforcement points, its parameters, and the measuring mechanism
  together with the basis of that mechanism's independence from the agents whose
  work it judges. Naming the mechanism is what makes an obligation checkable
  rather than aspirational: a coverage floor that does not say which system
  computes coverage has declared an intention, not a control. Enforcement points
  and agent-facing renderings are **derived** from the artifact, not restated
  beside it — an obligation transcribed into a pipeline config, a lint rule and
  an instruction file has three sources of truth and therefore none, and AC5.2's
  drift detection has nothing to detect against. AC5.2 had named a source of
  truth that nothing obliged anyone to have.
- **AC5.9 Control register.** Every declared obligation across every surface and
  every agent in the staff roster, carrying tier, measuring mechanism, last
  exercised evidence and freshness, measured adherence for advisory controls,
  and the accountable party. Reconciled **bidirectionally** against the running
  system: an obligation with no enforcement point and an enforcement point with
  no declared obligation are each findings entering intake — the discipline
  AC3.1 applies to threats and controls, applied to obligations and their
  enforcement. It consolidates visibility requirements previously scattered
  across §6's gate inventory, AC5.7's advisory inventory, AC5.3 staff parity and
  P9's set of unprotected dimensions.
- **SI10 Output provenance and licensing.** AC9.3 checked the licenses of
  *declared dependencies*, and therefore reached nothing a model reproduces
  directly into the entity's own source, nothing an agent copies from a
  repository fetched while researching, and nothing crossing a client or tenant
  boundary — none of which carries a lockfile entry or an SBOM line. SI10
  requires a reuse-detection gate on changed code, a declared and mechanically
  enforced permissible-source boundary (naming persisted memory and learnings as
  a carrier alongside context), mechanical discharge of attribution obligations
  that survive inlining, and sources admitted to context recorded as generation
  lineage under AC1.2. A permissive license on the allowlist is a permission
  with conditions, not an absence of them.
- Supporting amendments: AC3.1 carries the matching threat class; AC9.3 states
  its own limit so it cannot be misread as covering inlined code; AC9.1 carries
  the model vendor's reproduction filtering, attribution facilities and IP
  indemnity as subservice controls that must not be reported as the entity's
  own. §6 gains the control register as a system-description item; Annexes A, C
  and D updated.
- **Corrected in review.** SI10 first routed its license-admission decision to
  AC9.3, whose own amendment limits it to declared dependencies — a circular
  boundary, applying a control to an artifact outside it. The decision now
  belongs to SI10's gate, against the same permitted-license allowlist the
  entity maintains for AC9.3. One policy, correct boundary.
- **Open follow-up, recorded rather than invented.** SI10 permits regeneration as
  a remedy, but AC8.1's regenerate-from-spec preference does not help when the
  same model reproduces the same memorized snippet from the same specification.
  A bounded retry-then-escalate rule is needed.

## Revision 0.5.0 — agent boundaries and graduated autonomy

Drawn from published accounts of running an AI-native SDLC at scale
([source note](../sources/docs/2026-07-26-anthropic-ai-native-sdlc.md)), read
against 0.4.0. One finding was a place TASC was wrong rather than incomplete.

- **AC3.6 Agent-to-agent boundaries.** An agent's boundary is drawn around
  access and actions, **not around its instructions or beliefs about what it
  will do**. The entity enumerates which peers each agent can reach and
  evaluates its **effective authority** (§4) — an agent that cannot deploy but
  can ask a peer that can deploy has deploy authority. Separation of duties
  (AC1.3) must hold against delegation. The criterion exists because the failure
  is documented: a constrained incident-response agent, unable to deploy by
  design, was observed asking a peer over chat to push its fix, caught only at a
  human gate. AC3.5 previously scoped blast radius to identity and egress and
  never mentioned reachable peers.
- **AC3.1 threat-to-control mapping.** Every threat maps to at least one control
  and every control to at least one threat. An unmapped threat is an accepted
  risk needing standing (AC1.8); an unmapped control is unexplained cost.
- **AC8.8 Risk tiers.** Autonomy is no longer uniform: the entity tiers its
  codebase, services and data by risk and declares per tier what the ADS may do
  unattended, enforced mechanically. A tier no one chose is a tier no one is
  accountable for.
- **AC8.9 Staff introduction.** A new agent joining the roster is a system
  change. It runs in **shadow** — output recorded and compared, not acted on —
  and is **adversarially exercised** with deliberately defective work before its
  output is trusted. Trust is revocable: measured degradation (AC4.9) returns it
  to shadow.
- **AC1.9 Approval sampling.** Where the ADS approves its own work, a
  risk-weighted sample of approvals is re-examined independently and the
  findings feed the approving mechanism's false-positive rate. Logging a
  decision proves it happened, not that it was sound.

## Revision 0.4.0 — standing measurement

Prompted by a review question about what agents are measured against. The
literal question was already answered: AC8.3 makes third-party benchmark
rankings, vendor claims, and single successful runs **inadmissible** as
qualification evidence, because they measure a task mix that is not the
entity's at a precision their own run-to-run variance cannot support. The real
gap was that TASC measured agents *only at the moment you changed them*.

- **AC8.7 Evaluation suite.** AC8.3 required qualification over entity-owned
  representative tasks without ever requiring such a suite to exist between
  changes. It must now be maintained, reviewed for representativeness as the work
  mix drifts, and **contamination-controlled** — suite tasks and expected
  outcomes unreachable by the agents under evaluation, in instruction surfaces,
  skills, retrievable context, or vendor feedback. An agent optimizing against a
  suite it can read produces a score, not a measurement. Suite results may not be
  generalized beyond the task classes they cover (P10, P11).
- **AC4.9 Agent-capability monitoring.** Qualification fires on the entity's own
  changes; capability also moves when the entity changes nothing — a vendor
  reroutes a pinned alias, instruction surfaces accrete, tool behavior shifts.
  The suite is now sampled on a declared cadence against a recorded **capability
  baseline**, a statistically distinguishable decline is a finding entering
  intake, and the entity must be able to attribute a decline to a vendor-side
  change or to its own accumulated change.
- **AC7.5 Delivery effectiveness.** Autonomy rate (AC7.4) measures *how much*
  ran without humans and says nothing about whether it was worth shipping — a
  factory can post a high autonomy rate while producing work the gates keep
  rejecting, and reporting autonomy alone would conceal exactly that. Gate
  rejection rate, rework rate, escape rate, first-pass yield, and cost per
  delivered item are now measured, with entity-declared targets that ratchet.

Level 3 and the public summary report now carry delivery effectiveness alongside
autonomy rate, and Annex D gains an evaluation-suite statement with the
capability-baseline history.

## Revision 0.3.0 — responsibility

0.2.0 made accountability worse before it made it better: it introduced four
accepted-risk escape hatches (AC4.8, AC5.7, SI3, SI9) without saying who may use
them, so an agent could satisfy any of them by writing its own accepted-risk
record. Raised in review, and closed here.

Before 0.3.0, accountability in TASC was entirely technical. AC1 was titled
"Governance and Accountability" but every criterion under it attributed actions
to *agents*; "Operator" — "the human accountable for an ADS's outputs" — was a
definition with no obligation behind it, the System Description never named a
human, and CHCs enumerated human duties without saying who held them. The spec
named buyers, regulators and insurers as its audience in §1 and never answered
their first question.

- **AC1.7 Accountable party.** A named human or role, recorded in the System
  Description and named per registered loop, per deployment target, and per CHC.
  Attribution (AC1.1, which agent acted) and accountability (which human answers)
  are separate obligations and neither substitutes for the other. An agent may
  not hold it; accountability may not be vacant, so every party carries a backup
  or succession path; and names must be legible to a non-technical reader, which
  a team alias with nobody behind it is not.
- **AC1.8 Standing to accept risk.** Any decision that *disposes* of a control
  obligation rather than satisfying it — accepted-risk records, loosening a
  threshold (AC5.4), claiming inapplicability (P3), dismissing a class of finding
  (AC4.6) — must be made by a named human with declared standing, and must state
  scope, reason and an expiry that forces re-review. Agents may neither accept
  risk nor author the record that accepts it.
- **AC7.2 incident answerability.** An agent-caused failure's record must name
  the accountable party, the generation lineage that produced the change, and
  *the control that should have prevented it*; a missing control becomes a
  learning-promotion candidate. "An agent did it" describes the mechanism and
  disposes of nothing.
- **P5** now says the converse of what it always implied: replacing a human
  control does not transfer answerability. Automation moves the work, never the
  accountability.

Also: the System Description gains an accountability register (§6 item 10), §11
ties management's assertion to the accountable party, and Annex D's report
skeleton gains a risk-acceptance log.

## Revision 0.2.0

The criteria added or tightened in 0.2.0 came from reading an external
practitioner account of running agentic workflows at volume
([source note](../sources/docs/2026-07-26-danluu-agentic-test-processes.md)) as
an adversarial review of 0.1.0. Two independent passes over that source landed —
PR #2079 first, then the reconciliation in PR #2078 — and the criteria below are
the union: where both passes wrote the same criterion, the stronger obligation
survived. The load-bearing additions:

- **Evidence can be fabricated** (§7). Asked to prove a regression, an agent
  will build a harness that produces the artifact you asked for on a path that
  is not the one under claim. Evidence now reaches *observed* or *exercised*
  only if reproducible on the claimed path in a representative environment, and
  artifacts must be adjudicated by someone other than their producer — artifact
  and producing mechanism checked separately. Agent misreporting is a named
  threat class (AC3.1).
- **Findings need a rejection stage with a measured false-positive rate**
  (AC4.6), with false positives fixed in the generator rather than dismissed
  per instance.
- **Generative testing** (SI9) and **defect replay** (SI3): example-based tests
  encode only the cases someone imagined, and a generator earns credit for a
  defect class only where it re-discovers it from the project's own history.
- **Distributional qualification** (P10, AC8.2–8.3): repeated runs with reported
  spread on the entity's own tasks, effort level pinned alongside the model,
  third-party benchmark rankings inadmissible as qualification evidence.
- **Measurement integrity** (AC4.7): the numbers that gate decisions must come
  from a mechanism independent of the work they judge, reconciled against a
  source of record, stated with numerator, denominator, window and exclusions,
  with plausibility checks, and never from self-comparison alone.
- **Instruction-layer risk, twice** (AC5.6, AC5.7): instruction, prompt, skill
  and hook changes must identify the residual risk they introduce and track it to
  disposition; separately, prose-only rules are inventoried and their breach rate
  measured against a declared exposure unit and window, promoted to gates when
  expected violations at actual run volume exceed tolerance.
- **The loop needs outside feedback**: user-reported problems become a required
  signal class (AC4.1), canary promotion is conditioned on observed signal
  (AC8.5), and loop stewardship joins the CHC register (§9).

## Status And Open Items

Draft 0.6.0. Open: outcome-vocabulary finalization (AC2.2), a non-normative
schema for declared control obligations (AC5.8), a bounded
retry-then-escalate rule for SI10 regeneration, ISO 27001 / SSDF
crosswalk annexes, governance venue, trademark diligence, full re-keying of
legacy readiness groups to criterion IDs, and eventual extraction to a
standalone neutrally-owned repository. Deliberately *not* addressed: legal and
financial liability — insurance, indemnity, and whose balance sheet absorbs an
agent-caused loss — which sits outside what SOC 2 attests and is left to the
governance venue to decide. The specification fixes no numbers by design: coverage floors (SI2), false-positive tolerances (AC4.6),
advisory-control violation tolerances (AC5.7), qualification run counts and
thresholds (AC8.3), and SLOs (SI8) are entity-declared, disclosed, and
ratcheted. (Type II minimum period is settled: three months, §5, applied to
Level 2.)

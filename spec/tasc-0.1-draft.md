# TASC — Trust in Autonomous Software Criteria

**Version:** 0.1.0-draft · **Date:** 2026-07-25 · **Status:** Working draft for circulation

**License:** CC BY 4.0 (intended). **Governance:** This document is intended for open,
vendor-neutral governance (working group or foundation). No conforming tool vendor may
control the criteria. The name *TASC* is provisional pending trademark diligence.

---

## Part I — Introduction

### 1. Purpose

SOC 2 exists because organizations must trust one another's **security** without
inspecting it. TASC exists because organizations must trust one another's
**software factories** without inspecting them.

As software is increasingly designed, written, reviewed, shipped, and operated by
autonomous agents, the question a buyer, regulator, or insurer must ask changes from
*"do you follow a secure development lifecycle?"* to *"what controls your agents, and
how do you know those controls actually operate?"* TASC defines the criteria an
**Autonomous Development System (ADS)** must meet for its output to be trusted, and
defines how conformance is attested.

TASC is deliberately structured at parity with the AICPA Trust Services Criteria as
used in SOC 2 examinations: common criteria mirroring CC1–CC9, supplemental
categories, a system description requirement, subservice-organization treatment,
complementary controls, and Type I / Type II attestation — extended with a
continuous, machine-verified attestation type that SOC 2 cannot express.

TASC does not replace SOC 2, ISO 27001, or SSDF. It governs the *production system
for software* where the workers are autonomous agents, and composes with those
frameworks. Annex A provides the SOC 2 crosswalk; ISO 27001 and SSDF crosswalks are
planned as future annexes and are not yet provided.

### 2. Design principles

The criteria embody a small number of normative principles, referenced throughout:

- **P1 — Exercised evidence.** A control is proven by *firing*, not by existing. A
  gate that has never blocked anything is indistinguishable from a gate that was
  never wired up. The strongest evidence for any criterion is a record of the
  control operating on a real or deliberately-introduced violation.
- **P2 — Unknown is never conforming.** Evidence has a freshness lifetime. Stale
  evidence degrades to *unknown*; a control that has never been exercised is
  *unknown*; unknown MUST NOT be reported as conforming.
- **P3 — Earned inapplicability.** A criterion may be inapplicable ("N/A") only when
  the inapplicability derives from a documented, verifiable fact of the system (e.g.,
  no user interface exists; no persistent agent memory exists). Inapplicability MUST
  be re-evaluated when the system changes. N/A is never a self-declared exemption.
- **P4 — Server-side authority.** A control an autonomous worker can skip is
  advisory. Authoritative enforcement lives where the worker cannot reach around it.
  Local and agent-level enforcement are permitted only as mirrors generated from the
  same source of truth as the authoritative tier.
- **P5 — Named replacement for every human.** An autonomous SDLC is not a human SDLC
  with the humans deleted. Every point where a human used to *be* the control —
  approving, noticing, reverting, reviewing, budgeting — MUST have a named,
  exercised replacement control, or a declared Complementary Human Control (§9).
- **P6 — Operator legibility.** Autonomous systems are operated by people who may
  not be engineers. Everything the system communicates outward at its boundaries —
  rejections, escalations, run outcomes, verification verdicts — MUST be readable by
  a non-technical operator.
- **P7 — Monotonic quality.** Quality thresholds may only tighten in the ordinary
  course. Loosening a threshold is an exceptional, isolated, reviewed change.

### 3. Scope and applicability

TASC applies to any system in which autonomous agents perform material portions of
the software development lifecycle — requirements analysis, planning, implementation,
review, verification, deployment, or operations — with the intent that work proceeds
without a human in the loop by default.

The **system boundary** encompasses: the agents (staff) and their runtimes; the
execution environments (workstation, CI, hosted/remote); the pipeline stages and
their gates; the scheduled autonomous processes (loops); the sensors observing
deployed software; the work-intake sources; the credential and identity fabric; and
the third parties these depend on (model vendors, hosting, CI providers, connectors).

Conformance keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are used per RFC 2119.

### 4. Definitions

- **Autonomous Development System (ADS).** The bounded system described in §3.
- **Agent.** An AI system that performs SDLC work with its own identity. The set of
  agents operating an ADS is its **staff**.
- **Pipeline stage.** A discrete transformation of work product (e.g., requirements →
  work items → implemented change → verified release).
- **Gate.** A control point that admits, blocks, or rejects work. A gate is
  **authoritative** when the worker cannot bypass it (P4).
- **Loop.** A scheduled or event-triggered autonomous process that runs without
  human initiation.
- **Sensor.** A process that observes deployed software or the ADS itself and emits
  findings as candidate work.
- **Surface / execution environment.** A place agents run: local workstation, CI,
  vendor-hosted runtime, self-hosted runtime.
- **Human touch.** Any human action on a work item between intake acceptance and
  verified completion, other than enumerated Complementary Human Controls.
- **Autonomy rate.** Over a trailing window: the fraction of completed work items
  with zero human touches. CHC boundary actions are counted and reported separately.
- **Exercised evidence.** Evidence that a control operated: a blocked violation, a
  tripped gate, a fired alert, an executed rollback (P1).
- **Work item.** The unit of tracked work (ticket, issue) carrying acceptance
  criteria and lifecycle state.
- **Agent program.** The versioned instructions that direct agents: prompts, skills,
  procedures, workflow definitions, and the model/runtime configuration.
- **Operator.** The human accountable for an ADS's outputs, who may be non-technical.

---

## Part II — Attestation model

### 5. Attestation types

- **Type I — Design.** The system description is fair, and controls are suitably
  designed to meet the applicable criteria, as of a point in time.
- **Type II — Operating effectiveness.** Type I, plus evidence that controls
  operated over a period of no less than three months.
- **Type C — Continuous (TASC extension).** Type II semantics evaluated
  continuously by machine: every authoritative control carries exercised evidence
  (P1) within its declared freshness lifetime (P2), and conformance state is
  recomputed as evidence ages. Type C is the intended end state for Level 3 systems
  and has no SOC 2 equivalent: it replaces periodic sampling with standing proof.

### 6. The System Description

An attestation MUST include a system description containing, at minimum:

1. **Staff roster.** Every agent, its harness, and its pinned model/runtime versions.
2. **Environment inventory.** Every surface where agents run; for each: available
   schedulers and triggers, credential path, network posture, and sandbox properties.
3. **Identity and credential map.** For each external connection × surface: the
   identity used (agent-own, federated, human-delegated), where the credential
   lives, and when it was last proven from that surface.
4. **Gate inventory.** Every gate, its obligation, its enforcement point(s), whether
   it is authoritative, and the provider implementing it.
5. **Loop registry.** Every registered loop, its trigger(s), its runbook, and its
   outcome history.
6. **Sensor inventory.** Every sensor, what it observes, its liveness mechanism,
   and which pipeline stage its findings re-enter.
7. **Work-intake sources** and the validation applied at intake.
8. **Complementary Human Controls** (§9), enumerated.
9. **Subservice organizations** (§8) and the method of treatment.

A conforming implementation MAY render the system description live from the system's
own configuration; a document generated from live state is preferred over prose (P2).

### 7. Evidence rules

- Evidence carries a hierarchy: **exercised > observed > asserted.** Criteria state
  the minimum acceptable rung; Type C requires *exercised* for all authoritative
  controls.
- Every evidence item carries a freshness lifetime declared in the system
  description. Expired evidence degrades the control to *unknown* (P2).
- Declared freshness lifetimes MUST be finite and MUST NOT exceed the shorter of
  the attestation period or twelve months. The attestor MUST evaluate declared
  lifetimes as reasonable for the control class; an unreasonable lifetime is an
  exception, not a conformance.
- Deliberate violation injection (tripping a gate on a known-bad input, killing a
  sensor to confirm liveness alerting) is a valid and encouraged evidence mechanism.
- Inapplicability claims are evidence-bearing: each N/A MUST cite the system fact
  that earns it (P3).

### 8. Subservice organizations

Third parties whose controls the ADS depends on MUST be identified and treated under
either the **carve-out** or **inclusive** method, stated per organization. For an
ADS these include, at minimum: **model vendors** (availability, data retention,
training-use posture), hosted agent runtimes, CI providers, source hosting, and
connector/tool vendors. A change of model or model version is a change to a
subservice dependency **and** a system change subject to AC8.3.

### 9. Complementary Human Controls (CHC)

Where SOC 2 defines controls the *customer* must operate, TASC defines the controls
that remain with *humans* by design. The system description MUST enumerate them;
they MUST be minimal, explicit, and monitored. Typical CHCs:

- Promoting draft requirements to ready (where auto-promotion is disabled).
- Answering knowledge-gap questions the system cannot resolve itself.
- Approving protected production deployments.
- Responding to recovery escalations and approval requests.
- Reviewing quarantined learnings or low-confidence memory candidates.
- Accepting residual risk (e.g., acknowledging a vulnerability exception).

Each CHC MUST have a defined response-time expectation and MUST be monitored for
breach — the human is a dependency with an SLA. An action outside the enumerated
CHC set counts as a human touch for autonomy-rate purposes.

### 10. Conformance levels

- **Level 1 — Governed.** All applicable MUST criteria are designed and implemented.
  Humans may remain in the loop routinely. Attestable at Type I.
- **Level 2 — Unattended.** Loops run unattended in at least one non-local
  environment; all authoritative gates enforce server-side (P4); named run outcomes
  (AC2.2) and traceability (AC1.2) enforced. Attestable at Type II over the
  minimum period defined in §5 (three months).
- **Level 3 — Continuously attested.** Type C evidence for every authoritative gate
  and every sensor liveness mechanism; autonomy rate measured and published with its
  definition; public summary report available. This is the badge tier.

### 11. Reporting

A TASC report contains: management's assertion; the system description (§6); the
applicable criteria with the controls mapped to each; tests or standing evidence and
results; exceptions with dispositions. A **public summary report** (analogous to
SOC 3) MAY be published at any level; at Level 3 it MUST be published and SHOULD be
machine-rendered from live evidence: level, criteria coverage, autonomy rate, and
evidence freshness.

---

## Part III — The Criteria

The **Common Criteria (AC1–AC9)** apply to every ADS and mirror SOC 2's CC1–CC9
one-for-one (Annex A). Supplemental categories apply as scoped: **SI** (Software
Integrity) applies to every ADS whose output is production software; **DP** (Data
Protection) applies where regulated or sensitive data is in scope; **UX**
(User-Facing Integrity) applies where the software has a human interface (P3).

Each criterion is stated in the form *"The entity's ADS …"*, followed by points of
focus (non-authoritative guidance).

### AC1 — Governance and Accountability *(mirrors CC1, Control Environment)*

- **AC1.1 Attribution.** Every action taken by an agent — commits, work-item
  transitions, deployments, external communications — MUST be attributable to a
  distinct agent identity, not to a human's account.
  *Focus: agent service accounts; commits authored by the agent; no shared human
  credentials (see AC6).*
- **AC1.2 Traceability of intent.** For any line of shipped code, an unbroken,
  machine-followable chain MUST exist: line → change → change request → work item →
  requirement → originating intent or signal. At Level 2+, at least one hop
  (change → work item) MUST be enforced mechanically at commit or merge time.
  *Focus: enforced work-item references; requirement backlinks; the chain survives
  refactors via history.*
- **AC1.3 Segregation of duties.** The agent that authored a change MUST NOT be the
  sole reviewer, verifier, or deploy approver of that change. Independence may be
  achieved by distinct agents, distinct vendor systems, or a human.
- **AC1.4 Access recertification.** Agent permissions and identities MUST be
  reviewed on a defined cadence; permissions not exercised within a defined window
  SHOULD be revoked.
- **AC1.5 Records.** Agent session records (transcripts) MUST be retained under a
  defined retention policy with an access boundary; they are audit evidence for
  AC1.2 and sensitive records under DP.
- **AC1.6 Resource governance.** Agent expenditure MUST be bounded: per-run and
  per-loop budget ceilings, runaway-process protection, and cost attribution to
  work items SHOULD be maintained.

### AC2 — Communication and Operator Legibility *(mirrors CC2, Communication)*

- **AC2.1 Boundary communications.** Everything the ADS communicates at its outward
  boundaries — intake rejections, clarifying questions, blocked reasons,
  verification verdicts, escalations — MUST be comprehensible to a non-technical
  operator (P6).
- **AC2.2 Named run outcomes.** Every run of every registered loop MUST terminate in
  exactly one of a fixed outcome vocabulary with a one-line operator-readable
  summary. The vocabulary MUST distinguish, at minimum: *nothing needed; work
  proposed; change made and proved; approval requested; recovery required; policy
  obsolete.* A run that stops without naming an outcome is a conformance failure.
- **AC2.3 Runbooks by registration.** Every registered loop MUST have a checked-in
  runbook describing purpose, triggers, outcomes, and operator actions. Membership
  is by registration: registering a loop pulls it under this criterion automatically.
- **AC2.4 Decision-ready escalation.** Escalations MUST name the broken capability
  or required decision and the action requested — never a bare failure signal.

### AC3 — Risk Assessment: the Agent Threat Model *(mirrors CC3, Risk Assessment)*

- **AC3.1 Threat model.** The entity MUST maintain a documented threat model for
  the ADS covering, at minimum: prompt injection; instruction-surface trust;
  dependency hallucination and typosquatting; data exfiltration; persistent-memory
  poisoning; sandbox escape and blast radius. It MUST be revisited on material
  system change.
- **AC3.2 Untrusted content.** Content fetched or received from outside the trust
  boundary (web pages, third-party repositories, external comments) MUST be treated
  as data, not instructions; high-risk tools SHOULD be gated while untrusted content
  is in context.
- **AC3.3 Instruction-surface trust.** Executable instruction surfaces from
  external sources — instruction files, hooks, skills in cloned repositories or
  dependencies — MUST NOT be trusted automatically; a trust decision MUST precede
  execution.
- **AC3.4 Memory integrity.** Where agents persist memory or learnings, a skeptical
  validation gate MUST stand in front of persistence, with provenance recorded, and
  persisted memory MUST be reviewable and revocable. (N/A is earned only by having
  no persistent memory.)
- **AC3.5 Blast radius.** The entity MUST be able to state what a compromised agent
  runtime can reach, and that reach MUST be limited to the agent's scoped identity
  (AC6) and permitted egress (AC6.5).

### AC4 — Monitoring and Sensor Integrity *(mirrors CC4, Monitoring)*

- **AC4.1 Instrumentation.** Deployed software MUST emit, and the ADS MUST consume:
  error/crash signals, logs, and operational metrics. Additional signal classes
  (traces, real-user monitoring, synthetics, product analytics) apply per P3.
- **AC4.2 Sensor liveness.** Every sensor MUST have a liveness mechanism
  independent of its findings. "No findings" and "sensor dead" MUST be
  distinguishable states (P1, P2).
- **AC4.3 Findings become work.** Signal threshold crossings MUST be converted into
  validated work items through the standard intake gate. Sensor findings receive no
  privileged path around intake.
- **AC4.4 Cross-sensor consistency.** Disagreement between sensors (e.g., a
  user-reported failure absent from error telemetry) SHOULD be surfaced as an
  instrumentation-gap finding.
- **AC4.5 Learning promotion.** The ADS MUST convert its own mistakes, drift,
  and near-misses into upstream controls so no agent repeats them. Deficiencies
  discovered anywhere in the system MUST be captured as candidate learnings
  with provenance; candidates MUST pass a skeptical validation gate before
  persisting (see AC3.4); and validated learnings MUST be routed to the most
  enforceable available home — executable control (lint rule, hook, gate),
  eagerly-loaded rule, procedure/skill, or knowledge base — rather than
  remaining prose. Promotion into enforcement SHOULD be human-gated; the
  learning store MUST be bounded; and **recurrence of a captured mistake is a
  monitoring finding** — evidence that the loop failed to promote or the
  promoted control failed to fire. A lesson that stays prose is a lesson the
  next agent never reads; a lesson promoted to a gate is one no agent can
  repeat.

### AC5 — Enforcement Integrity *(mirrors CC5, Control Activities)*

- **AC5.1 Server-side authority.** Every gate designated authoritative MUST be
  enforced where the performing agent cannot bypass it (P4). Bypass mechanisms
  (e.g., verification-skipping flags) MUST be unavailable to agents or MUST fail
  the change.
- **AC5.2 Mirror consistency.** Local and agent-layer enforcement MUST be generated
  from the same source of truth as the authoritative tier, with drift detection.
- **AC5.3 Staff parity.** Enforcement MUST be equivalent across every agent in the
  staff roster. Where an agent's harness cannot represent a control, the gap MUST be
  documented and compensated at a shared layer — never silently dropped.
- **AC5.4 Threshold ratchet.** Quality thresholds MUST only tighten in the ordinary
  course; loosening MUST require an isolated, reviewed, individually-approved
  change (P7).
- **AC5.5 Gate exercise.** Each authoritative gate MUST be demonstrated to block a
  violation: at Type II, at least once in the period; at Type C, within the gate's
  declared freshness lifetime (P1).

### AC6 — Identity, Credentials, and Access *(mirrors CC6, Logical Access)*

- **AC6.1 Agent-own identity.** Agents MUST authenticate to every external system
  as themselves, on every surface including local workstations, with least
  privilege. Borrowing a human's session MUST NOT be the default on any surface.
- **AC6.2 Bounded impersonation.** Where an agent acts with a human's authority
  ("driving"), the elevation MUST be explicit, time-bounded, scoped, and logged.
- **AC6.3 Secret handling.** Secrets MUST be held in a designated store; secret
  values MUST NOT appear in configuration or agent context. Substitution proxies
  (credential gateways) SHOULD be used so agents handle placeholders; short-lived
  credentials are preferred over well-hidden ones; static credentials MUST have a
  rotation window.
- **AC6.4 Per-surface credential paths.** The identity path for every connection ×
  surface MUST be documented and proven *from that surface* (P1). Where a surface
  supports workload federation, it SHOULD be used in place of stored secrets.
- **AC6.5 Egress control.** Agent network egress MUST be restricted consistent with
  the threat model (AC3); where a credential gateway is deployed, egress restriction
  MUST prevent bypassing it.

### AC7 — System Operations and Recovery *(mirrors CC7, System Operations)*

- **AC7.1 Scheduled operation.** Loops MUST be registered on declared schedulers
  with documented triggers per environment, including behavior for missed runs.
- **AC7.2 Incident and rollback.** An agent-caused production failure MUST have a
  defined path: detection (AC4), rollback or remediation, and an incident record
  feeding intake. Rollback MUST exist and MUST be exercised (P1) — an unexercised
  rollback is a hypothesis.
- **AC7.3 Self-recovery escalation.** When the ADS itself cannot proceed (broken
  access, tooling, or substrate), it MUST emit a *recovery required* outcome with a
  decision-ready packet (AC2.4). Silent stalls are conformance failures.
- **AC7.4 Autonomy measurement.** The entity MUST define "human touch," measure
  autonomy rate over a trailing window, and report it internally; Level 3 systems
  MUST publish it in the summary report, with CHC boundary actions reported
  separately.

### AC8 — Change Management *(mirrors CC8, Change Management)*

- **AC8.1 Lifecycle gates.** Every change MUST pass through the standard lifecycle
  — validated intake, implementation, independent review (AC1.3), and the pre-merge
  integrity gates (SI1–SI4, as applicable) — with gates per AC5, followed by
  post-deployment verification (SI5). Review findings MUST be resolved, not merely
  produced, before merge.
- **AC8.2 The agent program is code.** Prompts, skills, procedures, and workflow
  definitions MUST be version-controlled and MUST pass the same change gates as
  code. Production work MUST be driven by vetted procedures; free-form prompting
  against production scope SHOULD be exceptional and MUST be logged.
- **AC8.3 Model change is system change.** Models and runtimes MUST be
  version-pinned. A model or model-version change MUST be qualified before
  promotion — evaluation suite, golden tasks, or canary on real work — and MUST be
  revertible. Vendor-forced changes MUST trigger the same qualification.
- **AC8.4 Intake validation.** Work MUST be admitted to implementation only through
  an adversarial intake gate that rejects ambiguity and verifies the system has
  provable access to the tooling the work requires; rejections MUST be raised to a
  human legibly (AC2.1).
- **AC8.5 Deployment protection.** Production deployment MUST be gated by a
  protected mechanism the deploying agent cannot self-approve (server-side
  environment protection and/or CHC approval). Progressive delivery SHOULD bound
  blast radius.
- **AC8.6 Work-item readiness.** Work items MUST satisfy a type-keyed
  definition of ready — validated mechanically, not by convention — before
  carrying the build-ready role. The definition MUST be sufficient for a
  stateless agent to drive the item to its terminal state without human
  clarification. At minimum: defects carry machine-executable reproduction, an
  expected-behavior source, environment and version, reproducibility rate, and
  occurrence evidence; improvements carry a measured baseline and a numeric
  target; investigations carry the question, the decision it enables, a
  timebox, and the deliverable's location; every leaf defines its terminal
  state as checkable evidence. The validator SHOULD include an adversarial
  stateless-read check that fails the item on any question a fresh agent would
  need answered.

### AC9 — Third Parties and Supply Chain *(mirrors CC9, Risk Mitigation)*

- **AC9.1 Model vendors as subservice organizations.** Availability posture, data
  retention, and training-use terms MUST be documented per model vendor; vendor
  outage MUST have a defined operational response (degrade, failover, or halt).
- **AC9.2 Dependency introduction.** Agents MUST NOT introduce new dependencies
  without a gate: lockfile discipline plus review and/or automated supply-chain
  scanning. The threat model MUST address hallucinated-package squatting and
  typosquatting explicitly.
- **AC9.3 License compliance.** Dependency licenses MUST be checked against an
  allowlist as a lifecycle gate.
- **AC9.4 Connector vetting.** Tool connectors (e.g., MCP servers) are executable
  dependencies with tool access: they MUST be pinned, vetted before use, and
  inventoried in the system description.
- **AC9.5 Hosted runtimes.** Vendor-hosted agent runtimes MUST be assessed for
  sandbox properties, network posture, secret storage, and scheduler semantics
  before production use.

### SI — Software Integrity *(supplemental; applies to all production software output — analogous to Processing Integrity)*

- **SI1 Unit behavior.** Unit-level behavior MUST be proven by automated tests that
  block the change when failing.
- **SI2 Coverage floors.** Minimum coverage thresholds MUST be enforced as gates.
  Floors are entity-declared but MUST be nonzero, MUST be disclosed in the
  attestation report, and are subject to the ratchet (AC5.4) from first
  declaration.
- **SI3 Test efficacy.** The entity MUST measure whether its tests would detect
  defects (e.g., mutation testing) and SHOULD gate changed code on efficacy, not
  only on coverage.
- **SI4 End-to-end proof.** For each user-facing surface, critical journeys MUST be
  exercised end-to-end against a running build before release.
- **SI5 Independent verification.** After deployment, the shipped result MUST be
  verified by using the software — driving it as a user would — by an actor
  independent of the author (AC1.3), including conformance of the result to its
  originating requirement, with a recorded go/no-go verdict and evidence (AC2.1).
  Failures MUST re-enter intake as build-ready work, not prose.
- **SI6 Verification codified.** Each passing verification MUST be converted into a
  durable regression check so it cannot silently regress.
- **SI7 Authorless output.** Code-health budgets (size, complexity, structure, dead
  code, house style) MUST be enforced mechanically. The entity SHOULD test
  indistinguishability: with authorship hidden, a reviewer (or classifier) should
  not reliably identify which agent or person wrote a change; distinguishing
  features found are candidate rules.

### DP — Data Protection *(supplemental; applies where sensitive or regulated data is in scope — analogous to Confidentiality/Privacy)*

- **DP1 Context boundary.** The entity MUST define what data classes may enter
  agent context; production data and personal data MUST be excluded or redacted by
  policy and mechanism, not intention.
- **DP2 Transcript confidentiality.** Session records (AC1.5) MUST be protected
  commensurate with the most sensitive data that could appear in them.
- **DP3 Vendor data handling.** For every subservice organization that receives
  context (AC9.1), retention and training-use posture MUST be documented and
  compatible with the entity's data obligations.

### UX — User-Facing Integrity *(supplemental; applies where the software has a human interface)*

- **UX1 Constrained construction.** Agent-built interfaces MUST be assembled from a
  governed component system rather than styled ad-hoc.
- **UX2 Tokens as source of truth.** Visual style MUST derive from defined tokens
  such that off-system values are mechanically detectable.
- **UX3 Design-code mapping.** Where a design tool is in use, design components
  SHOULD be mapped to their code counterparts so implementation is a lookup, not an
  interpretation.

---

## Part IV — Annexes

### Annex A — SOC 2 parity map

| TASC | Mirrors (SOC 2 TSC) | Notes |
|---|---|---|
| AC1 Governance & Accountability | CC1 Control Environment | + traceability of intent, segregation of duties for agents |
| AC2 Communication & Legibility | CC2 Information & Communication | operator legibility; named run outcomes |
| AC3 Agent Threat Model | CC3 Risk Assessment | agent-native threat classes |
| AC4 Monitoring & Sensor Integrity | CC4 Monitoring Activities | sensor liveness ≠ findings |
| AC5 Enforcement Integrity | CC5 Control Activities | server-side authority, parity, ratchet |
| AC6 Identity & Credentials | CC6 Logical & Physical Access | agent-own identity, gateways, federation |
| AC7 Operations & Recovery | CC7 System Operations | + autonomy measurement |
| AC8 Change Management | CC8 Change Management | + the agent program and model changes |
| AC9 Third Parties & Supply Chain | CC9 Risk Mitigation | model vendors as subservice orgs |
| SI | Processing Integrity (PI) | mandatory for production software, unlike PI |
| DP | Confidentiality (C) + Privacy (P) | merged; context boundary is the novel control |
| UX | — (no SOC 2 analog) | condition-scoped |
| Type I / II | Type I / II | equivalent semantics |
| Type C | — | continuous machine attestation; TASC extension |
| System Description | Section 3 description | + live-rendered descriptions preferred |
| CHC | CUEC (user entity controls) | inverted: the humans are the complementary party |
| Subservice organizations | Subservice organizations | model vendors added as a mandatory class |
| Public summary | SOC 3 | machine-rendered badge at Level 3 |

### Annex B — Self-assessment instrument

A questionnaire-form self-assessment (the *readiness intake*) maps one-or-more
questions to each criterion, pairing each outcome question with the mechanism
("via") implementing it. The instrument is maintained alongside this specification;
conforming measurement tools SHOULD present it as their intake and derive criterion
coverage from its answers.

### Annex C — Illustrative controls (non-normative)

Criteria are tool-neutral. Illustrative mechanism classes: secret stores and
credential proxies (AC6); branch/push protection and protected deploy environments
(AC5.1, AC8.5); supply-chain scanners and lockfile gates (AC9.2); mutation testing
frameworks (SI3); incident and cron-liveness monitors (AC4.2, AC7.2); eval harnesses
(AC8.3). Open-source reference implementations of end-to-end conformance exist and
MAY be cited in system descriptions; no specific product confers conformance.

### Annex D — Attestation report skeleton (non-normative)

1. Management assertion (level claimed, period or Type C basis)
2. System description per §6
3. Criteria applicability matrix with earned-N/A citations (P3)
4. Controls mapped to criteria, with evidence class per control (asserted /
   observed / exercised) and freshness
5. Exceptions and dispositions
6. CHC register with response-time performance
7. Autonomy-rate statement (definition, window, result, CHC boundary actions)

---

*End of draft 0.1.0. Known open items: outcome-vocabulary finalization (AC2.2);
quantitative floors (SI2) intentionally entity-declared — nonzero, disclosed, and
ratcheted — rather than fixed numbers; ISO 27001 and SSDF crosswalk annexes;
trademark diligence on the name; governance venue.*

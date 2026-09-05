# Lisa Wiki Index

Last updated by connector ingest on 2026-06-14 for Lisa `2.165.6` and current monorepo provenance through PR `#1287`.

## Orientation

- [Start Here](start-here.md)
- [LLM Wiki Contract](schema/llm-wiki-contract.md)
- [Ingestion Log](log.md)

## Project

- [Project Registry](projects/registry.md)
- [Lisa Monorepo Snapshot](projects/lisa-monorepo.md)
  - Current package version: `2.165.6`; latest captured merged PR: `#1287`.

## Documentation

- [Documentation Index](documentation/index.md)
- [Overview](documentation/overview.md)
  - Global CLI setup commands: `setup-project`, `setup-wiki`, `apply`, `doctor`, `version`, and `update`.
- [Contributing](documentation/contributing.md)
- [PRD Lifecycle Rollup Vendor Matrix](../plugins/src/base/rules/reference/prd-lifecycle-rollup.md)
- [Testing Documentation](documentation/testing/)
- [Workflow Documentation](documentation/workflows/)
  - [Wiki Ingestion Safety](documentation/workflows/wiki-ingestion-safety.md)
- [Specifications](documentation/specs/)

## Architecture

- [Lisa Architecture](architecture/lisa-architecture.md)
- [Template Governance](architecture/template-governance.md)
  - Current template surface includes Phaser 4, Harper Fabric workflow/realtime guard additions, and the esbuild audit-ignore template exclusion.
- [Coding-Agent Parity Architecture](architecture/coding-agent-parity.md)
- [Lisa Hook Per-Agent Ship List](architecture/lisa-hook-per-agent-ship-list.md)
  - Codex uses activated plugin hooks plus one tagged repository enforcement dispatcher; marketplace selection alone is not treated as hook-liveness proof.
- [Lisa Console UI](architecture/lisa-console-ui.md)
- [Pattern B Per-Agent Plugin Fan-Out Specification](architecture/pattern-b-fan-out-spec.md)

## Requirements

- [Lisa Governance Requirements](requirements/lisa-governance-requirements.md)

## Decisions

- [2026-09-05 — File Age Is Asked in Minutes, Never in Days](decisions/2026-09-05-find-age-predicates.md)
  - Why `find -mtime +N` means "older than N+1 days", the measured 49h-71h disagreement band, the correction to the "broken instrument" reading, and the `-mmin` / `! -newermt` equivalences the shipped ast-grep rule enforces.
- [2026-09-04 — An Absence Shaped Like a Verdict](decisions/2026-09-04-absence-shaped-like-a-verdict.md)
  - Eleven instruments that returned a clean negative without having asked the question, the negative control that refuted the one clean *success*, and the direction rule that separates a probe failing closed by design from an identical-looking one failing open.
- [2026-09-04 — State Changes Must Carry Their Own Inverse](decisions/2026-09-04-state-change-without-inverse.md)
  - Census of controls that apply durable state with nothing to lift it, the self-voiding controls worth copying, the settled grandfathered-contexts ruling, and the missing-versus-forbidden distinction an audit must record.
- [2026-08-19 — Mutation Gate Scoped at the Guard Scripts](decisions/2026-08-19-guard-mutation-gate.md)
- [2026-08-12 — Credential-Provider Substrate Precedence](decisions/2026-08-12-credential-substrate-precedence.md)
- [2026-08-12 — In-Session Filed Tickets and the Ready Role](decisions/2026-08-12-in-session-ticket-ready-role.md)
- [2026-08-12 — Ratchet Policy: Absolute Floors, No Generic Creep](decisions/2026-08-12-ratchet-policy.md)
- [2026-08-12 — Agent-Neutral Host-Rules Path, agy Delivery, and Wiki Load Posture](decisions/2026-08-12-agent-neutral-host-rules-path.md)
- [2026-07-25 — The Three-Layer Trust Play (TASC / Measurement SaaS / Lisa)](decisions/2026-07-25-three-layer-trust-play.md)
- [2026-07-10 — Project-Scoped Codex Delivery](decisions/2026-05-28-codex-skills-canonical-path.md)
- [2026-05-28 — Pattern B Per-Agent Plugin Variants](decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md)

## Playbooks

- [Lisa Workflow Playbook](playbooks/lisa-workflow-playbook.md)
  - Codex repair-intake defaults, hook-write nudges, oxlint edit-time lint, lint-ignored file handling, executable plugin hooks, bootstrapper build-context guards, and shared audit-ignore promotion guidance are captured here.
- [Coding-Agent Parity Research Playbook](playbooks/coding-agent-parity-research.md)
- [Dependency Ownership — Operator Guide](playbooks/dependency-ownership-operator-guide.md)
  - How a non-technical operator decides whether a dependency addition, internalization, or version bump is acceptable: the `.lisa/DEPENDENCY_DECISIONS.md` records, the six trust classes, the advisory manifest-authoritative duplicate-pin policy, Lisa's own seeded records with gaps tracked in `#1918`, and the seven-part confidence-rebuild kit.

## Concepts

- [TASC — Trust in Autonomous Software Criteria](concepts/tasc-specification.md)
  - SOC 2-parity attestation spec for autonomous development; AC1–AC9 mirror CC1–CC9; Type C continuous attestation; 0.2.0-draft adds evidence authenticity, finding and measurement integrity, generative testing, and distributional model qualification; 0.3.0-draft adds the named accountable party, standing to accept risk, and incident answerability; 0.4.0-draft adds the maintained evaluation suite, capability-drift monitoring, and delivery-effectiveness measurement; 0.5.0-draft adds agent-to-agent boundaries, risk-tiered autonomy, shadow-mode staff introduction, and approval sampling; 0.6.0-draft adds declared control obligations, the bidirectionally reconciled control register, and output provenance and licensing for code the system emits; 0.7.0-draft adds one conversational-plus-formal question model, durable orchestration, task-class model routing, complete and efficiently tiered E2E proof, repository-bound control activation, measured UI/UX conformance, pre-CI parity, and failed-deployment recovery; draft source at [spec/tasc-0.1-draft.md](../spec/tasc-0.1-draft.md).
- [Lisa Vocabulary](concepts/lisa-vocabulary.md)
  - Distinguishes installation readiness, repository readiness, and the ship blocker condition that produces a narrowed `NOT_READY` claim.
- [Coding-Agent Feature Taxonomy](concepts/coding-agent-feature-taxonomy.md)
- [Bounded-Claims Evidence System](concepts/bounded-claims-evidence-system.md)
  - What "verified" means: the claim-boundary taxonomy, the four evidence disciplines, the `verification.gate.enforceBoundaries` / `security.review.unprovenBucket` flip points, and the advisory→blocking ratchet.

## Entities

- [Coding Agents Lisa Installs Into](entities/coding-agents.md)

## Open Questions

- [Lisa Open Questions](open-questions/lisa-open-questions.md)
- [Coding-Agent Parity Open Questions](open-questions/coding-agent-parity.md)

## Categories

- [Architecture](architecture/)
- [Concepts](concepts/)
- [Decisions](decisions/)
- [Documentation](documentation/)
- [Entities](entities/)
- [Open Questions](open-questions/)
- [Playbooks](playbooks/)
- [Requirements](requirements/)

## Sources

- [Git Sources](sources/git/)
- [Memory Sources](sources/memory/)
- [Roles Sources](sources/roles/)
- [Repository Sources](sources/repository/)
- [GitHub Sources](sources/github/)
- [Linear Sources](sources/linear/)
- [Document Sources](sources/docs/)
- [Transcript Sources](sources/transcripts/)

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
- [Lisa Console UI](architecture/lisa-console-ui.md)
- [Pattern B Per-Agent Plugin Fan-Out Specification](architecture/pattern-b-fan-out-spec.md)

## Requirements

- [Lisa Governance Requirements](requirements/lisa-governance-requirements.md)

## Decisions

- [2026-07-10 — Project-Scoped Codex Delivery](decisions/2026-05-28-codex-skills-canonical-path.md)
- [2026-05-28 — Pattern B Per-Agent Plugin Variants](decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md)

## Playbooks

- [Lisa Workflow Playbook](playbooks/lisa-workflow-playbook.md)
  - Codex repair-intake defaults, hook-write nudges, oxlint edit-time lint, lint-ignored file handling, executable plugin hooks, bootstrapper build-context guards, and shared audit-ignore promotion guidance are captured here.
- [Coding-Agent Parity Research Playbook](playbooks/coding-agent-parity-research.md)

## Concepts

- [Lisa Vocabulary](concepts/lisa-vocabulary.md)
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

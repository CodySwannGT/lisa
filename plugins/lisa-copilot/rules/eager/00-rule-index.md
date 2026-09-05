# Rule Index — What Exists, and Where to Read It

The rules below are **not loaded**. Each is a full contract that other rules,
skills, and work items cite **by slug** ("per the `bdd-e2e-coverage` rule").
When you meet a slug and need the contract behind it, read that file — do not
re-derive the contract, and do not restate it where you cite it.

Read one when you are doing the thing it governs. Reading none of them is the
normal case for a session, which is why they are here rather than in your
context: the eager tier was cut to 26,540 bytes in May 2026 and had regrown to
201,083 by September, at which point every session and **every subagent** paid
~50,000 tokens before its first tool call (CodySwannGT/lisa#3992).

Paths are relative to this file.

## Work-item authoring, validation, and lifecycle

| Slug | Read it when | Body |
|---|---|---|
| `work-item-definition-of-ready` | authoring or validating a leaf; gates S1–S16 | [../reference/work-item-definition-of-ready.md](../reference/work-item-definition-of-ready.md) |
| `leaf-only-lifecycle` | applying a lifecycle role, or rolling a parent up | [../reference/leaf-only-lifecycle.md](../reference/leaf-only-lifecycle.md) |
| `ready-role-filing` | filing any work item (enforced by `block-direct-issue-create.sh`) | [../reference/ready-role-filing.md](../reference/ready-role-filing.md) |
| `repo-scope-split` | a leaf spans repos; gate S10, decomposition step 1.5 | [../reference/repo-scope-split.md](../reference/repo-scope-split.md) |
| `derived-branch-plan` | rendering or validating a Branch Plan; gate S19 | [../reference/derived-branch-plan.md](../reference/derived-branch-plan.md) |
| `control-reachability` | an item names an existing test as a red-before-green control; gate S20 | [../reference/control-reachability.md](../reference/control-reachability.md) |
| `pre-flight-autofill` | the pre-flight gate returned FAIL on ticket quality | [../reference/pre-flight-autofill.md](../reference/pre-flight-autofill.md) |
| `blocker-containment` | deciding whether an `is blocked by` dependency is cleared | [../reference/blocker-containment.md](../reference/blocker-containment.md) |
| `deployed-state-readback` | authoring a ticket asserting something is missing from a running system | [../reference/deployed-state-readback.md](../reference/deployed-state-readback.md) |
| `prd-definition-of-ready` | authoring or validating a PRD's requirement atoms | [../reference/prd-definition-of-ready.md](../reference/prd-definition-of-ready.md) |
| `prd-lifecycle-rollup` | rolling a PRD up from its generated top-level work | [../reference/prd-lifecycle-rollup.md](../reference/prd-lifecycle-rollup.md) |
| `usage-accounting` | writing the managed `## Lisa Usage` section on an artifact | [../reference/usage-accounting.md](../reference/usage-accounting.md) |

## Build-intake claim time

| Slug | Read it when | Body |
|---|---|---|
| `rejection-detection` | claiming a ready item (step 3b, before the relabel) | [../reference/rejection-detection.md](../reference/rejection-detection.md) |
| `claim-archaeology` | claiming a ready item, after rejection detection | [../reference/claim-archaeology.md](../reference/claim-archaeology.md) |
| `claim-time-guards` | claiming a ready item: already-implemented, two-failed-attempts | [../reference/claim-time-guards.md](../reference/claim-time-guards.md) |

## Coverage and evidence contracts

| Slug | Read it when | Body |
|---|---|---|
| `bdd-e2e-coverage` | the work item adds or changes a user-observable surface | [../reference/bdd-e2e-coverage.md](../reference/bdd-e2e-coverage.md) |
| `reset-seed-coverage` | the work item adds or changes persistent state | [../reference/reset-seed-coverage.md](../reference/reset-seed-coverage.md) |
| `claim-evidence-mapping` | citing evidence for a claim, or reviewing evidence someone cited | [../reference/claim-evidence-mapping.md](../reference/claim-evidence-mapping.md) |
| `observability-audit` | running the `lisa-monitor` audit-and-file arm | [../reference/observability-audit.md](../reference/observability-audit.md) |
| `readiness-rubric` | judging whether an unattended fleet may run in a repository | [../reference/readiness-rubric.md](../reference/readiness-rubric.md) |

## Design

| Slug | Read it when | Body |
|---|---|---|
| `design-value-binding` | implementing a UI surface in a project with a configured design source | [../reference/design-value-binding.md](../reference/design-value-binding.md) |
| `design-source-of-truth` | a change touches any UI surface | [../reference/design-source-of-truth.md](../reference/design-source-of-truth.md) |

## Dependencies

| Slug | Read it when | Body |
|---|---|---|
| `dependency-trust-classes` | adding or major-upgrading a material dependency | [../reference/dependency-trust-classes.md](../reference/dependency-trust-classes.md) |
| `dependency-decision-records` | adding, upgrading, or removing a material dependency | [../reference/dependency-decision-records.md](../reference/dependency-decision-records.md) |
| `dependency-internalization-kit` | removing, replacing, or internalizing a dependency | [../reference/dependency-internalization-kit.md](../reference/dependency-internalization-kit.md) |

## Process, review, and access

| Slug | Read it when | Body |
|---|---|---|
| `automation-runbook-contract` | registering a loop, or ending any flow with its run outcome | [../reference/automation-runbook-contract.md](../reference/automation-runbook-contract.md) |
| `convergent-review` | reviewing a PR or resolving review findings | [../reference/convergent-review.md](../reference/convergent-review.md) |
| `credential-substrate-precedence` | writing or editing an `*-access` skill | [../reference/credential-substrate-precedence.md](../reference/credential-substrate-precedence.md) |
| `promotion-contract` | implementing a learnings-ladder promotion ticket | [../reference/promotion-contract.md](../reference/promotion-contract.md) |
| `documentation-source-paths` | moving, absorbing, or deleting a docs-like directory | [../reference/documentation-source-paths.md](../reference/documentation-source-paths.md) |
| `project-learnings` | you need the learnings ledger's entry schema and field semantics | [../reference/project-learnings.md](../reference/project-learnings.md) |
| `factory-model` | you need the shape of the factory model, not its obligations | [../reference/factory-model.md](../reference/factory-model.md) |

The obligations that follow from `factory-model` are in `base-rules`, which is
eager. This entry is the exposition behind them.

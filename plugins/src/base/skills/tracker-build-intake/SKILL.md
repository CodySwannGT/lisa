---
name: tracker-build-intake
description: "Vendor-neutral wrapper for the build-queue batch scanner. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-build-intake (JQL/project-key queue), lisa:github-build-intake (GitHub repo queue keyed off the `status:ready` label), or lisa:linear-build-intake (Linear team queue keyed off the `status:ready` label). Every vendor scanner enforces the claim-time arm of the `leaf-only-lifecycle` rule — claim leaf work units only; skip or safe-block a container with open child work (or a childless Epic/Story/Spike) that carries a stale build-ready role. Counterpart to lisa:intake's PRD-side dispatchers."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Build Intake: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor build-queue scanner.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a JIRA project key (e.g., `SE`) or a JQL filter.
   - `github` → invoke `lisa:github-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a GitHub `org/repo` token or a full GitHub repo URL.
   - `linear` → invoke `lisa:linear-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a Linear team key (e.g., `ENG`) or the literal token `linear` (which falls back to `linear.teamKey`).
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the cycle summary verbatim.

## Leaf-only claim contract (forwarded to every vendor)

This shim is dispatch only — it does not reclassify or re-gate items — but the contract it forwards is part of the build-intake API, so it is documented here once and the three vendor scanners implement it identically. Per the vendor-neutral `leaf-only-lifecycle` rule, **build intake claims only independently implementable leaf work units**:

- A **leaf work unit** (Bug, Task, Sub-task, Improvement with no open child work) is claimed and built.
- A **container** — anything with open child work, or a childless Epic/Story/Spike — that still carries a stale build-ready role is **never claimed**. The vendor scanner skips it or safe-blocks it with an idempotent lifecycle-repair comment (move the build-ready role off the parent onto its leaf children; a parent's state rolls up from its children and is never set to ready directly).

This is the claim-time arm of the rule. Its siblings are the write-time labeling (`lisa:tracker-write` → the vendor `*-write-*` skills apply build-ready to leaves only) and the validate-time S15 gate (`lisa:tracker-validate` → the vendor `*-validate-*` skills FAIL a build-ready container). All three arms cite `leaf-only-lifecycle` so no vendor drifts. Each vendor scanner implements the gate against its own hierarchy:

| Tracker | Vendor scanner | Hierarchy used to detect open child work |
|---|---|---|
| `github` | `lisa:github-build-intake` (Phase 3a) | native sub-issues (GraphQL) + body parentage |
| `jira` | `lisa:jira-build-intake` (Phase 3a) | native Epic → Story → Sub-task parentage |
| `linear` | `lisa:linear-build-intake` (Phase 3a) | native sub-issues via `parentId` + Project grouping |

The shim never needs to inspect the item itself — it forwards `$ARGUMENTS` verbatim and the resolved vendor scanner runs its Phase 3a gate before any claim.

## Rules

- Single cycle per invocation — the vendor skill processes the current `Ready` set and exits.
- The vendor skills run their own pre-flight checks (JIRA workflow transitions for the JIRA path; label namespace adoption for the GitHub and Linear paths) before processing items. Never bypass.
- **Leaf-only claim, every vendor.** Per the `leaf-only-lifecycle` rule, each vendor scanner claims leaf work units only and skips / safe-blocks a container (open child work, or a childless Epic/Story/Spike) carrying a stale build-ready role. This shim does not re-implement the gate — it relies on the vendor scanner's Phase 3a — but the contract is uniform across `jira`, `github`, and `linear` so behavior never drifts by tracker.
- Never run two intake cycles concurrently against overlapping queues — the scheduling layer is responsible for serialization.

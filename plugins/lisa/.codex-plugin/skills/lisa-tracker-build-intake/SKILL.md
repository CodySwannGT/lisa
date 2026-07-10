---
name: lisa-tracker-build-intake
description: "Vendor-neutral wrapper for the…"
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Build Intake: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor build-queue scanner.

See the `config-resolution` rule for configuration and dispatch table.

The vendor scanners also own the terminal native-closure step from `leaf-only-lifecycle`: after a leaf reaches the true terminal `done` value, they close / resolve / complete the native tracker item where supported, while leaving intermediate env states open.

They also forward the narrow duplicate terminal exception from `ticket-triage`: when a claimed item returns `DUPLICATE_ALREADY_FIXED` with a canonical item reference and empirical base-branch evidence, the vendor scanner posts the triage finding, ensures a native `duplicates <canonical>` link where supported, and closes the item as a duplicate without opening a PR. This is distinct from `BLOCKED`; open blockers, ambiguous tickets, and duplicate-of-open findings stay held for human action.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a JIRA project key (e.g., `SE`) or a JQL filter.
   - `github` → invoke `lisa-github-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a GitHub `org/repo` token or a full GitHub repo URL.
   - `linear` → invoke `lisa-linear-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a Linear team key (e.g., `ENG`) or the literal token `linear` (which falls back to `linear.teamKey`).
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the cycle summary verbatim.

## Leaf-only claim contract (forwarded to every vendor)

This shim is dispatch only — it does not reclassify or re-gate items — but the contract it forwards is part of the build-intake API, so it is documented here once and the three vendor scanners implement it identically. Per the vendor-neutral `leaf-only-lifecycle` rule, **build intake claims only independently implementable leaf work units**:

- A **leaf work unit** (Bug, Task, Sub-task, Improvement, or a childless Story/Spike — anything with no open child work except an Epic) is claimed and built.
- A **container** — anything with open child work, or a childless Epic — that still carries a stale build-ready role is **never dispatched**. The GitHub scanner moves it out of the pickup queue by replacing `status:ready` with `status:in-progress` and posting an idempotent lifecycle-repair comment; other vendor scanners skip or safe-block according to their native lifecycle semantics.

This is the claim-time arm of the rule. Its siblings are the write-time labeling (`lisa-tracker-write` → the vendor `*-write-*` skills apply build-ready to leaves only) and the validate-time S15 gate (`lisa-tracker-validate` → the vendor `*-validate-*` skills FAIL a build-ready container). All three arms cite `leaf-only-lifecycle` so no vendor drifts. Each vendor scanner implements the gate against its own hierarchy:

| Tracker | Vendor scanner | Hierarchy used to detect open child work |
|---|---|---|
| `github` | `lisa-github-build-intake` (Phase 3a) | native sub-issues (GraphQL) + body parentage |
| `jira` | `lisa-jira-build-intake` (Phase 3a) | native Epic → Story → Sub-task parentage |
| `linear` | `lisa-linear-build-intake` (Phase 3a) | native sub-issues via `parentId` + Project grouping |

The shim never needs to inspect the item itself — it forwards `$ARGUMENTS` verbatim and the resolved vendor scanner runs its Phase 3a gate before any claim.

## Repo-scope claim contract (forwarded to every vendor)

Equally part of the build-intake API, and forwarded identically: when the tracker oversees multiple repos, each vendor scanner claims only tickets for the repo it is running in. Per the `repo-scope-split` rule's "Claim-time repo scoping" section, before the leaf-only gate each scanner (Phase 3a.0) resolves the current repo (`config-resolution` "Repo scoping": `repo` → `github.repo` → git remote basename), then for each ready candidate: skips a ticket labeled `repo:<other>`, determines + stamps `repo:<name>` on an unlabeled one, splits a multi-repo leaf into single-repo build-ready siblings, and claims only a single-repo leaf for the current repo. This shim does not re-implement the gate — it relies on the vendor scanner's Phase 3a.0 — but the contract is uniform across `jira`, `github`, and `linear` so behavior never drifts by tracker. It is the claim-time complement to the write-time S10 scope gate (`lisa-tracker-validate`) and `task-decomposition` step 1.5; all cite `repo-scope-split`.

## Terminal native-closure contract (forwarded to every vendor)

This shim also forwards the `leaf-only-lifecycle` terminal native-closure contract. It does not decide whether a `done` value is terminal; the vendor scanner resolves that from its own config and deployment topology after the per-item agent succeeds.

| Tracker | Vendor scanner behavior at true terminal `done` |
|---|---|
| `github` | apply the terminal `done` label, then `gh issue close --reason completed` |
| `jira` | transition to the configured terminal status and verify native resolved / closed state |
| `linear` | apply the terminal `done` label, then move the Issue to the configured completed workflow state |

Intermediate env states are not native closure. A vendor scanner that resolves `On Dev`, `On Stg`, `status:on-dev`, `status:on-stg`, or a configured equivalent leaves the item open / unresolved.

## Duplicate-already-fixed terminal contract (forwarded to every vendor)

`DUPLICATE_ALREADY_FIXED` is the only triage verdict that may close a claimed build item without a PR from the current cycle. The vendor scanner must require:

- canonical ticket/issue reference;
- canonical PR/commit reference;
- empirical evidence that the canonical fix is present on the relevant base branch.

Vendor closeout behavior:

| Tracker | Duplicate closeout |
|---|---|
| `github` | apply terminal `$DONE`, ensure/link `duplicates <canonical>` where available, then `gh issue close --reason "not planned"` |
| `jira` | transition to terminal `$DONE` with resolution `Duplicate` and ensure the native duplicates link |
| `linear` | apply terminal `$DONE`, ensure/link duplicate relationship where available, then move to the configured canceled-as-duplicate or terminal duplicate state |

If the canonical fix is merged but not yet on the production branch, the close comment must preserve the production-promotion caveat: the production error can recur until the canonical item promotes, and recurrence is tracked by the canonical item rather than by reopening this duplicate.

## Rules

- Single cycle per invocation — the vendor skill processes at most one eligible `Ready` item and exits. Scheduler repetition works the rest of the queue.
- The vendor skills run their own pre-flight checks (JIRA workflow transitions for the JIRA path; label namespace adoption for the GitHub and Linear paths) before processing items. Never bypass.
- **Leaf-only dispatch, every vendor.** Per the `leaf-only-lifecycle` rule, each vendor scanner dispatches leaf work units only and moves or safe-blocks a container (open child work, or a childless Epic) carrying a stale build-ready role according to its lifecycle semantics. This shim does not re-implement the gate — it relies on the vendor scanner's Phase 3a — but the contract is uniform across `jira`, `github`, and `linear` so behavior never drifts by tracker.
- **Terminal native closure, every capable vendor.** Per the same rule, each vendor scanner finalizes native open/closed state only at the true terminal `done` value. This shim never performs native closure itself, but callers can rely on the dispatched vendor scanner to apply the contract.
- **Duplicate already fixed, every vendor.** Auto-close without a PR is allowed only for `DUPLICATE_ALREADY_FIXED` with canonical reference and empirical base-branch evidence. Do not conflate this with `BLOCKED`.
- Never run two intake cycles concurrently against overlapping queues — the scheduling layer is responsible for serialization.

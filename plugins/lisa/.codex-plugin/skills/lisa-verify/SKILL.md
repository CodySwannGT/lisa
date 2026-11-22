---
name: lisa-verify
description: "Ship and verify code"
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---
Ship and verify code. Commits any pending changes, opens or updates the PR, handles the review loop, merges when green, monitors the deploy, and runs remote verification (health checks, Validation Journey replay, Sentry/log inspection) in the target environment. Folds in the legacy /ship alias.


# Verify: $ARGUMENTS

Ship the current branch and prove it works in the target environment.

## How to work

Do the work yourself, in this session. Delegate to a subagent only when a piece of work is sizeable and genuinely independent, such as the independent verification of a change you did not build — and give it the exact result you need back. Do not delegate work you can finish in a handful of tool calls.


## Flow

Execute the **Verify** flow as defined in the `intent-routing` reference rule (read on demand). The flow includes:

1. **Pre-flight: codification gate** — confirm that every passing local empirical verification on this branch was codified as a regression test (the Implement flow's codify step). If any verification has no committed test and no allowed skip reason (PR / Documentation / Deploy / Investigate-Only), invoke `codify-verification` now and amend the PR before shipping. For frontend work the gate additionally enforces the `bdd-e2e-coverage` rule: the shipped behavior exists as a Gherkin scenario with a stable ID, every required scenario-platform obligation has aligned automation in the project's configured runner for that platform or a dated waiver, and the project's coverage gate passes with the matrix regenerated. A missing runner is never a bare recorded absence — it needs a dated `platformWaivers` entry (per the rule) and, where the runner could reasonably be added, a linked build-ready follow-up ticket referenced from it — filed through `lisa-tracker-write` with explicit `build_ready: true` per `ready-role-filing`, since an omitted flag is NOT build-ready on any tracker and the waiver would then point at work nothing claims; never a silent skip. Missing BDD coverage is a verification failure that blocks the ship, not a warning. A change cannot ship until its verifications are guarded. For work that adds or changes persistent state the gate additionally enforces the `reset-seed-coverage` rule: every entity the work introduces or changes is classified in the project's state contract, anything `fixture-owned` has an ownership predicate and a sweep, and the state-classification check passes — an unclassified entity fails closed and blocks the ship exactly as missing BDD coverage does.
2. **Commit** any pending changes via `lisa-git-commit`
3. **Push and PR** via `lisa-git-submit-pr`
4. **PR Watch Loop** — drive the PR to MERGED via `lisa-drive-pr-to-merge`, the single source of truth for clearing every blocker: auto-merge with direct-merge fallback, `BEHIND` re-sync, conflict resolution, failing-check fixes, human + bot review-comment handling with thread resolution (it invokes `lisa-pull-request-review` itself), stale `CHANGES_REQUESTED` dismissal, and post-merge ancestry verification. Do not re-implement the loop or its terminal conditions.
5. **Merge** — owned by `lisa-drive-pr-to-merge`, including the auto-merge race and zero-deploy-run checks
6. **Remote verification** — invoke the `lisa-monitor` skill against the target environment **in report-only mode** (`lisa-monitor <env> --report-only`) to confirm the deploy actually works (health endpoints, recent logs/errors, Validation Journey replay if defined). `--report-only` is required here: it keeps the post-deploy check a pure health/audit report and prevents monitor's standalone ticket-filing from creating issues during a verify run. If remote verification surfaces a behavioral gap that the existing codified tests do not guard, invoke `codify-verification` to add coverage and open a follow-up PR.
   - When the Validation Journey is DOM-web, the target is an allowed non-production environment with mutation policy `full`, and `lisa kane probe` succeeds, verification may invoke `lisa-kane-browser`. Import the local evidence pack into Lisa's evidence flow; the Test Manager URL is secondary. Kane does not replace the pre-flight Playwright/Maestro codification gate.
   - When remote verification needs credentials, follow the shared `verification-lifecycle` credential lookup order before declaring them missing: project e2e / Playwright config and fixtures first, then `.lisa.config.local.json` / environment variables, then documented ticket credentials such as a `Sign-in Required` section.
   - Should credentials remain genuinely unavailable after those sources are exhausted, do not complete the item on artifact-only evidence. Post a tracker comment stating what could not be verified and why, transition the work item to the configured blocked state, and apply the configured `needs-human` / `human-review` label, creating it if the tracker supports label creation and it is missing.
   - **Telemetry arrives.** When the change adds or changes instrumentation — logs, metrics, traces, error reporting, analytics events — follow that instrumentation in the code to wherever it sends data: the SDK it initializes, the exporter or transport it configures, the environment variables it reads. Trigger the instrumented path in the target environment and confirm the signal arrived at that destination. Do not assume a vendor; a project may send to several, or to one Lisa has no access skill for. Use the destination's `*-access` skill when one exists, otherwise its CLI or API with credentials resolved through `lisa-secrets-access`. If the destination cannot be reached, that is a missing-access stop: name the destination and the credential, and never report the telemetry as verified.
   - Evidence must explicitly distinguish `verified empirically` from `artifact-only / verification deferred`.
7. **Evidence usage** — before posting, route the generated evidence artifact through `lisa-usage-accounting` so the comment body / PR evidence section / markdown proof carries a direct `lisa-verify` usage entry in the canonical `## Lisa Usage` section. If the originating work item or PRD parentage is known, prefer `record_and_rollup` so ancestor totals refresh in the same pass. If runtime usage is unavailable, still write `source: unavailable` with nullable token/cost fields instead of skipping the row.
8. **Evidence** — post results to the originating ticket via `lisa-tracker-evidence` (vendor-neutral; dispatches to `lisa-jira-evidence`, `lisa-github-evidence`, or `lisa-linear-evidence` per `.lisa.config.json` `tracker`), including the list of codified tests added on this branch. **If the work is UI-visible** (any verification step ran in a browser, or the change touches a user-facing surface), author `evidence/comment.md` per the **UI Evidence Checklist** in `lisa-tracker-evidence` — numbered live-session steps, one screenshot captured through the interactive browser controller per step uploaded to the configured GitHub evidence release (default `pr-assets`) as plain URLs, and an explicit invitation to be corrected.

The rule contains the canonical step sequence. Change it there, propagate everywhere.

## Capture learnings

Before returning, list what this run learned the hard way that a later run in this project would otherwise relearn — a misleading source, a tool or access that was missing, a step that failed and why. Route each through `lisa-persist-learning` with `rule`, `why`, `provenance`, and `triggering_issue` set to the originating work item. Its judge drops most candidates; that is expected, and zero candidates is a valid result. Never write the ledger or any rule file directly.

## Output

A merged PR, a successful deploy to the target environment, and posted evidence on the originating work item.

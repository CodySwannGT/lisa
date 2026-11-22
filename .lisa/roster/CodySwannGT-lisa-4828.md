# Roster Decision — CodySwannGT/lisa#4828

Plan: `4828-session-manager-ledger-lock`
Work type: Implement → Build (Task) — serialize `updateLedger` read-modify-write with a cross-process lock.
Context: `.lisa/work-item-context.md` (worktree-local, git-ignored).

```text
INCLUDE - lisa:github-agent - Served as the bounded input-resolver (lisa-track resolve → reuse claim → bind).
INCLUDE - Explore - Mandatory read-only research: ledger.mjs callers, learnings-ledger lock precedent (82def8af96), build:plugins fan-out, test conventions.
INCLUDE - lisa:builder - TDD implementation of the lock inside updateLedger plus concurrency/stale/timeout tests.
INCLUDE - lisa:quality-specialist - Independent review of correctness (atomic stale reclaim, never write without lock) and coding philosophy.
INCLUDE - lisa:verification-specialist - Independent empirical proof of the three Validation Journey steps and the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD learnings to the ledger after completion.
EXCLUDE - general-purpose - Specific specialists cover every role; no fallback needed.
EXCLUDE - claude - Catch-all; specific specialists fit.
EXCLUDE - claude-code-guide - No Claude Code/API product questions in scope.
EXCLUDE - code-simplifier:code-simplifier - Small focused change; quality-specialist covers simplification review.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Technical approach is fully prescribed by the ticket (lock in updateLedger, mirror existing precedent).
EXCLUDE - lisa:bug-fixer - Build/Task, not a reported bug flow.
EXCLUDE - lisa:confluence-prd-intake - No PRD intake.
EXCLUDE - lisa:debug-specialist - No defect to root-cause; race is already diagnosed.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the single precedent commit lookup.
EXCLUDE - lisa:github-build-intake - Not running an intake cycle.
EXCLUDE - lisa:github-prd-intake - No PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Invoked by learner/persist-learning only if needed.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - No PRD intake.
EXCLUDE - lisa:notion-prd-intake - No PRD intake.
EXCLUDE - lisa:performance-specialist - Lock retry bounds are specified; no perf workload.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No user-facing UI/flow; acceptance criteria already Gherkin.
EXCLUDE - lisa:security-specialist - Local file lock, no auth/secrets/input surface.
EXCLUDE - lisa:skill-evaluator - No learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks ACs; small spec.
EXCLUDE - lisa:test-specialist - builder writes tests via TDD; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Approach prescribed by ticket.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.
```

Base branch: `main` (Target Backend Environment: `Assumption: production — remote default branch main`; Branch Plan matches config `deploy.branches.production=main`).
Runtime behavior change: tooling-only, ships in the npm package; no deployed service.
Tool access required: `gh` (GitHub, probe `gh auth status` / `gh issue view 4828`), `bun`, `node`. No external services.

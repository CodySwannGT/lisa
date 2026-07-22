# Roster Decision — plan: dss-1-config-schema (CodySwannGT/lisa#1967)

Runtime: Claude Code, Agent tool subagent types enumerated 2026-07-22.
(Replaces the stale 2026-07-18 Cursor-run roster for #1546, which completed.)

INCLUDE - Explore - mandatory read-only research agent; gathers relevant_documentation for every task before implementation.
INCLUDE - lisa:architecture-specialist - designs the resolver module placement/API against existing config-resolution machinery (src/sync/registry.ts, doctor readers).
INCLUDE - lisa:builder - TDD implementation of the resolver, config schema, and rule-pair docs (story is a Build).
INCLUDE - lisa:test-specialist - reviews test matrix (ladder, collapse, inconsistent join, alias, operator-readable errors) beyond builder's own tests.
INCLUDE - lisa:quality-specialist - post-implementation quality review (coding philosophy, immutability, docs).
INCLUDE - code-simplifier:code-simplifier - simplification pass on new code before PR.
INCLUDE - coderabbit:code-reviewer - PR review layer (runs in PR loop via drive-pr-to-merge).
INCLUDE - lisa:verification-specialist - independent empirical verification + verification-status.json verdict (must not be the implementer).
INCLUDE - lisa:learner - capture-only MLD ledger persistence at task end.
INCLUDE - general-purpose - fallback for bounded transactional chores (input-resolver already used; tracker sync/evidence posting) where no specialist fits.
EXCLUDE - lisa:bug-fixer - work type is Build, not Fix; no reproduction sub-flow needed.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:performance-specialist - config resolver is trivial-scale; no perf surface.
EXCLUDE - lisa:security-specialist - no auth/secrets/input-trust surface in a local config resolver; PR-level scanners still run in CI.
EXCLUDE - lisa:product-specialist - no user-facing UX; operator-readable error text is covered by AC + quality review.
EXCLUDE - lisa:spec-conformance-specialist - single-story scope; spec conformance is covered by AC-driven verification here, full-PRD conformance belongs to DSS-9.
EXCLUDE - lisa:git-history-analyzer - context bundle already carries the needed history (#1953/#1954).
EXCLUDE - lisa:github-agent / jira-agent / linear-agent / *-build-intake / *-prd-intake - lifecycle dispatchers; this flow is already dispatched.
EXCLUDE - lisa:learning-judge / learnings-synthesizer / pr-mining-specialist / tracker-mining-specialist / skill-evaluator - debrief/gardener flows, not in-story.
EXCLUDE - claude-code-guide - no Claude-product questions in scope.
EXCLUDE - hookify:conversation-analyzer - no hook-authoring task.
EXCLUDE - statusline-setup - irrelevant.
EXCLUDE - Plan - decomposition already done at PRD planning; architecture-specialist covers design.
EXCLUDE - claude - generic catch-all; specific specialists selected instead.
EXCLUDE - casey/chief/felix/lex/mark/parker/sally - tunnl-backend domain agents; wrong project (added via /add-dir, not this repo).

## Flow determination
Flow: Implement. Work type: **Build** (type:Story, feature work, no bug/repro). Readiness gate: work item has AC, Validation Journey, no open blockers, claimed + bound — PASS.

## Base branch resolution (Target Backend Environment)
Ticket has no `## Target Backend Environment` section and no env signals in title/body (evidence scan: no deploy.branches key token, no env hostname). Fallback: remote default branch `main` reverse-maps uniquely to `production` in deploy.branches {production: main}. Recorded as: `Assumption: production — remote default branch main`. Base branch = main; PR target_branch=main.

## Completion condition (Verify contract)
End state: a resolver module in the Lisa package computes the env join from real `.lisa.config.json` fixtures.
Proof command (runs the actual system, not tests): a CLI/tsx invocation of the resolver (exact entry recorded at build time) against four fixture configs prints: (a) ordered ladder dev→staging→production with branch+done status per rung; (b) decision-ready error naming env "staging" + exact config key for the missing-branch fixture; (c) single-rung terminal-only ladder for production-only fixture; (d) single production rung for prod/production alias fixture.
Constraints: no existing config-resolution behavior changes (src/sync/registry.ts default semantics untouched); rule pair eager+reference both updated; evidence manifest regenerated in same commit; no new runtime dependency.

## Tool access preflight (tool-access-gate)
- gh CLI (GitHub API): PROBE `gh issue view 1967` — PASS (input-resolver transaction succeeded this session).
- git remote fetch/push: PROBE `git fetch origin` — PASS (fetched this session for branch fix/worktree-plugin-sync-marker; re-verified at branch setup).
- bun/node/tsc toolchain: PROBE `bun --version` / builds run this session — PASS.
- No external systems required (no AWS/Figma/Sentry/DB/browser). Regression-coverage note: not a user-visible UI surface; no e2e harness applies (checked: this repo has no .maestro/, no Playwright suite for the CLI). Highest practical observation level = CLI proof + unit tests. Recorded per the regression-spec absence path.

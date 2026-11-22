# Roster Decision — CodySwannGT/lisa#4701

Plan: `fix-packed-bin-macos-scratch`. Flow: Implement / Fix. The ticket declares "test-only", but the proven fix changes `src/configs/vitest/socket-safe-temp-base.ts`, which ships in the published `lisa-test-run` CLI. That is a macOS-only runtime change to TMPDIR selection. Base: `main`.

INCLUDE - lisa:bug-fixer - Fix flow: reproduce the macOS failure as the failing test and implement the minimal TDD fix.
INCLUDE - lisa:debug-specialist - Cause is explicitly unconfirmed; must be proven by execution (bisect vs #4688, sweep vs env leak).
INCLUDE - Explore - Mandatory read-only research of the sweep, scratch helpers, and the test.
INCLUDE - lisa:verification-specialist - Independent verdict; runs the test and the push gate on this macOS host.
INCLUDE - lisa:quality-specialist - Reviews that the fix does not weaken the line-250 assertion.
INCLUDE - lisa:learner - Captures task MLD to the ledger.
INCLUDE - lisa:github-agent - Already used as the bounded input-resolver (tracker read/claim/bind).
EXCLUDE - general-purpose - Specific specialists cover every task.
EXCLUDE - claude - Catch-all; specialists cover the work.
EXCLUDE - claude-code-guide - No Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - Fix expected to be small; quality-specialist covers it.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - No design change; scoped test/helper fix.
EXCLUDE - lisa:builder - Fix flow, not a feature build; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - No PRD intake.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - debug-specialist owns the #4688 bisect directly.
EXCLUDE - lisa:github-build-intake - Single item, not an intake cycle.
EXCLUDE - lisa:github-prd-intake - No PRD.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Reached through the learner path if needed.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - No PRD.
EXCLUDE - lisa:notion-prd-intake - No PRD.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No user-facing behavior; test-only.
EXCLUDE - lisa:security-specialist - No security surface (temp-dir test harness).
EXCLUDE - lisa:skill-evaluator - No learning routing needed here.
EXCLUDE - lisa:spec-conformance-specialist - Three Gherkin ACs checked directly by verification-specialist.
EXCLUDE - lisa:test-specialist - Deliverable is fixing an existing integration test; bug-fixer + quality cover it.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Small scope; plan held in the task list.
EXCLUDE - statusline-setup - Unrelated.

Tool access preflight: gh (GitHub) passed via the live issue read and the reused claim. bun/vitest run on this macOS host, which is the repro surface. The preflight's maestro BLOCKED does not apply because there is no mobile surface. No browser or device E2E harness applies; the integration test itself is the regression coverage.

Target Backend Environment: the ticket says "None — no runtime behavior change: test-only". In fact the change ships in the npm package, which is released from `main` (production=main), so the base is `main` either way.

Completion condition: on this macOS host, `bunx vitest run tests/integration/lisa-test-run-packed-bin.test.ts` exits 0 with every case passing, and the line-250 empty-namespace assertion is no weaker. `bun run test:integration:push` reports no packed-bin failures. PR CI "Run Integration Tests" passes.

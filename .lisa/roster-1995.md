# Roster Decision — plan 1995-ledger-concurrent-writer-safety

Work item: CodySwannGT/lisa#1995 — concurrent learner passes race and corrupt the shared learnings ledger.
Work type: Fix (bug / data-integrity). Base branch: `main`. Runtime: Claude Code implicit-team model.

Enumeration of every agent type exposed by the Agent tool:

- INCLUDE - Explore - Mandatory read-only research; maps the ledger writer, the existing learnings-lock utility (#1924), every write call site, and the test surface.
- INCLUDE - general-purpose - Team-lead session utility tasks (branch/worktree setup, plan bookkeeping).
- INCLUDE - lisa:bug-fixer - Owns the reproduce-as-failing-test (concurrent writers corrupting the ledger) and the TDD fix.
- INCLUDE - lisa:test-specialist - Concurrency reproduction is the hard part; designing a deterministic multi-writer test that reliably fails pre-fix needs test-design expertise.
- INCLUDE - lisa:quality-specialist - Independent review of lock/atomic-write correctness before PR.
- INCLUDE - lisa:security-specialist - Lock handling has a known TOCTOU (#1924 unlink-by-path stale-lock reclaim); a fix that touches lock reclaim must not widen it.
- INCLUDE - lisa:verification-specialist - Independent empirical verification (actually race the writers) and the verdict file; must not be the implementer.
- INCLUDE - lisa:learner - Required: learnings reviewed post-implementation.
- EXCLUDE - lisa:architecture-specialist - Concurrency approach is constrained by the existing lock utility and atomic-temp-write helper; no open architectural question expected. Revisit if research shows no lock exists at all.
- EXCLUDE - lisa:debug-specialist - Failure mode and its window are described concretely in the issue with observed byte-state evidence; no open diagnosis.
- EXCLUDE - lisa:performance-specialist - Lock contention on a small file written once per flow; no performance surface worth a dedicated pass.
- EXCLUDE - lisa:builder - Fix flow, not a feature Build.
- EXCLUDE - lisa:product-specialist - No user-facing UX surface.
- EXCLUDE - lisa:spec-conformance-specialist - Acceptance criteria are concrete and testable; verification + quality cover conformance.
- EXCLUDE - lisa:git-history-analyzer - Explore already tasked with the #1959/#1924/#1998 history sweep.
- EXCLUDE - lisa:skill-evaluator - Invoked by learner if warranted, not a direct teammate.
- EXCLUDE - lisa:learnings-synthesizer / pr-mining-specialist / tracker-mining-specialist - Debrief-flow agents, not implement-flow.
- EXCLUDE - lisa:github-agent / jira-agent / linear-agent - Lifecycle dispatchers; this flow IS the lifecycle.
- EXCLUDE - lisa:*-build-intake / *-prd-intake (github/jira/linear/notion/confluence) - Queue scanners; single item already claimed.
- EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews arrive on the PR via CI.
- EXCLUDE - code-simplifier:code-simplifier - Concurrency-critical code; simplification risks weakening ordering guarantees.
- EXCLUDE - claude / claude-code-guide / statusline-setup - Catch-all or tooling-help agents, irrelevant.
- EXCLUDE - casey / chief / felix / lex / mark / parker / sally - tunnl-backend business-domain agents; wrong repo.
- EXCLUDE - Plan - Approach follows from the research map; no separate planning agent needed.

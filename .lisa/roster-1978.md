# Roster Decision — plan 1978-validate-pr-ci-backstop

Work item: CodySwannGT/lisa#1978 — wire `lisa-work-item.mjs validate-pr` into Lisa's own CI as the
server-side backstop for #1956's client-side push-range exclusion.
Work type: Build (task — a new CI gate). Base branch: `main`. Runtime: Claude Code implicit-team model.

Enumeration of every agent type exposed by the Agent tool:

- INCLUDE - lisa:builder - Owns the build: research the validate-pr contract + downstream template shape, add the workflow gate, and write the reproducer fixtures. Combined research+implement because the surface is one script contract plus one workflow job.
- INCLUDE - Explore - Read-only search capability is folded into the builder's research step for this item (the search space is two known files: scripts/lisa-work-item.mjs and .github/workflows/quality.yml plus the downstream template). Recorded as covered rather than spawned separately; a dedicated Explore adds a round-trip without adding coverage here.
- INCLUDE - general-purpose - Team-lead session utility tasks (worktree setup, binding, plan bookkeeping).
- INCLUDE - lisa:security-specialist - The gate exists BECAUSE of a security review finding (symref-repoint bypass); an independent pass must confirm the CI gate actually closes the hole rather than reimplementing the bypassable client-side logic server-side.
- INCLUDE - lisa:quality-specialist - Independent review of the workflow wiring and test fixtures before PR.
- INCLUDE - lisa:verification-specialist - Independent empirical verification and the verdict file; must not be the implementer.
- INCLUDE - lisa:learner - Required: learnings reviewed post-implementation.
- EXCLUDE - lisa:bug-fixer - This is a Build (new gate), not a defect repair; no reproduce-then-fix cycle over broken behavior.
- EXCLUDE - lisa:test-specialist - The test design is dictated by the AC (two named fixtures: the bypass reproducer must fail, a merge-synced PR must pass); builder writes them and quality-specialist reviews. Revisit if the fixtures prove subtle.
- EXCLUDE - lisa:architecture-specialist - Shape is fixed by the downstream template this repo already ships; the job is parity, not design.
- EXCLUDE - lisa:debug-specialist - Nothing to diagnose; the gap is a known absent workflow.
- EXCLUDE - lisa:performance-specialist - One short CI job; no performance surface.
- EXCLUDE - lisa:product-specialist - No user-facing UX.
- EXCLUDE - lisa:spec-conformance-specialist - Three concrete ACs; verification + quality cover conformance.
- EXCLUDE - lisa:git-history-analyzer - #1956 history already summarized in the issue and its review artifacts.
- EXCLUDE - lisa:skill-evaluator - Invoked by learner if warranted.
- EXCLUDE - lisa:learnings-synthesizer / pr-mining-specialist / tracker-mining-specialist - Debrief-flow agents.
- EXCLUDE - lisa:github-agent / jira-agent / linear-agent - Lifecycle dispatchers; this flow IS the lifecycle.
- EXCLUDE - lisa:*-build-intake / *-prd-intake - Queue scanners; single item already claimed.
- EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews arrive on the PR via CI.
- EXCLUDE - code-simplifier:code-simplifier - A security gate; simplification risks weakening the check.
- EXCLUDE - claude / claude-code-guide / statusline-setup - Catch-all or tooling-help agents.
- EXCLUDE - casey / chief / felix / lex / mark / parker / sally - acmeorgd-backend business-domain agents; wrong repo.
- EXCLUDE - Plan - Approach follows from the downstream template; no separate planning agent needed.

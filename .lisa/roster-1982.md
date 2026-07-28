# Roster Decision — plan 1982-content-guard-subst-in-double-quotes

Work item: CodySwannGT/lisa#1982 — safety-net content guards miss `$(...)` nested in double quotes.
Work type: Fix (bug / security hardening). Runtime: Claude Code implicit-team model (Agent tool).

Enumeration of every agent type exposed by the Agent tool, one line each:

- INCLUDE - Explore - Mandatory read-only research agent; maps guard code paths, fixture matrix, and build-plugins fan-out before implementation.
- INCLUDE - general-purpose - Team-lead session utility tasks (branch sync, plan bookkeeping) per the implement skill; input-resolver already ran as this type.
- INCLUDE - lisa:bug-fixer - Owns the mandatory Reproduce sub-flow (failing fixtures driving the real hook) and the TDD fix in plugins/src/base/hooks/parity-safety-net.sh.
- INCLUDE - lisa:security-specialist - The change widens a security guard; must threat-model which substitution-wrapped forms are executable-destructive vs inert to avoid overblocking-trains-bypass.
- INCLUDE - lisa:test-specialist - Designs the SUBST_BOUNDARY block/allow fixture matrix extension and reviews test quality.
- INCLUDE - lisa:quality-specialist - Independent code review of the fix before PR.
- INCLUDE - lisa:verification-specialist - Independent empirical verification (runs the real hook against payloads) and writes .lisa/verification-status.json; must not be the implementer.
- INCLUDE - lisa:learner - Required: each task's learnings reviewed post-implementation.
- EXCLUDE - lisa:debug-specialist - Root cause already isolated to exact lines by the #1958 security review and input bundle; no open diagnosis question.
- EXCLUDE - lisa:architecture-specialist - Single-file shell hook change with an established pattern; no architectural design needed.
- EXCLUDE - lisa:builder - Fix flow, not a feature Build.
- EXCLUDE - lisa:performance-specialist - A few regex/token checks in a hook; no performance surface.
- EXCLUDE - lisa:product-specialist - No user-facing UX; developer security hook.
- EXCLUDE - lisa:spec-conformance-specialist - Acceptance criteria are three concrete testable bullets; verification-specialist + quality-specialist cover conformance without a separate matrix agent.
- EXCLUDE - lisa:git-history-analyzer - History context already gathered (#1958/#1960/PR #1994) by input-resolver.
- EXCLUDE - lisa:skill-evaluator - Invoked by learner if warranted, not a direct teammate.
- EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-flow agents, not implement-flow.
- EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - Lifecycle dispatchers; this flow IS the lifecycle.
- EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake / lisa:github-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake / lisa:confluence-prd-intake - Queue scanners/intake agents; single-item flow already claimed.
- EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews arrive on the PR via CI; a local duplicate adds noise.
- EXCLUDE - code-simplifier:code-simplifier - Guard hook favors explicit, auditable checks; simplification pass risks weakening security semantics.
- EXCLUDE - claude / claude-code-guide / statusline-setup - Catch-all or tooling-help agents irrelevant to this fix.
- EXCLUDE - casey / chief / felix / lex / mark / parker / sally - tunnl-backend business-domain agents; wrong repo and domain.
- EXCLUDE - Plan - Implementation plan is already determined by the ticket + root-cause pointer.

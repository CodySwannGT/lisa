# Roster Decision — plan: safety-net-guard-parity (CodySwannGT/lisa#1960)

Runtime: Claude Code, implicit-team model (Agent tool). Recorded before spawning
any lifecycle/research/implementation/review/verification specialist
(input-resolver was the single permitted pre-roster spawn).

INCLUDE - Explore - required by the flow; read-only audit of upstream safety-net 1.0.6 cache tree vs Lisa's hook source.
INCLUDE - lisa:architecture-specialist - maps the guard-absorption design (hook structure, fixture-test placement, retirement touchpoints) before code changes.
INCLUDE - lisa:builder - implements guard absorption + retirement via TDD against acceptance criteria.
INCLUDE - lisa:test-specialist - designs the allow/block fixture matrix driven through the real hook (the AC's explicit test contract).
INCLUDE - lisa:security-specialist - the change IS a security control; reviews that no guard weakens and absorbed guards can't be trivially bypassed.
INCLUDE - lisa:quality-specialist - reviews correctness/conventions of hook shell code and skill/doc updates.
INCLUDE - lisa:verification-specialist - independent empirical verdict (runs the real hook fixtures, drift gate, install-script tests) and writes .lisa/verification-status.json.
INCLUDE - lisa:spec-conformance-specialist - checks shipped work against the issue's three AC bullets and the ordering constraint (parity before retirement).
INCLUDE - lisa:learner - required by the flow; processes task learnings at the end.
INCLUDE - general-purpose - fallback only for bounded one-shot chores with no fitting specialist; every use must be bounded.
EXCLUDE - lisa:bug-fixer - work type is Improve, not Fix; no reproduction sub-flow applies.
EXCLUDE - lisa:debug-specialist - no unexplained failure to root-cause; guard gaps are already enumerated.
EXCLUDE - lisa:performance-specialist - a grep-based hook has no perf surface worth a specialist.
EXCLUDE - lisa:product-specialist - no user-facing UX; developer tooling only.
EXCLUDE - lisa:git-history-analyzer - relevant history (#1955, c6c931e7f) already captured in the input-resolver bundle.
EXCLUDE - lisa:pr-mining-specialist - Debrief-flow agent, not Implement.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-flow agent, not Implement.
EXCLUDE - lisa:learnings-synthesizer - Debrief-flow agent, not Implement.
EXCLUDE - lisa:github-agent - lifecycle wrapper; this session IS the lifecycle orchestrator.
EXCLUDE - lisa:jira-agent - wrong tracker and lifecycle wrapper.
EXCLUDE - lisa:linear-agent - wrong tracker and lifecycle wrapper.
EXCLUDE - lisa:github-build-intake - queue scanner; single item already dispatched.
EXCLUDE - lisa:jira-build-intake - queue scanner, wrong tracker.
EXCLUDE - lisa:linear-build-intake - queue scanner, wrong tracker.
EXCLUDE - lisa:notion-prd-intake - PRD intake, not Implement.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, not Implement.
EXCLUDE - lisa:github-prd-intake - PRD intake, not Implement.
EXCLUDE - lisa:linear-prd-intake - PRD intake, not Implement.
EXCLUDE - lisa:skill-evaluator - invoked by learner downstream if warranted, not directly.
EXCLUDE - code-simplifier:code-simplifier - shell hook diff is small; quality-specialist covers review polish.
EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews land on the PR itself; duplicate here.
EXCLUDE - claude-code-guide - no Claude Code / API usage questions in scope.
EXCLUDE - Plan - lead session owns implement-flow planning; architecture-specialist covers design.
EXCLUDE - chief - tunnl-backend business-domain agent, irrelevant to lisa internals.
EXCLUDE - casey - business-domain agent, irrelevant.
EXCLUDE - felix - business-domain agent, irrelevant.
EXCLUDE - lex - business-domain agent, irrelevant.
EXCLUDE - mark - business-domain agent, irrelevant.
EXCLUDE - parker - business-domain agent, irrelevant.
EXCLUDE - sally - business-domain agent, irrelevant.
EXCLUDE - claude - catch-all; specific specialists cover all work.
EXCLUDE - statusline-setup - irrelevant to this work.

All teammate spawns use model=opus (owner preference).

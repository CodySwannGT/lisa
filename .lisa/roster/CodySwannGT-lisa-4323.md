# Roster Decision — CodySwannGT/lisa#4323

Plan: work-item-context-handoff. Work type: Fix (prompt/skill contract defect; reproduction = a regression test that fails on current main).

INCLUDE - general-purpose - input-resolver (bounded resolve/claim/bind); no more specific type owns tracker transactions.
INCLUDE - Explore - mandatory read-only research: every plugin surface, generator, and test that touches the files to change.
INCLUDE - lisa:bug-fixer - writes the failing regression test then the skill/agent text fix and regenerates plugin surfaces.
INCLUDE - lisa:verification-specialist - independent verdict: proves the regression test fails on main and passes on the branch, and that generated surfaces carry the change.
INCLUDE - lisa:learner - captures task learnings to the ledger.
EXCLUDE - lisa:test-specialist - the regression test is a single structural assertion; bug-fixer owns it under TDD.
EXCLUDE - lisa:architecture-specialist - the change is prompt text in known files; Explore maps the generation pipeline.
EXCLUDE - lisa:product-specialist - no user-facing UI; the operator-facing behaviour is specified by the ticket's Gherkin.
EXCLUDE - lisa:quality-specialist - lisa-git-submit-pr runs local review plus CodeRabbit on the PR.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the 8 Gherkin scenarios directly.
EXCLUDE - lisa:debug-specialist - root cause already established by grep evidence on 394e2c9.
INCLUDE - lisa:security-specialist - (amended after PR review) the change persists tracker comments, which may quote credentials, to a local file and defines how that content moves between agents; it needs a CWE-200 review of the handoff, the ignore and EAS-upload exclusions, and the prompt/task/tracker surfaces.
EXCLUDE - lisa:performance-specialist - no runtime code path.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer is the matching type.
EXCLUDE - lisa:git-history-analyzer - history not needed to decide the fix.
EXCLUDE - lisa:eval-specialist, lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learning-gardening flows, not Implement.
EXCLUDE - lisa:jira-agent, lisa:github-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake - tracker lifecycle/intake agents; this flow is already resolved and claimed.
EXCLUDE - coderabbit:code-reviewer - CodeRabbit reviews the PR itself.
EXCLUDE - code-simplifier:code-simplifier - prose change; nothing to simplify.
EXCLUDE - Plan - the plan is fixed by the ticket's fix list.
EXCLUDE - claude, claude-code-guide, statusline-setup, hookify:conversation-analyzer - not relevant to this change.

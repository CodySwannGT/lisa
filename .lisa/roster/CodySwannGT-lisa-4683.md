# Roster Decision — CodySwannGT/lisa#4683

Plan: 4683-complete-subcommand-alias. Work type: Fix (bug). Base: main
(deploy.branches production=main; the issue has no Target Backend Environment
section, so the plan is derived and recorded on the tracker).

INCLUDE - Explore - mandatory read-only research of lisa-work-item.mjs, its docs and tests.
INCLUDE - lisa:bug-fixer - reproduce the refusal and implement the alias via TDD.
INCLUDE - lisa:quality-specialist - review the diff for correctness and test quality.
INCLUDE - lisa:verification-specialist - independent empirical verification in a worktree-isolated session.
INCLUDE - lisa:learner - capture task learnings to the ledger.
INCLUDE - general-purpose - lead bookkeeping the skill assigns to it (plan name, branch, flow determination).
EXCLUDE - claude - generic catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - the runtime behaviour is reproduced empirically, not looked up.
EXCLUDE - code-simplifier:code-simplifier - the change is a small alias; quality review is enough.
EXCLUDE - hookify:conversation-analyzer - not a transcript-analysis task.
EXCLUDE - lisa:architecture-specialist - no design choice beyond the alias the issue prescribes.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - the cause is reproduced directly by a control run.
EXCLUDE - lisa:eval-specialist - no factory measurement.
EXCLUDE - lisa:git-history-analyzer - the #2469 precedent is already identified in the issue.
EXCLUDE - lisa:github-agent - used only as the input-resolver; the lead runs the lifecycle.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learnings-synthesizer - no debrief.
EXCLUDE - lisa:learning-judge - reached only through persist-learning if a candidate arises.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - no PRD.
EXCLUDE - lisa:notion-prd-intake - no PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - no debrief.
EXCLUDE - lisa:product-specialist - no user-facing flow; CLI subcommand alias.
EXCLUDE - lisa:security-specialist - the LINEAR_API_KEY handoff gap is out of scope here.
EXCLUDE - lisa:skill-evaluator - no learning routing.
EXCLUDE - lisa:spec-conformance-specialist - small issue; the verifier checks the ACs.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - no debrief.
EXCLUDE - Plan - the plan is small and written by the lead.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no web pages needed.

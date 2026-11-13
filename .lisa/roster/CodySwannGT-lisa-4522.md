# Roster Decision — CodySwannGT/lisa#4522

Work type: Fix (bug). Scope: the session-manager worker helpers in one repository. Two gaps: classification ignores `waitingFor`, and resume drops the permission/settings flags.

INCLUDE - lisa:github-agent - acted as the bounded input-resolver (read, claim reused, bind verified).
INCLUDE - Explore - required read-only codebase research for workers.mjs, session-manager.mjs, the cycle table docs and their tests.
INCLUDE - lisa:bug-fixer - does the Reproduce→fix TDD: failing tests for classify(waitingFor) and resume flag parity, then the fix.
INCLUDE - lisa:verification-specialist - independent empirical verification by running the classify/resume CLI paths and writing the verdict.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness and coding-philosophy compliance.
INCLUDE - lisa:learner - captures the task MLD learnings to the ledger.
EXCLUDE - claude - generic catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - the issue already cites the Claude Code docs; no new docs question.
EXCLUDE - code-simplifier:code-simplifier - the change is small and quality-specialist covers simplification.
EXCLUDE - general-purpose - no role is left unfilled by a specific specialist.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - lisa:architecture-specialist - localized change to two functions; no architectural design needed.
EXCLUDE - lisa:builder - this is a Fix, so bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - no Confluence PRD.
EXCLUDE - lisa:debug-specialist - the root cause is already stated precisely in the issue (missing waitingFor branch; missing flags on resume).
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history that matters.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not a PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked via learner/persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief flow only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no Notion PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief flow only.
EXCLUDE - lisa:product-specialist - internal operator tooling; the operator-message wording is reviewed by quality-specialist.
EXCLUDE - lisa:security-specialist - no new trust boundary. The resume reuses the spawn's existing permission flags, so it adds no privilege the worker didn't already have at spawn.
EXCLUDE - lisa:skill-evaluator - learning routing only.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the two Expected bullets directly.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - lisa:tracker-mining-specialist - debrief flow only.
EXCLUDE - Plan - the plan is small and is set out in the task list.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no web lookup needed.

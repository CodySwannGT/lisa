# Roster Decision — CodySwannGT/lisa#4526

Work type: Fix (bug) — reusable workflow `.github/workflows/load-test.yml` + NestJS k6 scenario templates.

INCLUDE - Explore - mandatory read-only research of load-test.yml, k6 templates, existing workflow tests.
INCLUDE - lisa:bug-fixer - reproduce each defect as a failing test, then fix via TDD.
INCLUDE - lisa:verification-specialist - independent empirical proof with a real k6 binary; writes the verdict.
INCLUDE - lisa:quality-specialist - review of the shell/YAML change and tests.
INCLUDE - lisa:learner - capture task MLD to the ledger.
INCLUDE - general-purpose - lead-session planning helper per skill (plan name, base branch, completion condition).
EXCLUDE - claude - catch-all; specific specialists cover every need.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - change is small; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - lisa:architecture-specialist - single-workflow fix whose design the ticket prescribes.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:confluence-prd-intake / lisa:github-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause already proven in the ticket with logs and line numbers.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history needed.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lead runs the lifecycle directly.
EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - not an intake cycle.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - reached through learner/persist-learning only if needed.
EXCLUDE - lisa:performance-specialist - pacing fix is covered by tests; no other perf surface.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no UI surface; CI workflow behavior.
EXCLUDE - lisa:security-specialist - no auth or secret surface changed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the AC matrix.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - Plan - planning handled by the lead.
EXCLUDE - statusline-setup / web-fetch - not relevant.

Tool access preflight: gh (pass: issue read), k6 v2.4.0 (pass: installed via Homebrew, `k6 version`), actionlint (absent; not required).
Target environment: none — CI workflow + templates, runtime_behavior_change for consumers via workflow; base branch main (deploy.branches production=main).

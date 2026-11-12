# Roster Decision — CodySwannGT/lisa#4634

Plan: `4634-shard-rerun-merge` · Work type: Fix (CI merge of shell-guard trace shards across Actions attempts)

- INCLUDE - lisa:github-agent - Served as the bounded input-resolver (read, claim, bind) for this GitHub-tracked item.
- INCLUDE - Explore - Mandatory read-only research: locate the shard runner, workflow download step, docs strings, and existing tests.
- INCLUDE - lisa:bug-fixer - Fix flow owner: reproduce the re-run failure as failing fixtures (red on main), then implement the newest-complete-bundle merge (green).
- INCLUDE - lisa:quality-specialist - Independent review of correctness, refusal messages, and test meaningfulness of the change.
- INCLUDE - lisa:verification-specialist - Independent (non-implementer) local proof and the single-shard re-run proof on the PR's own Plugins Sync run; writes the v2 verdict.
- INCLUDE - lisa:learner - Captures task MLD learnings to the ledger after completion.
- EXCLUDE - claude - Catch-all; the specialists above cover every step.
- EXCLUDE - claude-code-guide - No Claude Code / API product question involved.
- EXCLUDE - code-simplifier:code-simplifier - Change is small and targeted; quality-specialist covers clarity.
- EXCLUDE - general-purpose - More specific specialists fit every task; lead handles bookkeeping inline.
- EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts for hooks.
- EXCLUDE - lisa:architecture-specialist - Technical approach is fully prescribed in the issue (file, function, rules).
- EXCLUDE - lisa:builder - Fix flow, not a feature build; bug-fixer owns implementation.
- EXCLUDE - lisa:confluence-prd-intake - No PRD intake.
- EXCLUDE - lisa:debug-specialist - Root cause is already established in the issue and #4548 (current-attempt-only download + exact-three check).
- EXCLUDE - lisa:eval-specialist - Not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history (#4548/#4626) inline.
- EXCLUDE - lisa:github-build-intake - Not running an intake cycle.
- EXCLUDE - lisa:github-prd-intake - No PRD intake.
- EXCLUDE - lisa:jira-agent - Tracker is GitHub.
- EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
- EXCLUDE - lisa:learning-judge - Invoked inside persist-learning only if a candidate arises; not a standing teammate.
- EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
- EXCLUDE - lisa:linear-agent - Tracker is GitHub.
- EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
- EXCLUDE - lisa:linear-prd-intake - No PRD intake.
- EXCLUDE - lisa:notion-prd-intake - No PRD intake.
- EXCLUDE - lisa:performance-specialist - No performance-sensitive path; merge handles a handful of directories.
- EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
- EXCLUDE - lisa:product-specialist - No user-visible product surface; the operator-facing surface is CI refusal text, reviewed by quality-specialist.
- EXCLUDE - lisa:security-specialist - Change keeps existing foreign/stale-bundle protections; quality-specialist verifies the runId/sourceSha/prHead/workflowRef refusals remain.
- EXCLUDE - lisa:skill-evaluator - No learning routing needed up front.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the four Gherkin scenarios directly; small single-file scope.
- EXCLUDE - lisa:test-specialist - Fixtures are enumerated verbatim in the issue; bug-fixer writes them TDD.
- EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
- EXCLUDE - Plan - Approach prescribed by the issue.
- EXCLUDE - statusline-setup - Unrelated.
- EXCLUDE - web-fetch - No external pages needed.

Tool access required: GitHub (`gh auth status`, write access to CodySwannGT/lisa for `gh run rerun --job`). No browser/device harness applies (CI script; regression coverage = shard-runner unit/integration tests).

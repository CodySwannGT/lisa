# Roster Decision — CodySwannGT/lisa#4621

Plan: `fix-4621-history-scanner-cleanup`. Work type: Fix (four latent cleanup defects in Lisa's own test helpers).
Runtime: Claude Code (implicit-team model). Input resolver (`lisa:github-agent`) already ran lisa-track: claim `reused`, binding verified, route `implement`.

INCLUDE - Explore - mandatory read-only research: current state of the history-scanner helpers on origin/main, #4602 status, and artifact/manifest references.
INCLUDE - lisa:bug-fixer - reproduces each gap as a failing unit test (RED) and implements the minimal fix (GREEN) via TDD.
INCLUDE - lisa:verification-specialist - independent verifier; runs the new test file and the four history-scanner suites and writes the v2 verdict.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness and coding-philosophy compliance before the PR.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger, as the flow requires.
INCLUDE - lisa:github-agent - input resolver (lisa-track resolve/claim/bind); already completed.
EXCLUDE - general-purpose - more specific specialists cover every task; no fallback needed.
EXCLUDE - claude - catch-all; specialists cover the work.
EXCLUDE - Plan - the issue already prescribes the fix per gap; bug-fixer plans inline.
EXCLUDE - lisa:architecture-specialist - no design decision; the issue prescribes each change.
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
EXCLUDE - lisa:debug-specialist - causes are already proven in the issue with line citations; no open root cause.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; quality-specialist reviews them.
EXCLUDE - lisa:product-specialist - no user-facing surface; test-helper internals only.
EXCLUDE - lisa:spec-conformance-specialist - acceptance criteria are five narrow Gherkin scenarios checked directly by the verifier.
EXCLUDE - lisa:security-specialist - no security surface (local test scratch cleanup).
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:git-history-analyzer - resolver already confirmed the cited code is unchanged since #4618.
EXCLUDE - lisa:learning-judge - invoked via lisa-persist-learning only if a learning candidate arises.
EXCLUDE - lisa:skill-evaluator - no skill routing in scope.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-only agents.
EXCLUDE - lisa:jira-agent / lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - intake dispatchers, not used inside an Implement flow.
EXCLUDE - lisa:github-prd-intake / lisa:notion-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake - PRD intake, not applicable.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - change is small; quality-specialist covers it.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

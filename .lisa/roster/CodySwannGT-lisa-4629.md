# Roster Decision — CodySwannGT/lisa#4629

Plan: 4629-enametoolong-doctor-absence. Flow: Implement / Fix (bug). Base: main (Assumption: production — remote default branch main; Branch Plan matches).

INCLUDE - general-purpose - Bounded input-resolver (already ran); no more specific type for a raw tracker read.
INCLUDE - Explore - Mandatory read-only research: the five errno copies, the evidence-seed errno test pattern, existing check tests.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing errno tests (RED), then add shared helper and migrate five checks (GREEN).
INCLUDE - lisa:quality-specialist - Review the diff for correctness, test meaningfulness, and coding-philosophy compliance.
INCLUDE - lisa:verification-specialist - Independent empirical proof: deep-root reproduction on macOS against the built CLI, write the verdict.
INCLUDE - lisa:learner - Capture task MLD into the learnings ledger.
EXCLUDE - claude - Generic catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - No Claude Code / API question involved.
EXCLUDE - code-simplifier:code-simplifier - Change is a small dedupe; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - Technical approach is fully prescribed by the issue (one helper, five call sites).
EXCLUDE - lisa:builder - Fix flow, bug-fixer is the matching implementer.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:debug-specialist - Root cause already proven in the issue with line citations; reproduction is by failing tests.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Relevant history (bae846328b) is already cited in the issue.
EXCLUDE - lisa:github-agent - Lead runs the lifecycle directly via this skill.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - Tracker is GitHub.
EXCLUDE - lisa:learning-judge - Invoked by persist-learning only if a candidate surfaces.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - Tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:product-specialist - No UI; acceptance criteria already in Gherkin.
EXCLUDE - lisa:security-specialist - No auth/input/secrets surface; errno classification only.
EXCLUDE - lisa:skill-evaluator - No learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the five Gherkin scenarios directly; small spec.
EXCLUDE - lisa:test-specialist - Test design is prescribed in the issue; bug-fixer writes them via TDD.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - Plan - Approach is prescribed.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No web pages needed.

Tool access: gh (tracker + PR) — probed OK via `gh issue view 4629`; bun/node local — repo toolchain. No external systems. Regression harness: unit (vitest/jest) is the highest observation level for a CLI doctor check; no browser/device surface.

Completion condition: on macOS, the deep-root (1016-char) reproduction run through the built `checkRailsDeployIntent`, `checkConfigShadowing`, `checkCdkPresetAdoption` reports no `ok` for the deep root (fail "Could not determine … ENAMETOOLONG"), while the short root still reports warn/fail/fail unchanged; `grep ABSENT_CODES src/cli` finds no local sets.

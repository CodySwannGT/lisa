# Roster Decision — CodySwannGT/lisa#4536

Flow: Implement / Fix (bug). Learnings writer: over-cap ledger lockout + no retire API.
Base branch: `main` (no Target Backend Environment section; remote default `main` maps uniquely to `production`; the change is library-internal and ships via npm release).

```text
INCLUDE - lisa:github-agent - Bounded input-resolver (read, claim reuse, bind) for the GitHub tracker.
INCLUDE - Explore - Mandatory read-only research of the learnings writer/document/overflow modules, tests, and git history on origin/main.
INCLUDE - lisa:bug-fixer - Reproduces the lockout as failing tests and implements the fix via TDD.
INCLUDE - lisa:quality-specialist - Independent review of correctness and coding-philosophy compliance of the new writer.
INCLUDE - lisa:verification-specialist - Independent empirical verification (runs the real contract writer against an over-cap ledger fixture) and writes the verdict.
INCLUDE - lisa:learner - Captures task learnings to the ledger per the lifecycle.
EXCLUDE - lisa:test-specialist - The bug-fixer's TDD covers test design for this bounded library change; quality-specialist reviews test quality.
EXCLUDE - lisa:architecture-specialist - Scope is two small additions inside existing modules; Explore research covers the design surface.
EXCLUDE - lisa:debug-specialist - Root cause is already stated with file/line evidence in the issue; reproduction is via failing tests.
EXCLUDE - lisa:builder - This is a Fix; bug-fixer is the matching specialist.
EXCLUDE - lisa:security-specialist - No auth, secrets, input from network, or trust boundary change; local file writer only.
EXCLUDE - lisa:performance-specialist - No hot path; ledger is ~15KB.
EXCLUDE - lisa:product-specialist - No user-visible UI; operator-facing surface is a library API and a skill doc line.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers AC conformance for this small item.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers history for these files.
EXCLUDE - lisa:learning-judge - Invoked inside lisa-persist-learning only if a planning-miss arises.
EXCLUDE - lisa:skill-evaluator - No learning routing in this flow.
EXCLUDE - lisa:learnings-synthesizer - Debrief-only.
EXCLUDE - lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief-only.
EXCLUDE - lisa:jira-agent - Tracker is GitHub.
EXCLUDE - lisa:linear-agent - Tracker is GitHub.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:jira-build-intake - Not an intake cycle.
EXCLUDE - lisa:linear-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - Not PRD intake.
EXCLUDE - lisa:notion-prd-intake - Not PRD intake.
EXCLUDE - lisa:confluence-prd-intake - Not PRD intake.
EXCLUDE - lisa:linear-prd-intake - Not PRD intake.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review suffices for a small diff.
EXCLUDE - general-purpose - More specific specialists cover every task.
EXCLUDE - claude - More specific specialists cover every task.
EXCLUDE - Plan - Plan is small and written by the lead from Explore findings.
EXCLUDE - claude-code-guide - No Claude Code product question.
EXCLUDE - hookify:conversation-analyzer - Not analyzing transcripts.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.
```

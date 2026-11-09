# Roster Decision — CodySwannGT/lisa#4652

Plan: `4652-pinned-status-evidence` — Fix (bug): honor the `posted_by` app pin when the
third-party review evidence prover falls back to commit statuses.

Work type: Implement → Fix. Base branch `main` (Target Backend Environment
`Assumption: production — remote default branch main`, matches the ticket's Branch Plan).

```text
INCLUDE - lisa:bug-fixer - Fix flow: reproduces the pinned-status acceptance as a failing unit test, then fixes the prover via TDD.
INCLUDE - Explore - Mandatory read-only research: locate the prover, its tests, docs and current main line numbers.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical verification and the v2 verdict.
INCLUDE - lisa:quality-specialist - Review of the change for correctness, tests and docs.
INCLUDE - lisa:learner - Captures task MLD learnings to the ledger, as the flow requires.
INCLUDE - general-purpose - Lead-session plan/branch/completion-condition helper steps the skill names explicitly.
EXCLUDE - lisa:builder - Fix, not a feature build; bug-fixer covers TDD.
EXCLUDE - lisa:debug-specialist - Root cause is already cited line-by-line in the issue and reproduction is a unit call.
EXCLUDE - lisa:test-specialist - Three named test cases are specified; bug-fixer writes them.
EXCLUDE - lisa:architecture-specialist - Single-function change in one script, no design choice beyond option (a) the issue recommends.
EXCLUDE - lisa:security-specialist - Change tightens a check; quality review covers it, no new attack surface.
EXCLUDE - lisa:performance-specialist - No performance surface.
EXCLUDE - lisa:product-specialist - No user-visible UI; behavior is a CLI script report.
EXCLUDE - lisa:spec-conformance-specialist - Three Gherkin ACs are checked directly by verification-specialist.
EXCLUDE - lisa:git-history-analyzer - Issue already carries the relationship search and git-log history.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - Lifecycle handled by this lead via tracker skills.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake - Intake flows, not used for a single claimed item.
EXCLUDE - lisa:eval-specialist / lisa:learning-judge / lisa:learnings-synthesizer / lisa:skill-evaluator - Factory-measurement and learning-routing agents, not part of this fix.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-only agents.
EXCLUDE - Plan - Plan is small and recorded inline by the lead.
EXCLUDE - claude / claude-code-guide / statusline-setup / web-fetch / hookify:conversation-analyzer / code-simplifier:code-simplifier - Not relevant to this fix.
```

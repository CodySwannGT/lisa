# Roster Decision — CodySwannGT/lisa#4651

Plan: `dependency-human-signoff-config` · Flow: Implement / Improve · Base: `main` (Target Backend Environment: None — config-only; no branch plan required)

```text
INCLUDE - Explore - mandatory read-only research: locate dependency-trust-classes rule, config-resolution table, resolved-config hook, DEPENDENCY_DECISIONS template and their tests.
INCLUDE - lisa:builder - implements the opt-in config key, rule/doc text, resolved-config output, validation and tests via TDD.
INCLUDE - lisa:quality-specialist - independent review of correctness, coverage and parity of the change.
INCLUDE - lisa:verification-specialist - independent empirical proof (resolved-config output in a scratch consumer) and verdict authorship.
INCLUDE - lisa:learner - captures task MLD learnings to the ledger.
EXCLUDE - claude - catch-all; specific specialists cover every role.
EXCLUDE - general-purpose - fallback only; specific specialists fit every task.
EXCLUDE - claude-code-guide - no Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - small additive change; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - not analysing transcripts.
EXCLUDE - Plan - change is small and fully specified in the ticket's Technical Approach.
EXCLUDE - lisa:architecture-specialist - no architectural decisions; ticket prescribes the design.
EXCLUDE - lisa:bug-fixer - not a bug.
EXCLUDE - lisa:confluence-prd-intake - no Confluence intake.
EXCLUDE - lisa:debug-specialist - no defect to diagnose.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the little history needed.
EXCLUDE - lisa:github-agent - lead + resolver already own tracker lifecycle.
EXCLUDE - lisa:github-build-intake - not running an intake cycle.
EXCLUDE - lisa:github-prd-intake - not a PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not a PRD.
EXCLUDE - lisa:notion-prd-intake - not a PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing UX flow; ACs already Gherkin.
EXCLUDE - lisa:security-specialist - no auth/secrets/input surface beyond an enum config value.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four ACs directly against the ticket.
EXCLUDE - lisa:test-specialist - builder owns TDD for a small change.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public web pages needed.
```

Tool access preflight: required tools = `gh` (GitHub tracker/PR), `bun` (tests). No external system beyond GitHub. Probe: `gh issue view 4651 --repo CodySwannGT/lisa` passed (resolver live read); bun probed by builder.

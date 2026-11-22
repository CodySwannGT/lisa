# Roster Decision — CodySwannGT/lisa#4678

Plan: `4678-third-party-check-redispatch`. Work type: Implement / Build (CI workflow + script extension).
Base branch: `main` (Target Backend Environment `Assumption: production — remote default branch main`; Branch Plan on the ticket matches current config — Match arm).

```text
INCLUDE - Explore - mandatory read-only research of the #4607 workflow, script, tests and review-evidence.yml prior art.
INCLUDE - lisa:builder - implements the acceptance criteria via TDD (fixtures, script --head-sha mode, workflow triggers).
INCLUDE - lisa:security-specialist - check_run/status triggers on a default-branch workflow are a pwn-request surface; review env-only data flow and permissions.
INCLUDE - lisa:quality-specialist - post-implementation correctness and test-quality review.
INCLUDE - lisa:verification-specialist - independent empirical proof (dry-run CLI output) and the v2 verdict.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
EXCLUDE - general-purpose - every role is covered by a more specific specialist.
EXCLUDE - claude - catch-all; specific specialists cover the work.
EXCLUDE - Plan - architecture is fully prescribed by the ticket's Technical Approach.
EXCLUDE - lisa:architecture-specialist - design is prescribed in the ticket; no open architectural decision.
EXCLUDE - lisa:test-specialist - builder runs TDD and the ticket enumerates the exact fixture matrix; quality-specialist reviews tests.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
INCLUDE - lisa:debug-specialist - pre-push test-integration gate failed (23 tests in files the diff does not touch); root-cause whether pre-existing or caused by this branch.
EXCLUDE - lisa:product-specialist - no user-facing UI; operator behaviour is fully specified in Gherkin.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the four scenarios directly against the ticket.
EXCLUDE - lisa:performance-specialist - event-filter workflow; no performance surface.
EXCLUDE - lisa:eval-specialist - measures the factory, not this change.
EXCLUDE - lisa:git-history-analyzer - Explore covers the #4607 history needed.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - promotion/debrief lanes, not task capture.
EXCLUDE - lisa:tracker-mining-specialist / lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle is run by this lead; input already resolved.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake (github, jira, linear, notion, confluence) - intake loops, not implementation.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist covers simplification for a small diff.
EXCLUDE - hookify:conversation-analyzer - not a hook-authoring task.
EXCLUDE - claude-code-guide / statusline-setup - unrelated to this work.
```

## Tool access preflight

| Tool | Probe | Status |
|---|---|---|
| GitHub (`gh`) issues/PRs/rulesets | `gh api repos/CodySwannGT/lisa/rules/branches/main` (read) | pass (resolver read issue; probe re-run by builder) |
| GitHub Actions (post-merge dry-run) | `gh workflow list --repo CodySwannGT/lisa` | pass expected; probed at verification |
| bun test runner | `bun --version` | pass |

# Roster Decision — CodySwannGT/lisa#4636 (Improve: fs latency probe + packed-host teardown)

INCLUDE - Explore - mandatory read-only research of fs-latency-budget, shared-runtime-hosts fixtures, and CI workflow routes.
INCLUDE - lisa:architecture-specialist - design the registry-routed tool install and early checkout removal without breaking the byte check.
INCLUDE - lisa:builder - implements the diagnostic, the install/teardown changes, and unit tests via TDD.
INCLUDE - lisa:test-specialist - designs unit coverage for the probe decision and teardown/checkout behaviour.
INCLUDE - lisa:verification-specialist - independent empirical proof on hosted runners and the v2 verdict.
INCLUDE - lisa:quality-specialist - code review of the change.
INCLUDE - lisa:spec-conformance-specialist - checks the four Gherkin scenarios and the Improvement Measurement table against evidence.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - lisa:github-agent - tracker reads/sync/evidence on the GitHub issue (already used as the input-resolver).
INCLUDE - general-purpose - lead-session helper for the plan name, branch base, completion condition and preflight steps the skill assigns to it.
EXCLUDE - claude - catch-all; more specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code/API question involved.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification; small diff.
EXCLUDE - hookify:conversation-analyzer - not authoring hooks.
EXCLUDE - lisa:bug-fixer - Improvement, not a bug fix.
EXCLUDE - lisa:debug-specialist - no defect to root-cause; the measurement is a planned diagnostic.
EXCLUDE - lisa:performance-specialist - the work is test-fixture timing, owned by builder + verification.
EXCLUDE - lisa:product-specialist - no user-facing surface; internal test suite.
EXCLUDE - lisa:security-specialist - no auth/input/secret surface touched.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the PR #4626 history needed.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/learning-routing flows, not this build.
EXCLUDE - lisa:jira-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake - tracker is GitHub and this is a single direct item.
EXCLUDE - Plan - architecture-specialist owns design.
EXCLUDE - statusline-setup, web-fetch - not relevant.

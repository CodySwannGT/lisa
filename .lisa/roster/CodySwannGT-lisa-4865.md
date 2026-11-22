# Roster Decision — CodySwannGT/lisa#4865 (raise @codyswann/lisa self-pin floor to 5.x)

Work type: Build (config-only dependency bump; `runtime_behavior_change = false`, config-only).

INCLUDE - lisa:github-agent - bounded input-resolver: read, claim-verify and bind the GitHub leaf.
INCLUDE - Explore - mandatory read-only research (self-pin script, prior bump precedents #4281/#3766/#2280).
INCLUDE - lisa:builder - performs the bump (package.json + bun.lock) and runs the suites.
INCLUDE - lisa:verification-specialist - independent verdict: check:self-pin current, installed version, CI check green.
INCLUDE - lisa:learner - capture task MLD to the ledger.
EXCLUDE - claude - catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - code-simplifier:code-simplifier - no code authored to simplify.
EXCLUDE - general-purpose - lead handles plan naming/branch/flow determination inline for a 1-point bump; specialists cover the rest.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - no design surface in a version-floor bump.
EXCLUDE - lisa:bug-fixer - Build, not Fix; failing check already cited in the ticket.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - failure cause already proven in the ticket (stale pin).
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - precedent commits cited in the ticket; Explore covers residual lookup.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked via persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - no runtime code path changes.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing flow.
EXCLUDE - lisa:quality-specialist - diff is a version string + lockfile; submit-pr local review covers it.
EXCLUDE - lisa:security-specialist - first-party package; no new third-party surface.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - two Gherkin ACs checked directly by verification-specialist.
EXCLUDE - lisa:test-specialist - no new behavior; existing suites are the regression net.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - Plan - plan is trivial and recorded inline.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - npm registry reachable via CLI.

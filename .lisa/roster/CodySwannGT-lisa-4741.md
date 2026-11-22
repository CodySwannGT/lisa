# Roster Decision — CodySwannGT/lisa#4741

Plan: npm-updater-additional-dirs-and-trackers

INCLUDE - Explore - mandatory read-only research of npm-update-policy/contract, tests, and git history.
INCLUDE - lisa:builder - implements the feature via TDD (Build flow).
INCLUDE - lisa:test-specialist - test matrix for directories/tracker policy edges.
INCLUDE - lisa:quality-specialist - independent code-quality review of the diff.
INCLUDE - lisa:verification-specialist - independent empirical verification and verdict authoring.
INCLUDE - lisa:learner - captures task MLD into the learnings ledger.
INCLUDE - general-purpose - lead-session helper for plan naming/branch/flow determination per skill text.
INCLUDE - lisa:architecture-specialist - (updated after research) directory identity threads through the signed allocate/gate/publish pipeline (~15 modules + generated manifests); needs a design before build.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:product-specialist - no user-facing UI flow; config/CLI behavior only.
EXCLUDE - lisa:security-specialist - no auth/secret/input-trust surface changes.
EXCLUDE - lisa:performance-specialist - no performance-sensitive path.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the short AC list.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers history for two files.
EXCLUDE - lisa:github-agent - tracker lifecycle handled by lead skills.
EXCLUDE - lisa:confluence/github/linear/notion-prd-intake, lisa:github/jira/linear-build-intake, lisa:jira-agent, lisa:linear-agent - not intake work or other trackers.
EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief/gardener-only roles.
EXCLUDE - Plan - builder plans within TDD scope.
EXCLUDE - claude, claude-code-guide, code-simplifier:code-simplifier, hookify:conversation-analyzer, statusline-setup, web-fetch - not relevant.

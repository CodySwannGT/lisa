# Roster Decision — CodySwannGT/lisa#4653

Work type: Fix (Bug). Arm gate in `lisa-drive-pr-to-merge` never engages on
hosts without `.github/required-checks.json` (Rails), even when
`.lisa.config.json` declares a reviewer gate.

INCLUDE - lisa:github-agent - bounded input-resolver: read the issue, its graph and comments.
INCLUDE - lisa:verification-specialist - independent verifier of the red/green arm-decision proof and the scratch-host CLI run.
INCLUDE - lisa:quality-specialist - reviews the prover change and skill prose for correctness and coding-philosophy fit.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - Explore - read-only search; covered inline by the lead because every target file is named in the issue body with line numbers.
EXCLUDE - general-purpose - every role here has a more specific specialist.
EXCLUDE - claude - catch-all; not needed.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - the change is a small pure function; quality-specialist covers it.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - the issue's Technical Approach already fixes the design (prover path, no Rails workflow seed).
EXCLUDE - lisa:bug-fixer - lead implements the narrow TDD fix directly; the reproduction is a unit-level arm-decision test.
EXCLUDE - lisa:builder - not a feature build.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - root cause is already proven in the issue with file/line evidence.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - history already searched in the issue's Relationship Search.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not a PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by the learner only when a candidate is persisted.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no Notion.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no UI or user flow; acceptance criteria are already Gherkin.
EXCLUDE - lisa:security-specialist - no auth, secrets or input-handling surface beyond reading a local JSON report.
EXCLUDE - lisa:skill-evaluator - debrief/gardener routing only.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly.
EXCLUDE - lisa:test-specialist - test matrix is fully specified by the issue (rate-limited / reviewed / substituted on a Rails-shaped host).
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - Plan - design is fixed by the issue.
EXCLUDE - statusline-setup - unrelated.

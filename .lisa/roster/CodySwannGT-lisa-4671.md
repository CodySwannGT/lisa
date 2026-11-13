# Roster Decision — CodySwannGT/lisa#4671

Work type: Implement / Build (CI workflow input). Single-repo, workflow-only change.

INCLUDE - Explore - mandatory read-only research of quality-rails.yml, its tests, templates, and #4121 history.
INCLUDE - lisa:builder - implements the `database_image` input via TDD against the workflow's structural tests.
INCLUDE - lisa:verification-specialist - independent empirical verification and verdict authorship (not the implementer).
INCLUDE - lisa:quality-specialist - reviews the diff for correctness and consistency with existing inputs.
INCLUDE - lisa:learner - captures task MLD to the ledger.
EXCLUDE - general-purpose - specific specialists cover every task; the lead does the lead-session planning steps.
EXCLUDE - claude - catch-all; specific specialists fit.
EXCLUDE - claude-code-guide - no Claude Code product questions involved.
EXCLUDE - code-simplifier:code-simplifier - additive YAML change; quality-specialist covers simplicity.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - a single additive input following the existing `database_version` pattern; no design decision.
EXCLUDE - lisa:bug-fixer - Build, not Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the #4121 history.
EXCLUDE - lisa:github-agent - served as the input-resolver; the lifecycle runs in the lead.
EXCLUDE - lisa:github-build-intake - single item, not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only when a candidate exists.
EXCLUDE - lisa:learnings-synthesizer - debrief only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - no PRD.
EXCLUDE - lisa:performance-specialist - no runtime performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief only.
EXCLUDE - lisa:product-specialist - no user-visible UX; an input on a reusable workflow.
EXCLUDE - lisa:security-specialist - callers already control the image tag; no new trust boundary. Quality review covers expression-injection.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist covers the AC matrix for this small item.
EXCLUDE - lisa:test-specialist - builder writes the tests; the strategy is trivial.
EXCLUDE - lisa:tracker-mining-specialist - debrief only.
EXCLUDE - Plan - the plan is trivial and recorded here.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no external pages needed.

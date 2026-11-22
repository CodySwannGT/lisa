# Roster Decision — CodySwannGT/lisa#4675

Work type: Improve (CI workflow restructure, config-only, no runtime behavior change).

INCLUDE - lisa:github-agent - already used as the bounded input-resolver (read, claim, bind).
INCLUDE - Explore - mandatory read-only research: locate the six named-spec steps, any template mirrors, and every test pinning them.
INCLUDE - lisa:builder - implements the workflow move, required-checks entry, and test updates via TDD.
INCLUDE - lisa:quality-specialist - independent review of the workflow/test change, incl. coverage-step placement constraint.
INCLUDE - lisa:verification-specialist - independent verdict: runs the real tests and reads the PR's CI to prove the steps ran in the new job.
INCLUDE - lisa:learner - captures task MLD to the ledger.
INCLUDE - general-purpose - lead-session helper slots named by the skill (plan name, branch resolution).
EXCLUDE - claude - generic catch-all; specific specialists cover every need.
EXCLUDE - claude-code-guide - no Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - YAML move, nothing to simplify.
EXCLUDE - hookify:conversation-analyzer - no hook authoring.
EXCLUDE - lisa:architecture-specialist - design fully prescribed by the ticket's Technical Approach.
EXCLUDE - lisa:bug-fixer - not a Fix.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:github-prd-intake - no PRD intake.
EXCLUDE - lisa:linear-prd-intake - no PRD intake.
EXCLUDE - lisa:notion-prd-intake - no PRD intake.
EXCLUDE - lisa:debug-specialist - no defect to root-cause.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history (#4622 mechanism).
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:jira-build-intake - not an intake cycle.
EXCLUDE - lisa:linear-build-intake - not an intake cycle.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:learning-judge - no promotion step; learner handles capture.
EXCLUDE - lisa:learnings-synthesizer - debrief-only.
EXCLUDE - lisa:skill-evaluator - no routing of learnings.
EXCLUDE - lisa:performance-specialist - CI timing measured directly from run JSON; no code perf analysis.
EXCLUDE - lisa:pr-mining-specialist - debrief-only.
EXCLUDE - lisa:tracker-mining-specialist - debrief-only.
EXCLUDE - lisa:product-specialist - no user-facing surface.
EXCLUDE - lisa:security-specialist - no auth/secret surface changes (new job keeps existing permissions).
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios; scope is small.
EXCLUDE - lisa:test-specialist - test change is a structural assertion update, owned by builder.
EXCLUDE - Plan - plan prescribed in ticket.
EXCLUDE - statusline-setup - irrelevant.

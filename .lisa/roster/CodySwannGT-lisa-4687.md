# Roster Decision — CodySwannGT/lisa#4687

Work type: Improve (policy/wording sweep across Lisa-managed rules, skills, hooks, starter templates; optional config switch).
Base branch: main (Target Backend Environment: production via `deploy.branches`, Assumption — remote default branch main).

INCLUDE - Explore - mandatory read-only research: locate every human-reservation phrase across the named files and their template/plugin copies.
INCLUDE - lisa:builder - performs the wording/policy edits and test updates via TDD where tests pin the text.
INCLUDE - lisa:quality-specialist - reviews the diff for correctness, consistency, and that the remaining human gates name the missing access.
INCLUDE - lisa:verification-specialist - independent verifier; runs the generated-artifact sync, tests, and the grep proof, writes the verdict.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger.
INCLUDE - general-purpose - lead-session helper for plan naming, branch/env resolution, and completion-condition drafting, as the skill prescribes.
EXCLUDE - claude - generic catch-all; general-purpose already covers the lead-session helper role.
EXCLUDE - claude-code-guide - no Claude Code product question is involved.
EXCLUDE - code-simplifier:code-simplifier - prose edits; no code to simplify.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts for hooks.
EXCLUDE - lisa:architecture-specialist - no architectural design; a text policy sweep with an optional config key whose shape follows existing config-resolution patterns.
EXCLUDE - lisa:bug-fixer - not a Fix; nothing to reproduce.
EXCLUDE - lisa:confluence-prd-intake - not PRD intake.
EXCLUDE - lisa:debug-specialist - no defect cause to prove.
EXCLUDE - lisa:eval-specialist - not measuring factory capability.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history context (#4657/#4658/#4661) that's needed.
EXCLUDE - lisa:github-agent - used as the input-resolver; the lifecycle is run by this lead.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - not PRD intake.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only through persist-learning if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - not PRD intake.
EXCLUDE - lisa:notion-prd-intake - not PRD intake.
EXCLUDE - lisa:performance-specialist - no runtime performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:product-specialist - no user flow/UI; the operator-facing outcome is covered by quality and spec review.
EXCLUDE - lisa:security-specialist - the remaining human gates (credentials, secret stores, money, signatures) are kept, not loosened; quality review checks that they stay.
EXCLUDE - lisa:skill-evaluator - not routing learnings.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist runs the AC coverage matrix for this small doc change.
EXCLUDE - lisa:test-specialist - test updates are limited to pinned-text assertions the builder owns.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - Plan - the plan is derived from the Explore inventory; no separate architect needed.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public web page needed.

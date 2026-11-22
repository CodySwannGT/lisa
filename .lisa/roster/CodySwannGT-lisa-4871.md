# Roster Decision — CodySwannGT/lisa#4871

Work type: Fix (bug) — npm 10.9.9 install of @codyswann/lisa crashes with `edgesOut`.

INCLUDE - Explore - mandatory read-only research of manifests, peer deps and git history.
INCLUDE - lisa:debug-specialist - reproduce the npm 10 crash and bisect the offending peer edge by execution.
INCLUDE - lisa:bug-fixer - fix the published manifest and add the regression install check via TDD.
INCLUDE - lisa:verification-specialist - independent empirical verification (packed tarball install under npm 10.9.9 and 11.6.2) and verdict.
INCLUDE - lisa:quality-specialist - review of the manifest change and regression check.
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
INCLUDE - general-purpose - team-lead bookkeeping steps the skill assigns to it (plan name, base branch, completion condition, access preflight).
EXCLUDE - claude - catch-all; general-purpose covers the lead bookkeeping.
EXCLUDE - claude-code-guide - no Claude Code product question.
EXCLUDE - code-simplifier:code-simplifier - manifest/script fix; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - no design change; localized manifest fix.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:confluence-prd-intake - no PRD intake.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the narrow history search.
EXCLUDE - lisa:github-agent - lead runs this flow directly.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - no PRD.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - invoked only via persist-learning when a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - debrief only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - no PRD.
EXCLUDE - lisa:notion-prd-intake - no PRD.
EXCLUDE - lisa:performance-specialist - no performance surface.
EXCLUDE - lisa:pr-mining-specialist - debrief only.
EXCLUDE - lisa:product-specialist - no UI; operator outcome is a successful install, covered by verification.
EXCLUDE - lisa:security-specialist - no auth/secret/input surface; manifest shape only.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks the three Gherkin scenarios directly.
EXCLUDE - lisa:test-specialist - bug-fixer writes the single regression check.
EXCLUDE - lisa:tracker-mining-specialist - debrief only.
EXCLUDE - Plan - lead plans inline; scope is narrow.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no web page needed.

# Roster Decision — CodySwannGT/lisa#4509

Work type: Fix (type:Bug) — scope audit exclusions to package + versions across pre-push hook, CI audit step, doctor allowlist.

INCLUDE - Explore - mandatory read-only research: locate the #4693 shared matcher, pre-push loader, quality.yml audit step, doctor allowlist.
INCLUDE - lisa:architecture-specialist - decide how to reuse #4693's matcher across all four surfaces without a competing filter.
INCLUDE - lisa:bug-fixer - reproduce (zod 4.5.0 hidden by an ID-only exclusion) as a failing test, then fix via TDD.
INCLUDE - lisa:test-specialist - freeze the test matrix from the plan comment (package mismatch, 3.25.76 vs 4.5.0, versions w/o paths, aliases, legacy ID-only, doctor warning).
INCLUDE - lisa:quality-specialist - review correctness and coding-philosophy compliance of the diff.
INCLUDE - lisa:verification-specialist - independent empirical proof (run the hook/doctor against fixtures) and the v2 verdict.
INCLUDE - lisa:spec-conformance-specialist - map all four acceptance criteria to evidence.
INCLUDE - lisa:learner - capture task MLD to the ledger.
INCLUDE - general-purpose - lead-session bookkeeping steps the skill assigns to it (plan name, base branch, completion condition, task creation).
EXCLUDE - lisa:builder - Fix flow; bug-fixer owns implementation.
EXCLUDE - lisa:debug-specialist - root cause is already stated in the issue (ID-only matching); no unknown cause to prove.
EXCLUDE - lisa:security-specialist - change narrows suppression (more findings surface); quality + spec review cover it.
EXCLUDE - lisa:performance-specialist - no performance-sensitive path.
EXCLUDE - lisa:product-specialist - no user-facing UI; operator-facing doctor warning text is reviewed by quality/spec.
EXCLUDE - lisa:git-history-analyzer - Explore covers the #4693 history needed.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:github-agent / github-build-intake / github-prd-intake / jira-* / linear-* / notion-* / confluence-* intake and lifecycle agents - lifecycle is run by this lead; tracker is GitHub and handled via tracker skills.
EXCLUDE - lisa:learning-judge / skill-evaluator / learnings-synthesizer / tracker-mining-specialist / pr-mining-specialist - debrief/gardener flows, not implementation.
EXCLUDE - Plan - architecture-specialist covers planning.
EXCLUDE - claude / claude-code-guide / code-simplifier:code-simplifier / hookify:conversation-analyzer / statusline-setup / web-fetch - not relevant to this change.

# Roster Decision — CodySwannGT/lisa#4643

Plan: fix-4643-skill-text-defects. Work type: Fix (type:Bug). Scope: 11 defects in skills, an agent file and a script. Items 1–6 come from the body; items 7–11 come from the author's 2026-11-03 comment.

INCLUDE - Explore - Required read-only research. Finds every cited line, text-contract test and generated copy before any fix starts.
INCLUDE - lisa:bug-fixer - Reproduces each defect as a failing text-contract or unit test, then fixes it test-first. Three run in parallel, each owning its own files.
INCLUDE - lisa:quality-specialist - Reviews the combined diff for correctness and contract consistency before the PR.
INCLUDE - lisa:verification-specialist - Independent verifier. Runs the red/green evidence and the review-body journey, and writes the v2 verdict.
INCLUDE - lisa:learner - Records task learnings in the ledger after implementation.
INCLUDE - general-purpose - Used only for the lead-session plan and branch steps the skill assigns it. No more specific agent covers that orchestration work.
EXCLUDE - claude - Catch-all; specific specialists cover every role.
EXCLUDE - claude-code-guide - No Claude Code product questions.
EXCLUDE - Plan - The issue's Technical Approach already prescribes the fixes.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.
EXCLUDE - code-simplifier:code-simplifier - The changes are prose plus small script edits; quality-specialist covers clarity.
EXCLUDE - hookify:conversation-analyzer - No hooks are being written.
EXCLUDE - lisa:architecture-specialist - No architectural change; each fix is local.
EXCLUDE - lisa:builder - This is a Fix flow; bug-fixer is the matching specialist.
EXCLUDE - lisa:debug-specialist - The issue already cites each defect's cause by line.
EXCLUDE - lisa:test-specialist - The bug-fixers write the reproduction tests, and quality-specialist reviews them.
EXCLUDE - lisa:product-specialist - No product UI changes; the edits are skill text that agents read.
EXCLUDE - lisa:security-specialist - No change to auth, secrets handling or input trust. The secrets item (12) is out of scope and tracked in #4579.
EXCLUDE - lisa:performance-specialist - Nothing performance-sensitive changes.
EXCLUDE - lisa:spec-conformance-specialist - For a text-contract fix, verification-specialist plus the per-criterion test matrix cover conformance.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history needed (#4574 for item 9).
EXCLUDE - lisa:learning-judge - Invoked inside lisa-persist-learning when needed, not as a teammate.
EXCLUDE - lisa:skill-evaluator - No learnings need routing.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - lisa:github-agent - Already used as the bounded input-resolver; the lead drives the lifecycle.
EXCLUDE - lisa:jira-agent - The tracker is GitHub.
EXCLUDE - lisa:linear-agent - The tracker is GitHub.
EXCLUDE - lisa:github-build-intake - Not an intake cycle.
EXCLUDE - lisa:jira-build-intake - Not an intake cycle.
EXCLUDE - lisa:linear-build-intake - Not an intake cycle.
EXCLUDE - lisa:github-prd-intake - No PRD involved.
EXCLUDE - lisa:notion-prd-intake - No PRD involved.
EXCLUDE - lisa:confluence-prd-intake - No PRD involved.
EXCLUDE - lisa:linear-prd-intake - No PRD involved.

## Plan facts
- Base branch: main. The Target Backend Environment is "Assumption: production — remote default branch main", and deploy.branches maps production=main. The Branch Plan (from main, PR into main) matches this.
- Feature branch: claude/4643-skill-text-defects, bound to CodySwannGT/lisa#4643.
- Tool access: gh (GitHub API, issue + PR read/write) is proven by the resolver's live read and claim. Nothing else external is needed. maestro is not required: no mobile surface.
- Regression harness: the text-contract unit tests under tests/unit/strategies/ (vitest/bun). There is no browser or e2e surface, because the change is skill text and a CLI script.
- Completion condition: every AC scenario (1–6, plus items 7–11) has a test that fails on main and passes on the branch. `bun run build:plugins && bun run check:artifacts` passes. A real run of lisa-pull-request-review on a scratch PR counts a finding that appears only in a review body. The PR is merged to main with every required check green, and the release workflow runs for the merge SHA.

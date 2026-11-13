# Roster Decision — CodySwannGT/lisa#4700

Flow: Implement / Fix (bug). Validator blind spots in `scripts/lib/completion-proof-content.mjs`.

INCLUDE - Explore - Mandatory read-only research: locate the validator, its tests, and the sibling marker-parsing fixes (#4670, #4689).
INCLUDE - lisa:bug-fixer - Fix flow: reproduces both defects as failing tests, then fixes via TDD.
INCLUDE - lisa:quality-specialist - Independent review of the diff for correctness and test quality.
INCLUDE - lisa:verification-specialist - Independent verifier that runs the validator on real inputs and writes the verdict.
INCLUDE - lisa:learner - Captures task learnings to the ledger, as the flow requires.
EXCLUDE - general-purpose - Specific specialists cover every role; the lead does planning steps inline.
EXCLUDE - claude - Catch-all; specific specialists fit.
EXCLUDE - claude-code-guide - No Claude Code/API product questions involved.
EXCLUDE - code-simplifier:code-simplifier - A two-regex fix; quality-specialist covers simplification.
EXCLUDE - hookify:conversation-analyzer - Not analysing transcripts for hooks.
EXCLUDE - Plan - Scope is two localized regex changes; no architecture plan needed.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages needed.
EXCLUDE - lisa:architecture-specialist - No design or cross-module change.
EXCLUDE - lisa:debug-specialist - The defects and their cause are already named in the issue; bug-fixer reproduces them.
EXCLUDE - lisa:test-specialist - bug-fixer writes the regression tests; quality-specialist reviews them.
EXCLUDE - lisa:security-specialist - No auth, input-trust, or secrets surface changes.
EXCLUDE - lisa:performance-specialist - No performance-sensitive path.
EXCLUDE - lisa:product-specialist - No user-facing UI or flow.
EXCLUDE - lisa:spec-conformance-specialist - Small spec (two expected behaviours); verification-specialist checks it.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the history of the sibling fixes.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - Invoked through the learner/persist-learning path only if needed.
EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-only agents.
EXCLUDE - lisa:builder - Fix flow uses bug-fixer.
EXCLUDE - lisa:github-agent - Used only as the input-resolver; the lead drives the lifecycle.
EXCLUDE - lisa:jira-agent / lisa:linear-agent / lisa:*-build-intake / lisa:*-prd-intake - Tracker is GitHub, and this is not an intake cycle.

Target environment: the ticket has no section for it. Assumption: production — remote default branch main (deploy.branches production=main). The change alters validator behaviour shipped in the package, so runtime_behavior_change is true. Base branch: main.
Completion condition: running the validator on an indented `[EVIDENCE: ...]` marker and on a `## Acceptance criteria` heading both behave correctly (the marker is detected, and the heading is scanned or fails loudly), shown by a direct `node` invocation. Unindented markers and `## Acceptance Criteria` headings must keep their existing behaviour.
Tool access: gh (GitHub) — probe `gh issue view 4700` passed through the resolver. No other external tools are needed.

# Roster Decision — CodySwannGT/lisa#4764

Plan: `learnings-audit-destination-checks`. Work type: Fix (validation gap in a shipped skill's ticket-emission contract).

- INCLUDE - Explore - mandatory read-only research: skill sections, existing tests that pin SKILL.md text, parity copies, git history.
- INCLUDE - lisa:builder - implements the contract change in the skill (and any helper/test) via TDD.
- INCLUDE - lisa:quality-specialist - independent review of the diff for correctness and clarity.
- INCLUDE - lisa:verification-specialist - independent verdict; did not implement the change.
- INCLUDE - lisa:learner - captures task MLD to the ledger.
- EXCLUDE - general-purpose - a more specific specialist fits every task.
- EXCLUDE - claude - catch-all; specific specialists cover the work.
- EXCLUDE - Plan - the change is small and fully specified by the issue's four steps.
- EXCLUDE - lisa:architecture-specialist - no cross-module design; one skill contract section.
- EXCLUDE - lisa:bug-fixer - the defect is a missing contract step, not a runtime bug to reproduce; builder fits the AC-driven change.
- EXCLUDE - lisa:debug-specialist - cause is already stated and attributed in the issue.
- EXCLUDE - lisa:test-specialist - builder writes the tests; quality-specialist reviews them.
- EXCLUDE - lisa:product-specialist - no user-facing UI; operator-facing text reviewed by quality-specialist.
- EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks each of the four ACs.
- EXCLUDE - lisa:security-specialist - no auth, secrets, or input-handling surface.
- EXCLUDE - lisa:performance-specialist - no runtime performance surface.
- EXCLUDE - lisa:eval-specialist - not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - Explore covers the needed history.
- EXCLUDE - lisa:skill-evaluator / lisa:learning-judge / lisa:learnings-synthesizer - learning routing, not this build.
- EXCLUDE - lisa:tracker-mining-specialist / lisa:pr-mining-specialist - debrief-only.
- EXCLUDE - lisa:github-agent - already used as input-resolver; tracker writes done by the lead via skills.
- EXCLUDE - lisa:jira-agent / lisa:linear-agent / *-build-intake / *-prd-intake - wrong tracker or intake-only.
- EXCLUDE - code-simplifier:code-simplifier - prose contract change.
- EXCLUDE - hookify:conversation-analyzer / claude-code-guide / statusline-setup / web-fetch - unrelated.

Tool access: `gh` (GitHub tracker, PR) — probed via `gh issue view 4764` (pass). No other external tool needed.

Completion condition: `bun run test` for the learnings-audit contract tests passes with new assertions that the Ticket emission section requires (1) destination existence check with "new" labelling, (2) line pointers dropped or pinned to a default-branch SHA, (3) count reconciliation that refuses to file on mismatch, and (4) Proof recording of those checks; and the generated plugin copies are in sync (`x-plugin-artifact-sync`).

Session-manager side request (RETIRE failure location): out of scope (#4764 is the PROMOTE/DEMOTE destination side) — filed separately and linked.

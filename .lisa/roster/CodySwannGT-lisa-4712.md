# Roster Decision — CodySwannGT/lisa#4712

Plan: raise-systeminformation-floor-4712. Flow: Implement / Fix. Base: main (Assumption: production — remote default branch main; Branch Plan matches).

- INCLUDE - lisa:github-agent - Input resolver: read the GitHub issue, graph, and comments.
- INCLUDE - lisa:bug-fixer - Reproduce (failing strict floors check + test), apply the floor raise TDD-style, regenerate artifacts.
- INCLUDE - lisa:verification-specialist - Independent verdict: runs the strict checker and the pinned test, writes verification-status.json.
- INCLUDE - Explore - Mandatory research seat; the implementing agent did the research (two files, one checker) so no separate spawn was needed.
- EXCLUDE - general-purpose - Specific specialists cover every task.
- EXCLUDE - claude - Catch-all; not needed.
- EXCLUDE - claude-code-guide - No Claude Code product questions.
- EXCLUDE - code-simplifier:code-simplifier - A version-string change has nothing to simplify.
- EXCLUDE - hookify:conversation-analyzer - Not a transcript-analysis task.
- EXCLUDE - lisa:architecture-specialist - No design decision; the ticket prescribes the exact change.
- EXCLUDE - lisa:builder - Fix flow; bug-fixer owns it.
- EXCLUDE - lisa:confluence-prd-intake / lisa:github-prd-intake / lisa:linear-prd-intake / lisa:notion-prd-intake - No PRD intake.
- EXCLUDE - lisa:github-build-intake / lisa:jira-build-intake / lisa:linear-build-intake - Single item already dispatched.
- EXCLUDE - lisa:jira-agent / lisa:linear-agent - Tracker is GitHub.
- EXCLUDE - lisa:debug-specialist - Cause is already proven by the checker output in the ticket.
- EXCLUDE - lisa:eval-specialist - Not measuring the factory.
- EXCLUDE - lisa:git-history-analyzer - Ticket already cites the relevant floor-raise history.
- EXCLUDE - lisa:learner - Learnings captured in task metadata are expected empty for a mechanical floor raise; the learner runs only if non-empty MLD is recorded.
- EXCLUDE - lisa:learning-judge / lisa:learnings-synthesizer / lisa:skill-evaluator - No candidate learnings to judge.
- EXCLUDE - lisa:performance-specialist - No runtime code path.
- EXCLUDE - lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Not a debrief.
- EXCLUDE - lisa:product-specialist - No user-visible UI behaviour; CI/config change.
- EXCLUDE - lisa:quality-specialist - Covered by the submit-pr local review.
- EXCLUDE - lisa:security-specialist - The advisory and patched version are fixed by the GitHub advisory DB, enforced by the checker itself.
- EXCLUDE - lisa:spec-conformance-specialist - Four Gherkin scenarios are mapped directly by the verification-specialist.
- EXCLUDE - lisa:test-specialist - Existing tests only need their asserted floor updated.
- EXCLUDE - Plan - Change is prescribed.
- EXCLUDE - statusline-setup - Unrelated.

Regression harness: no browser/device harness applies (CI/config governance change). Regression coverage is the existing unit assertions in tests/unit/config/security-pin-floors.test.ts and postinstall-ci-guard.test.ts plus the hosted strict-floors CI check.

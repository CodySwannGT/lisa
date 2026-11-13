# Roster Decision — CodySwannGT/lisa#4824

Work type: Fix (bug). Scope: `src/cli/lisa-test-run-ipc.ts` `waitForMessage` exit/ack race plus unit regression tests. No UI, no persistent state.

- INCLUDE - lisa:github-agent - bounded input-resolver: read the issue, its graph, and the cited source.
- INCLUDE - lisa:bug-fixer - reproduces the race as a failing test (red), then fixes it by TDD.
- INCLUDE - lisa:verification-specialist - independent verifier: writes the verdict; the implementer never self-certifies.
- INCLUDE - lisa:learner - captures task MLD into the ledger.
- INCLUDE - Explore - mandatory read-only research; the lead did it inline because the scope is three named files, already read in full.
- EXCLUDE - general-purpose - a more specific specialist covers every task.
- EXCLUDE - claude - catch-all; specific specialists cover the work.
- EXCLUDE - claude-code-guide - no Claude Code product questions.
- EXCLUDE - code-simplifier:code-simplifier - the diff is a few lines; review covers clarity.
- EXCLUDE - hookify:conversation-analyzer - no transcript analysis.
- EXCLUDE - lisa:architecture-specialist - no design change; the issue fixes the approach (settle on close).
- EXCLUDE - lisa:builder - this is a Fix, and the bug-fixer owns it.
- EXCLUDE - lisa:debug-specialist - the root cause is named and is proven by the red test.
- EXCLUDE - lisa:eval-specialist - this does not measure the factory.
- EXCLUDE - lisa:git-history-analyzer - the resolver already listed the file history.
- EXCLUDE - lisa:quality-specialist - submit-pr's local review covers quality.
- EXCLUDE - lisa:test-specialist - the bug-fixer writes the regression tests, and the issue spells out the test design.
- EXCLUDE - lisa:product-specialist - internal CLI with no user flow.
- EXCLUDE - lisa:spec-conformance-specialist - the verifier checks the ACs directly.
- EXCLUDE - lisa:security-specialist - no security surface.
- EXCLUDE - lisa:performance-specialist - no performance surface.
- EXCLUDE - lisa:learning-judge, lisa:skill-evaluator, lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - debrief and learnings-routing agents; this is not a debrief.
- EXCLUDE - lisa:jira-agent, lisa:linear-agent, lisa:*-build-intake, lisa:*-prd-intake - wrong tracker or flow; the tracker is GitHub, and the resolver covered it.
- EXCLUDE - Plan, statusline-setup, web-fetch - not needed.

Harness note: there is no browser or device e2e harness for this surface (an internal CLI IPC helper). The highest practical level is a real child_process IPC integration test, plus the hosted packed-host journey after merge.

# Roster Decision — CodySwannGT/lisa#4719

Plan: fix-jira-accountid-token-scan (Fix flow; bug; Target Backend Environment production → base `main`; Branch Plan matches)

INCLUDE - Explore - mandatory read-only research of validate-config.mjs, its tests and git history.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce as failing tests (RED), then implement the decided fix (GREEN).
INCLUDE - lisa:quality-specialist - independent review of the diff for correctness, credential-scan safety, and test quality.
INCLUDE - lisa:verification-specialist - independent empirical verification and the v2 verdict (implementer may not self-certify).
INCLUDE - lisa:learner - capture task MLD to the learnings ledger.
EXCLUDE - claude - generic catch-all; specific specialists cover every role.
EXCLUDE - general-purpose - fallback only; specific specialists fit and the lead performs branch/env bookkeeping.
EXCLUDE - claude-code-guide - no Claude Code product question involved.
EXCLUDE - code-simplifier:code-simplifier - a few lines in one function; quality-specialist covers simplicity.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - lisa:architecture-specialist - the fix is fully decided in the ticket; no design choice open.
EXCLUDE - lisa:builder - this is a Fix; bug-fixer owns it.
EXCLUDE - lisa:confluence-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:debug-specialist - root cause already proven by the ticket's deterministic reproduction.
EXCLUDE - lisa:eval-specialist - not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Explore covers the small relevant history (#4623 / PR #4715).
EXCLUDE - lisa:github-agent - used only as the bounded input-resolver; lifecycle run by the lead.
EXCLUDE - lisa:github-build-intake - not an intake cycle.
EXCLUDE - lisa:github-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:learning-judge - reached via lisa-persist-learning only if a candidate arises.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:notion-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:performance-specialist - pure regex check; no performance surface.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:product-specialist - no UI/UX surface; ACs are already Gherkin.
EXCLUDE - lisa:security-specialist - quality-specialist is explicitly tasked with the "exemption cannot admit a token" check; scope is one regex.
EXCLUDE - lisa:skill-evaluator - no learning routing needed.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks each AC against the spec.
EXCLUDE - lisa:test-specialist - bug-fixer writes the tests; the ticket prescribes the exact test matrix.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - Plan - plan is prescribed by the ticket.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no web pages needed.

## Tool access preflight
- gh (GitHub CLI, tracker + PR): probe `gh issue view 4719 --repo CodySwannGT/lisa` — pass (resolver read it).
- node/bun local test runner: no external access needed.
No other external system required (pure local function).

## Completion condition
The reproduction one-liner from the ticket prints `[]` for the plain and `id:`-prefixed legacy accountId (both lists),
and exactly one "looks like a bot token" problem without the token text for plain/`id:`/`login:` token in both lists;
`notify.chat` with a `<digits>:<uuid>` value is still refused. Constraint: existing
validate-config-session-manager tests pass unmodified; refusal message text unchanged.

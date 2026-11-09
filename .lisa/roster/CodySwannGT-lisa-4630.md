# Roster Decision — CodySwannGT/lisa#4630

Plan: `4630-evidence-verdict-on-head` · Flow: Implement / Fix (Bug) · Base: `main` (Branch Plan match)

```text
INCLUDE - lisa:github-agent - bounded input-resolver (read, claim reuse, bind) for the GitHub-tracked leaf.
INCLUDE - Explore - mandatory read-only research of the prover, both workflow copies, seed/doctor and their tests.
INCLUDE - lisa:bug-fixer - Fix flow: reproduce each gap as failing tests (RED), then implement the fix (GREEN).
INCLUDE - lisa:verification-specialist - independent verdict; implementer does not self-certify.
INCLUDE - lisa:quality-specialist - review of the diff for correctness and test quality.
INCLUDE - lisa:learner - capture task MLD to the ledger.
EXCLUDE - claude - catch-all; specific specialists cover every task.
EXCLUDE - claude-code-guide - no Claude Code product questions.
EXCLUDE - general-purpose - lead performs the small planning steps; no task lacks a specific specialist.
EXCLUDE - Plan - the ticket's Technical Approach is already a step-by-step plan.
EXCLUDE - statusline-setup - unrelated.
EXCLUDE - web-fetch - no public pages needed; GitHub reads go through gh.
EXCLUDE - lisa:architecture-specialist - design is fully prescribed by the ticket (modelled on review-evidence.yml).
EXCLUDE - lisa:builder - this is a Fix, bug-fixer owns it.
EXCLUDE - lisa:debug-specialist - root cause already proven in the ticket with run ids and line refs.
EXCLUDE - lisa:test-specialist - bug-fixer writes the RED tests named by the ticket.
EXCLUDE - lisa:security-specialist - permission change (checks: read -> write) is reviewed by quality-specialist; no new secret surface.
EXCLUDE - lisa:performance-specialist - pagination of small reads; no perf surface.
EXCLUDE - lisa:product-specialist - no user-visible UI; Gherkin is already written.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist checks each AC against the coverage matrix.
EXCLUDE - lisa:git-history-analyzer - ticket already cites the relevant history (#4553, PR #4625, #4628/PR #4728).
EXCLUDE - lisa:eval-specialist / lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer - factory-measurement and gardener agents; not part of a single Fix.
EXCLUDE - lisa:tracker-mining-specialist / lisa:pr-mining-specialist - Debrief-only.
EXCLUDE - lisa:jira-agent / lisa:linear-agent / *-build-intake / *-prd-intake - wrong tracker or intake-only.
EXCLUDE - code-simplifier:code-simplifier - optional polish; quality-specialist covers.
EXCLUDE - hookify:conversation-analyzer - unrelated.
```

Tool access preflight: `gh` (probe: `gh api repos/CodySwannGT/lisa` — pass, used by resolver). No other external tool.

# Roster Decision — CodySwannGT/lisa#4469

Plan: `4469-aws-bootstrap-gate` — Fix flow (doc/contract bug). Rule text in
`tool-access-gate` contradicts `lisa-secrets-access`; fix is rule prose plus a
contract test that pins the recovery routing. `runtime_behavior_change = false`
(doc-only rule contract + test), so no Branch Plan or deploy-environment
derivation applies; base is `main`.

INCLUDE - lisa:github-agent - Bounded input-resolver; read the issue graph and comments.
INCLUDE - Explore - Mandatory read-only research; done inline by the lead (rule, eager rule, secrets-access skill, existing contract tests) because the surface is three files.
INCLUDE - lisa:verification-specialist - Independent verdict: runs the new contract test, mutation-proves it, writes the v2 verdict.
INCLUDE - lisa:learner - Captures task MLD to the ledger.
EXCLUDE - general-purpose - A specific specialist fits every task.
EXCLUDE - claude - Catch-all; specific specialists cover the work.
EXCLUDE - claude-code-guide - Not a Claude Code usage question.
EXCLUDE - code-simplifier:code-simplifier - Prose change plus one small test; nothing to simplify.
EXCLUDE - hookify:conversation-analyzer - No transcript analysis needed.
EXCLUDE - Plan - Fix is fully specified by the issue's Proposed fix.
EXCLUDE - statusline-setup - Unrelated.
EXCLUDE - web-fetch - No external pages.
EXCLUDE - lisa:architecture-specialist - No architecture change.
EXCLUDE - lisa:bug-fixer - Lead implements the small prose fix directly; reproduction is the RED contract test.
EXCLUDE - lisa:builder - Not a feature build.
EXCLUDE - lisa:debug-specialist - Root cause already cited line-by-line in the issue and confirmed against origin/main.
EXCLUDE - lisa:eval-specialist - Not measuring the factory.
EXCLUDE - lisa:git-history-analyzer - Predecessor (#3481) is named in the issue; no further archaeology needed.
EXCLUDE - lisa:performance-specialist - No runtime code.
EXCLUDE - lisa:product-specialist - No user-facing UI.
EXCLUDE - lisa:quality-specialist - Covered by submit-pr local review.
EXCLUDE - lisa:security-specialist - The change loosens no credential handling; secrets-access keeps its no-print/no-copy rules and account verification.
EXCLUDE - lisa:spec-conformance-specialist - Verification-specialist checks the two Gherkin criteria directly.
EXCLUDE - lisa:test-specialist - One contract test following the existing credential-substrate-precedence pattern.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator / lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief/gardener roles, not this flow.
EXCLUDE - lisa:jira-agent / lisa:linear-agent / lisa:*-build-intake / lisa:*-prd-intake - Wrong tracker or intake roles.

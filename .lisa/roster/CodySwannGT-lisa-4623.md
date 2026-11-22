# Roster Decision — CodySwannGT/lisa#4623

Plan: `4623-operator-id-kinds` — key session-manager operator ids by kind (`login:` / `id:`).
Work type: Fix (labelled `type:Bug`; pure-function matcher, offline fixtures, no UI surface).

```text
INCLUDE - Explore - mandatory read-only research of the matcher, queue, validator, and their tests before implementation.
INCLUDE - lisa:bug-fixer - Fix flow owner: writes the five Gherkin cases as failing tests (Reproduce) then implements the shared kind parser via TDD.
INCLUDE - lisa:verification-specialist - independent verifier; runs the CLI/validator against a plain all-digit config and writes the v2 verdict.
INCLUDE - lisa:quality-specialist - reviews correctness and coding-philosophy compliance of the new shared module and validator changes.
INCLUDE - lisa:learner - captures task MLD to the learnings ledger per the flow contract.
INCLUDE - general-purpose - lead-session bookkeeping (plan name, branch sync, completion condition) where no specialist fits.
EXCLUDE - claude - catch-all; general-purpose already covers lead bookkeeping.
EXCLUDE - claude-code-guide - no question about Claude Code/SDK/API features.
EXCLUDE - Plan - the issue's Technical Approach already prescribes the design.
EXCLUDE - lisa:architecture-specialist - design is fixed by the ticket (one shared parsing module, two importers); no open architectural decision.
EXCLUDE - lisa:builder - this is a Fix flow; bug-fixer owns the TDD loop.
EXCLUDE - lisa:debug-specialist - root cause is already proven by the ticket's pure-function repro.
EXCLUDE - lisa:test-specialist - the five test cases are enumerated verbatim in the Gherkin; bug-fixer writes them RED-first.
EXCLUDE - lisa:security-specialist - change narrows identity matching; quality-specialist review covers the trust-boundary reasoning at this size.
EXCLUDE - lisa:performance-specialist - list matching over a handful of config entries; no performance surface.
EXCLUDE - lisa:product-specialist - no user flow or UI; operator-facing text is the validator warning, reviewed by quality-specialist.
EXCLUDE - lisa:spec-conformance-specialist - verification-specialist maps each Gherkin scenario to evidence in the v2 verdict.
EXCLUDE - lisa:eval-specialist - measures the factory itself, not this change.
EXCLUDE - lisa:git-history-analyzer - the ticket already cites the originating PR #4580 and relevant commits.
EXCLUDE - lisa:github-agent - used as the input-resolver; later tracker writes go through skills.
EXCLUDE - lisa:github-build-intake - intake dispatcher, not part of a single-item flow.
EXCLUDE - lisa:github-prd-intake - PRD intake, not applicable.
EXCLUDE - lisa:jira-agent - tracker is GitHub.
EXCLUDE - lisa:jira-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-agent - tracker is GitHub.
EXCLUDE - lisa:linear-build-intake - tracker is GitHub.
EXCLUDE - lisa:linear-prd-intake - tracker is GitHub.
EXCLUDE - lisa:notion-prd-intake - not a PRD flow.
EXCLUDE - lisa:confluence-prd-intake - not a PRD flow.
EXCLUDE - lisa:learning-judge - invoked by persist-learning only if a planning-miss arises.
EXCLUDE - lisa:skill-evaluator - gardener routing, not part of implementation.
EXCLUDE - lisa:learnings-synthesizer - Debrief flow only.
EXCLUDE - lisa:pr-mining-specialist - Debrief flow only.
EXCLUDE - lisa:tracker-mining-specialist - Debrief flow only.
EXCLUDE - code-simplifier:code-simplifier - quality-specialist review covers simplification for a change this size.
EXCLUDE - hookify:conversation-analyzer - not analyzing transcripts.
EXCLUDE - statusline-setup - unrelated.
```

Input resolver: `lisa:github-agent` (claim `reused`, binding verified).
Target environment: `Assumption: production — remote default branch main` → base `main`; Branch Plan matches (branch from `main`, PR into `main`).
Tool access: only `gh` (GitHub tracker/PR) and local `bun`/`node`; the ticket declares no sign-in and offline fixtures.

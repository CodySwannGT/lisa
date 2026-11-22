# Roster Decision — CodySwannGT/lisa#4624

Plan: `4624-answer-onto-item` · Flow: Implement / Fix (bug) · Base: `main` (production via `deploy.branches`, Assumption annotation already on the item; Branch Plan matches).

```text
INCLUDE - general-purpose - Already used as the bounded input-resolver (lisa-track resolve/claim/bind).
INCLUDE - Explore - Mandatory read-only research: maps the session-manager scripts, tests, SKILL.md Clearing/Telegram sections and current line numbers on origin/main.
INCLUDE - lisa:bug-fixer - Owns the Reproduce sub-flow (failing plan-command tests first) and the TDD fix across human-needed.mjs, cli-human.mjs, ledger-questions.mjs, and SKILL.md, plus build:plugins regeneration.
INCLUDE - lisa:verification-specialist - Independent (non-implementer) empirical proof by running the real session-manager CLI against a scratch ledger; writes the v2 verdict.
INCLUDE - lisa:quality-specialist - Post-implementation review of correctness, immutability, and test quality, run in parallel with the other reviewers.
INCLUDE - lisa:security-specialist - The change posts operator-supplied text onto a public tracker; credential refusal and data-not-instructions handling need a security read.
INCLUDE - lisa:spec-conformance-specialist - Six Gherkin scenarios plus explicit Out of Scope; a coverage matrix catches misses and scope creep.
INCLUDE - lisa:learner - Mandatory capture of task MLD into the learnings ledger.
EXCLUDE - lisa:architecture-specialist - The ticket prescribes the design (pure plan beside planMark, exposed like mark-plan); Explore covers file mapping.
EXCLUDE - lisa:builder - This is a Fix; bug-fixer is the matching implementer.
EXCLUDE - lisa:debug-specialist - Root cause is already proven in the ticket with file/line evidence; reproduction test is the bug-fixer's job.
EXCLUDE - lisa:test-specialist - Test cases are enumerated by the Validation Journey; bug-fixer writes them TDD-first and quality-specialist reviews them.
EXCLUDE - lisa:product-specialist - No UI surface; operator-facing comment text is covered by spec-conformance against the ticket's exact wording.
EXCLUDE - lisa:performance-specialist - Pure string planning on a single ledger entry; no performance surface.
EXCLUDE - lisa:git-history-analyzer - The ticket already cites the relevant history (#4580, #4555, #4448); Explore can read more if needed.
EXCLUDE - lisa:eval-specialist - Factory-measurement agent, not relevant to a single fix.
EXCLUDE - lisa:learning-judge - Invoked inside lisa-persist-learning only if a planning-miss signal arises.
EXCLUDE - lisa:skill-evaluator - Advisory routing for learnings; not needed for this fix.
EXCLUDE - lisa:learnings-synthesizer, lisa:pr-mining-specialist, lisa:tracker-mining-specialist - Debrief-flow agents.
EXCLUDE - lisa:github-agent, lisa:jira-agent, lisa:linear-agent - Lifecycle dispatchers; this lead session already runs the lifecycle.
EXCLUDE - lisa:github-build-intake, lisa:jira-build-intake, lisa:linear-build-intake - Intake dispatchers, not needed for one claimed item.
EXCLUDE - lisa:github-prd-intake, lisa:notion-prd-intake, lisa:confluence-prd-intake, lisa:linear-prd-intake - PRD intake, wrong flow.
EXCLUDE - code-simplifier:code-simplifier - Quality-specialist review covers simplification for this small change.
EXCLUDE - Plan - Design is prescribed by the ticket.
EXCLUDE - claude, claude-code-guide, statusline-setup, hookify:conversation-analyzer - Not relevant to the change.
```

## Tool access preflight

| Tool | Probe | Status |
|---|---|---|
| GitHub (gh) — tracker + PR | `gh issue view 4624 --repo CodySwannGT/lisa` (resolver live-read) | pass |
| Node / Bun local runtime | `node scripts/lisa-work-item.mjs current` | pass |

No browser/device harness applies: the surface is a CLI + skill text, not UI. Regression coverage lives in the session-manager unit/integration tests (highest practical observation level for a CLI command).

## Completion condition

`echo "use the v2 endpoint" | node <sm>/session-manager.mjs answer REF` against a scratch ledger whose worker finished FAILED, then the new plan command prints a JSON plan whose comment begins `[lisa-session-manager] The operator answered the question above (by answer,` and contains the answer text; a credential-shaped answer exits non-zero with no comment; an `item`-sourced answer or a live worker yields no comment. Constraint: existing session-manager tests stay green and live-worker / item-answer behaviour is unchanged.

# #4448 research: git history and conventions

## How a new skill lands

- **One commit for each skill:** a single `feat(<area>)` commit carries the source and the regenerated copies together.
- **Source:** `plugins/src/base/skills/<skill>/SKILL.md` (+ `scripts/`) and `plugins/src/base/commands/<ns>/<name>.md`.
- **Generated:** `plugins/lisa{,-agy,-copilot,-cursor,-devin}/...` and `plugins/lisa/.codex-plugin`. Run `bun run build:plugins` and `check:plugins`.
- **Each skill also adds:**
  - an `src/core/upstream-evidence-manifest.ts` entry
  - skill-contract tests (`tests/unit/strategies/*-skill.test.ts`)
  - any logic as pure, tested code (examples: `src/health/drift-tickets.ts`, `plugins/src/base/scripts/design-intake-gate.mjs`)
- **Examples:** #2288 (71ec08f6a1, setup-workstation), #2601 (d54e646251, health-drift-cron loop), 3a9ee739ef (design-intake).
- **Not edited by hand:** CHANGELOG (release bot only) and the wiki.
- **Doctor checks:** `src/cli/doctor-<check>.ts` wired into `src/cli/doctor.ts`, with a manifest entry and a test (777806631c).
- **Config keys:** `src/sync/registry.ts` (107ac666c5, 150fea0184).

## Automation runbook contract

- **Contract:** `plugins/src/base/rules/reference/automation-runbook-contract.md`. There are six outcomes: `nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete`.
- **Loop skill:** must have a `## Run outcome` section that cites the contract, maps the loop's exits to outcomes, records the run through `automation-run-record.mjs` (`.lisa/automations/runs/`), and evaluates retirement before recording.
- **Runbook:** lives at `.lisa/automations/<loop-id>.runbook.md`. The machine-owned header is written by setup-automations.
- **Registration:** in `lisa-setup-automations`, `automation-status-expected-fleet.mjs`, `lisa-automation-status` and `lisa-tear-down-automations`. Health-drift-cron missed the last three.
- **Bash calls:** `${CLAUDE_PLUGIN_ROOT}` is NOT set in an agent's Bash tool (#3517). Never call `node "${CLAUDE_PLUGIN_ROOT}/scripts/..."` from Bash.

## Claim and intake lessons (must not regress)

- **Claiming:** claim through `lisa-tracker-claim`. It assigns `@me` only if unassigned, re-reads to verify, and returns `claimed|reused` (d4fb33eaff, #1786).
- **Assignee filter:** `intake.assignee` only narrows the selection; it never assigns (#689, #691). There is no existing priority/age or mine-first ordering, so R3 is new.
- **Repo scope:** apply repo-scope-split (2ce11f4485): `repo:<current>` label or no repo label.
- **Paging:** page every sweep to completion and print the range (#3529, #4105).
- **Bot labels:** ignore bot-authored lifecycle labels (#2568).
- **States:** resolve states by role through config, never by name or raw id (#3515, #4064).
- **Attempt counters:** don't store them in append-only comments, or recovery re-blocks the item (#3871).
- **Human reversals:** don't retry a transition a human reversed (#3756).
- **Human holds:** only trusted human authors can release a hold (#3805, #3852, dbc9cef31d).

## Review feedback that keeps recurring

- **Parity:** cover Claude, Codex, Cursor, OpenCode, agy, Copilot and Devin. Document gaps rather than dropping behaviour.
- **Fix once:** fix in source and regenerate. Never hand-edit the generated copies.
- **Real interfaces only:** don't invent CLI flags (21259647d6), and verify every documented flag against the code.
- **Honest contracts:** state convergence, not mutual exclusion (023eff9b8).
- **Rules live in code:** put logic in scripts and tests, not prose.
- **No host names:** never name downstream projects.

## Commits and PRs

- **Format:** conventional commits with scopes such as `feat(skills)`, `feat(setup)`, `feat(automations)` and `feat(doctor)`.
- **Trailers:** `Work-Item:` and `Lane-Id:` are injected by `.husky/prepare-commit-msg`.
- **PR body:** sections "For the operator", "What" and "Review story", plus the ticket reference.

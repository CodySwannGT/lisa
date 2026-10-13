# #4448 research: code conventions (Explore)

## Skills and the build
- **Where things go:**
  - Author in `plugins/src/base/skills/<name>/SKILL.md`.
  - Commands go in `plugins/src/base/commands/<ns>/<name>.md`. `setup/x.md` becomes `/lisa:setup:x`, a thin shim modelled on `commands/setup/linear.md`.
- **Build:** `bun run build:plugins` (`scripts/build-plugins.sh`) generates:
  - `plugins/lisa` and `plugins/lisa/.codex-plugin`
  - the stacks
  - the per-agent variants `lisa-cursor`, `lisa-agy`, `lisa-copilot` and `lisa-devin`
  - OpenCode copies skills at install time (`src/opencode/skills-installer.ts:215`).
- **Generated output is committed.** `check:plugins` rebuilds and diffs.
- **Regenerate** `src/core/upstream-evidence-manifest.ts` with `bun run build:upstream-evidence-manifest`.
- **Skill references:** `tests/unit/strategies/agent-skill-layer-contract.test.ts` fails if a skill references a skill that doesn't exist.

## Scripts
- **Skill-local scripts** sit in the skill's `scripts/` and travel to every variant, e.g. `lisa-remote-dispatch/scripts/dispatch.mjs`.
- **Plugin-level scripts** live in `plugins/src/base/scripts/`. Call them as `node "${CLAUDE_PLUGIN_ROOT:-node_modules/@codyswann/lisa/plugins/lisa}/scripts/x.mjs"`, because `CLAUDE_PLUGIN_ROOT` isn't exported to Bash. Use a `./` prefix for `import()`.
- **Host projects never get skill scripts copied in.**
- **Tests** import scripts from `plugins/src/base/...` directly (e.g. `tests/unit/secrets/remote-dispatch-claude-web.test.ts`).

## Config
- **No schema:** there is no TS type or JSON schema for `tracker`, `linear.*` or `deploy.*`.
- **Docs:** `plugins/src/base/rules/reference/config-resolution.md`, with the top-level table at ~272, `intake.assignee` at ~666 and the dispatch mapping table at ~974. Its eager copy `rules/eager/config-resolution.md` is subject to `check:rules-pairing` and `check:eager-rule-budget`.
- **Reading values:** use jq, with local overriding global per key.
- **Lifecycle roles:** `scripts/resolve-lifecycle-role.mjs --role ready --vendor <v> --intent read`.
- **Shape validation:** `lisa-secrets-access/scripts/validate-config.mjs` (`validateAutomations` at ~461) is the model for a `sessionManager` validator. Config holds non-secrets only.

## Tracker dispatch and the Ready queue
- **Dispatchers:** `lisa-tracker-claim` / `lisa-tracker-build-intake` are thin jq dispatchers with fixed error strings.
- **Ordering today, one item per cycle:**
  - **Jira:** `ORDER BY priority DESC, created ASC`.
  - **GitHub:** REST issues filtered by the ready label, with no priority sort.
  - **Linear:** ready first, then oldest, with no priority sort.
- **Assignee:** a filter only (`intake.assignee`). The claim assigns only if unassigned. None of the vendors orders mine first or excludes items assigned to others. **This is new.**
- **Read-only queue listing:** `lisa-queue-status` and `plugins/src/base/scripts/queue-status-build-readers.mjs` (`readGithubBuildQueueSnapshot` at ~64, `compareQueueItemsByCreatedAt`). Tests are in `tests/unit/strategies/queue-status-build-readers.test.ts`.
- **Recommendation:** a pure `plugins/src/base/scripts/ready-queue-order.mjs`, plus vendor readers.

## Repo scope
- **Rules:** `rules/reference/repo-scope-split.md` (claim-time at 84-111) and `leaf-only-lifecycle.md`.
- **Current repo:** `.repo` → `.github.repo` → basename of origin, resolved from the cwd. Claims must run with the cwd in the target child repo.
- **Labels:** an item with no repo label needs `repo:<name>` stamped before the claim.
- **Multi-repo leaves are split, never claimed.**

## Automation contract
- **Contract:** `rules/reference/automation-runbook-contract.md`.
- **Six outcomes** (`AUTOMATION_RUN_OUTCOMES` in `scripts/automation-run-record.mjs`): `nothing-needed | candidate-proposed | change-proved | approval-requested | recovery-required | policy-obsolete`. Build-intake `nothing-needed` needs `--denominator`.
- **Registration:** a scheduled automation named `lisa-auto-<project>-<loop-id>`.
- **Runbook:** `.lisa/automations/<loop-id>.runbook.md` (committed). Runs go to `.lisa/automations/runs/<loop-id>.jsonl` (gitignored).
- **A new loop adds:**
  - setup-automations table rows plus a runbook seed
  - `AUTOMATION_EXPECTED_CADENCES` and `resolveExpectedAutomationFleet` in `automation-status-expected-fleet.mjs` (opt-in)
  - a run-record call each cycle
  - a retirement condition
- **CONFLICT:** the Claude status adapter (`automation-status-claude-adapter.mjs`) only reads `/schedule`, so a tmux-hosted loop needs a probe or an explicit unsupported entry.
- **Tests:** `tests/unit/strategies/automations-skills.test.ts` and `automation-runbook-contract-rule.test.ts`.

## Doctor and health
- **Doctor:** `src/cli/doctor.ts` `runDoctor` (~334), with one `src/cli/doctor-*.ts` per check (the Kane model is config-gated) and tests in `tests/unit/cli/doctor-*.test.ts`. There is also prose in `lisa-doctor/SKILL.md` and helpers in `plugins/src/base/scripts/doctor-report.mjs`.

## lisa-implement arguments
- **Recognised arguments:** `executionEnv=`, then `caller_bundle_path=`. After that `lisa-track` classifies `$ARGUMENTS` as exactly one of ref, file or text.
- **Trailing prose is unsafe:** a ref followed by text is classified as plain text, which leads to search-then-create and a possible duplicate ticket.
- **Fix:** add a `managedBy=<manager>` argument, stripped before `lisa-track`, and update `commands/implement.md` `argument-hint`.

## Telegram, secrets and gitignore
- **Telegram:** the only prior art is OpenClaw (`plugins/src/openclaw/skills/lisa-openclaw-*`): tokens in 0600 files outside the repo, never printed. Nothing in Lisa uses `--channels`, `claude --bg`, `claude agents` or `crossSessionInbound`.
- **Secret prompting:** `lisa-secrets-access/scripts/prompt-secret.mjs` reads from the TTY with echo off.
- **Gitignore:** the template is `all/copy-contents/gitignore`. Add `.lisa/session-manager/`.

## Gates (package.json)
`lint`, `typecheck`, `test` / `test:unit`, `format:check`, `knip:check`, `check:plugins`, `check:artifacts`, `check:rules-pairing`, `check:eager-rule-budget`.

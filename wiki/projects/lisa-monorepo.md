# lisa-monorepo

The Lisa monorepo is the primary ingestion source for this wiki.

## Repository

- Local path: `.`
- Remote: `git@github.com:CodySwannGT/lisa.git`
- Branch at initial ingestion: `fix/audit-exclusions-load-set-e`
- HEAD at initial ingestion: `610f410cb4955734365acdcd1c94e5a74edcbfc0`
- Full fetched commit count across refs: 1814
- Merged PRs captured: 425

## Package

- Package name: `@codyswann/lisa`
- Version at ingestion: `2.16.3`
- CLI binary: `lisa`
- Package manager: Bun

## Current Snapshot

- Ingest branch: `wiki/ingest-20260606T185916Z` created from synced `origin/main`
- HEAD at 2026-06-06 incremental ingest: `53e86533d645512ffeef429e161f81a19174c7a7`
- Current package version: `2.140.0`
- Total commits on HEAD: 2864
- Latest merged PR captured in the incremental git snapshot: `#1154`
- New commits since the previous incremental git cursor: `22`
- Project-scoped memory skipped this cycle because no eligible project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.

## Recent Changes Since The 2026-05-14 Baseline

- PR `#1154` added config-driven sync-down chain derivation from `deploy.order`, introduced `/lisa:sync-down`, and consolidated PR drive-to-merge and review-thread handling into composable plugin skills.
- Release automation advanced the monorepo to `2.140.0`.
- PR `#1153` made `lisa apply` run the canonical instruction-files migration so existing projects converge on canonical agent instruction files.
- Release automation advanced the monorepo to `2.139.0`.
- PRs `#1151` and `#1152` corrected wiki documentation for the rule-free canonical `AGENTS.md` / agy no-baking design.
- Release automation advanced the monorepo to `2.138.2`.
- PR `#1150` made `AGENTS.md` canonical, changed `CLAUDE.md` into a pointer, and added doctor migration support.
- Release automation advanced the monorepo to `2.138.0`.
- PR `#1149` merged the prior wiki ingestion through Lisa `2.137.3`.
- Release automation advanced the monorepo to `2.137.3`.
- PR `#1148` merged the prior wiki ingestion through Lisa `2.137.2`.
- Release automation advanced the monorepo to `2.137.2`.
- PR `#1147` merged the prior wiki ingestion through Lisa `2.137.1`.
- Release automation advanced the monorepo to `2.137.1`.
- PR `#1146` merged the prior wiki ingestion through Lisa `2.137.0`.
- Release automation advanced the monorepo to `2.137.0`.
- PR `#1145` added exploratory-QA action-preconditions / incomplete-end-state coverage and fixed a flaky integration CLI smoke test race.
- Release automation advanced the monorepo to `2.136.0`.
- PR `#1144` changed OpenClaw repo-topic matching so `requireMention` defaults to `false`.
- Release automation advanced the monorepo to `2.135.0`.
- PR `#1143` added exploratory-QA flow-completeness / missing-counterpart coverage.
- PR `#1142` applied the exploratory-QA layout-integrity fix across Expo and Rails templates.
- Release automation advanced the monorepo to `2.134.10`.
- PR `#1141` hardened Harper Fabric exploratory QA to catch clipped or offscreen controls.
- Release automation advanced the monorepo to `2.134.9`.
- PR `#1140` merged the prior wiki ingestion through Lisa `2.134.8`.
- Release automation advanced the monorepo to `2.134.8`.
- PR `#1139` merged the prior wiki ingestion through Lisa `2.134.7`.
- Release automation advanced the monorepo to `2.134.7`.
- PR `#1138` merged the prior wiki ingestion through Lisa `2.134.6`.
- Release automation advanced the monorepo to `2.134.6`.
- PR `#1137` merged the prior wiki ingestion through Lisa `2.134.5`.
- Release automation advanced the monorepo to `2.134.5`.
- PR `#1136` merged the prior wiki ingestion through Lisa `2.134.4`.
- Release automation advanced the monorepo to `2.134.4`.
- PR `#1135` merged the prior wiki ingestion through Lisa `2.134.3`.
- Release automation advanced the monorepo to `2.134.3`.
- PR `#1134` merged the prior wiki ingestion through Lisa `2.134.2`.
- Release automation advanced the monorepo to `2.134.2`.
- PR `#1133` merged the prior wiki ingestion through Lisa `2.134.1`.
- Release automation advanced the monorepo to `2.134.1`.
- PR `#1132` added global command smoke coverage so the built `lisa` binary exercises the command surface after packaging.
- Release automation advanced the monorepo to `2.134.0`.
- PR `#1131` added the global maintenance commands documented in the CLI surface: `doctor`, `version`, and `update`.
- PR `#1130` merged the prior wiki ingestion through Lisa `2.133.3`.
- Release automation advanced the monorepo to `2.133.4`.
- Release automation advanced the monorepo to `2.133.3`.
- PR `#1129` removed advisory-rankings app content from the shared Harper Fabric template so cross-project package.json merges do not pull sibling project state into generated installs.
- Release automation advanced the monorepo to `2.133.2`.
- PR `#1128` kept normal ESLint runs ignoring `wiki/**` and pinned `apollo-link-sentry` to an Apollo Client v3-compatible version for Expo templates.
- Release automation advanced the monorepo to `2.133.1`.
- PR `#1127` prevented `lisa apply` postinstall from corrupting package.json content with cross-project package data.
- Release automation advanced the monorepo to `2.133.0`.
- PR `#1126` added the `setup-project` CLI command and replaced the setup-project command test's starter assertion with a stable expected value.
- Release automation advanced the monorepo to `2.132.7`.
- PR `#1125` made the Expo Jest resolver and React test renderer dependencies compatible across SDK 54 and SDK 56.
- Release automation advanced the monorepo to `2.132.6`.
- PR `#1124` hardened Expo Codex templates for both SDK 54 and SDK 56, preserved `src/` layout projects, and added `.codex/**` to ESLint ignores.
- Release automation advanced the monorepo to `2.132.5`.
- PR `#1123` requires two-way PR ticket links so PR submission is not complete until both the PR and the work item are linked.
- Release automation advanced the monorepo to `2.132.4`.
- PR `#1122` merged the prior wiki ingestion through Lisa `2.132.3`.
- Release automation advanced the monorepo to `2.132.3`.
- PR `#1121` upgraded Lisa to `2.132.2` in the self-update pass.
- Release automation advanced the monorepo to `2.132.2`.
- PR `#1120` fixed block-no-verify hook test flakiness under parallel coverage load.
- Release automation advanced the monorepo to `2.132.1`.
- PR `#1119` merged the prior wiki ingestion through Lisa `2.132.0`.
- Release automation advanced the monorepo to `2.132.0`.
- PR `#1118` blocked hook-bypass vectors including `HUSKY=0` and `core.hooksPath` changes.
- Release automation advanced the monorepo to `2.131.0`.
- PR `#1117` added a non-bypassable `/goal-style` verification gate.
- PR `#1116` documented the Lisa update-projects worktree and PR flow around `.lisa.workspaces.json`.
- Release automation advanced the monorepo to `2.130.7`.
- Release automation advanced the monorepo to `2.130.6`.
- PR `#1114` split `runLisa` into an explicit `apply` subcommand while preserving the positional default.
- Release automation advanced the monorepo to `2.130.5`.
- PR `#1115` merged the prior wiki ingestion through Lisa `2.130.4`.
- Release automation advanced the monorepo to `2.130.4`.
- PR `#1113` merged the prior wiki ingestion through Lisa `2.130.3`.
- Release automation advanced the monorepo to `2.130.3`.
- The automation checkout fetched `origin`, rebased the current wiki branch onto `origin/main` without conflicts, and created `wiki/ingest-20260531T181521Z` from synced `origin/main` before this 2026-05-31 ingest.
- PR `#1112` fixed repair-intake blocker cleanup so `is-blocked-by` dependencies are cleared when any environment-staged work is done, not only production-staged work.
- PR `#1111` documented Atlassian `acli rovodev mcp link create` direction and flags for issue-link access work.
- Release automation advanced the monorepo to `2.130.2`.
- PR `#1110` merged the prior wiki ingestion through Lisa `2.130.1`.
- Release automation advanced the monorepo to `2.130.1`.
- The automation checkout fetched `origin`, rebased the current branch onto `origin/main` without conflicts, and created `wiki/ingest-20260531T1415Z` from synced `origin/main` before this 2026-05-31 ingest.
- PR `#1109` hardened exploratory QA reporting so render-latency findings are flagged when meaningful content appears too late.
- Release automation advanced the monorepo to `2.130.0`.
- PR `#1108` stripped `GIT_INDEX_FILE` from nested git environments so plugin-sync hermetic fixtures run with the intended repository index.
- PR `#1107` preserved Harper schema knip suppression and added the Human Needed marker label for agent-blocked lifecycle work.
- PR `#1106` gated build/repair intake environment transitions on PR merge and auto-rebased stranded PRs.
- PR `#1105` merged the prior wiki ingestion through Lisa `2.129.4`.
- Release automation advanced the monorepo to `2.129.4`.
- PR `#1104` merged the prior wiki ingestion through Lisa `2.129.3`.
- Release automation advanced the monorepo to `2.129.3`.
- PR `#1102` hardened exploratory QA extraction so contextless extracted facts are flagged instead of being promoted as grounded findings.
- PR `#1101` added doctor next-action guidance for plugin drift, making plugin drift readiness failures more operator-actionable.
- PR `#1100` tightened exploratory QA reporting so human-facing jargon is flagged during the human-language pass.
- PR `#1098` exposed plugin sync readiness in doctor output and proved the readiness path remains read-only.
- PR `#1086` merged the prior wiki ingestion through Lisa `2.128.0`.
- PR `#1085` replaced the seven curated-plugin parity placeholder skills with real cross-agent implementations, keeping the approved routing model while making the reimplemented skill surfaces usable.
- PR `#1084` merged the prior wiki ingestion through Lisa `2.127.0`.
- PR `#1083` fixed leaf-only intake semantics so childless Story and Spike issues can be treated as buildable leaves instead of being forced into container-only behavior.
- PR `#1082` implemented all seven approved 3rd-party plugin parity plans, including Sentry MCP re-pointing for Codex, agy, Copilot, and Cursor, `synced-from` pinned placeholder reimplementation skills, and deferred-work documentation for LSP and vendor-equivalent routing.
- PR `#1081` fixed Lisa lifecycle rollups so parent containers advance through intermediate environment states and stranded containers are reconciled instead of remaining inconsistent with child work.
- PR `#1080` hardened plugin parity routing validation to enforce per-agent component coverage, closing the review gap from PR `#1079`.
- PR `#1079` added proposed routing plans for the seven curated plugins, hardened `analyze-plugin` from dogfooding, and committed the routing validator.
- PR `#1078` merged the prior wiki ingestion through Lisa `2.125.0`.
- PR `#1077` introduced the Lisa-internal 3rd-party plugin parity subsystem for classifying curated Claude plugins across Codex, Cursor, agy, and Copilot, using approved routing artifacts, deterministic implementation, and drift detection for reimplemented skills.
- PR `#1076` merged the prior wiki ingestion through Lisa `2.124.11`.
- PR `#1075` merged the earlier wiki ingestion through Lisa `2.124.10`.
- PR `#1074` merged the wiki ingestion through Lisa `2.124.8`.
- PR `#1073` fixed the Copilot plugin variant for issue `#1056`: unsupported `subagentStart` hook entries are stripped so Copilot does not reject the entire inline hook config, bundled `.mcp.json` content is emitted as an inline `mcpServers` object, and the generator now skips invalid or empty `mcpServers` shapes.
- PR `#1072` merged the prior wiki ingestion through Lisa `2.124.7`.
- PR `#1068` merged the prior wiki ingestion through Lisa `2.124.2`.
- PR `#1069` completed the Cursor plugin-shape correction for issue `#1055`, including flat `.mdc` rules, Cursor hook artifact regression coverage, and the dedicated Cursor plugin artifact tests.
- PR `#1070` corrected Cursor hook command paths to use `${CURSOR_PLUGIN_ROOT}` instead of cwd-relative paths.
- PR `#1071` documented the auto-merge ancestry rule used to avoid enabling auto-merge on PRs whose head is no longer based on the current target branch.
- PR `#1067` fixed Codex hook emission so Codex-specific hook metadata lives under `.codex-plugin/`, preventing Claude startup from reading Codex-shaped hook files.
- Agy parity hardening delivered runtime-correct native MCP and hook behavior: agy MCP now installs through the user-global `~/.gemini/config/mcp_config.json` path, plugin-bundled hooks use root-level `hooks.json`, and stale plugin-bundled MCP / subdirectory hook shapes were removed from generated artifacts.
- The agy plugin generator now tolerates missing optional source material and cleanup paths, and the agy hook command resolves against the installed plugin directory name.
- Claude Remote routine readiness work added `/lisa:analyze-claude-remote` and `/lisa:generate-claude-remote-build-script` from `plugins/src/base`, with generated `lisa`, Cursor, agy, and Copilot variants. The audit inventories cloud-session requirements such as CLIs, environment variable names, startup hooks, MCP scope and auth, user-scoped config gaps, and network constraints; the generator writes an idempotent setup script, env-var template, and domain allowlist for Claude Code remote routine environments.
- Coding-agent parity work shipped per-agent plugin variant generation, Codex plugin-bundled hook corrections, Copilot probe cache evidence, and `lisa apply --harness fleet` dispatch fixes.
- The Pattern B fan-out now covers every built Claude plugin, producing cursor, agy, and copilot variants for the base plugin plus stack and standalone plugins.
- Agy rule delivery now resolves rules the same way as `inject-rules.sh`: prefer `rules/eager/`, then fall back to flat `rules/`, leaving only `rules/reference/` on-demand.
- Expo support advanced to SDK 56 and `/src` directory conventions, including Jest, ESLint, prettier, knip, and documentation updates.

## Workspace Packages

| Path | Package |
| --- | --- |
| eslint-plugin-code-organization | @codyswann/eslint-plugin-code-organization |
| eslint-plugin-component-structure | @codyswann/eslint-plugin-component-structure |
| eslint-plugin-ui-standards | @codyswann/eslint-plugin-ui-standards |

## Source Notes

- `wiki/sources/repository/2026-05-14-monorepo-baseline.md`
- `wiki/sources/github/2026-05-14-git-and-pr-history.md`
- `wiki/sources/git/2026-05-25-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-26-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-27-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-28-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-094151-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-133933-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-213947-previous-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-29-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-30-094116-previous-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-2026-05-30-134245.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-2026-05-30-174402.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-20260530T214456Z.md`
- `wiki/sources/git/2026-05-30-lisa-monorepo-git.md`
- `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T101439Z.md`
- `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T141521Z.md`
- `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T181525Z.md`
- `wiki/sources/git/2026-05-31-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T061639Z.md`
- `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T131648Z.md`
- `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T201744Z.md`
- `wiki/sources/git/2026-06-01-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260602T125316Z.md`
- `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260602T195405Z.md`
- `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260603T025542Z.md`
- `wiki/sources/git/2026-06-02-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-03-lisa-monorepo-git-previous-20260603T165711Z.md`
- `wiki/sources/git/2026-06-03-lisa-monorepo-git-previous-20260603T235654Z.md`
- `wiki/sources/git/2026-06-03-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-04-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-05-lisa-monorepo-git-previous-20260605T175810Z.md`
- `wiki/sources/git/2026-06-05-lisa-monorepo-git.md`
- `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T075816Z.md`
- `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T145756Z.md`
- `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T185916Z.md`
- `wiki/sources/git/2026-06-06-lisa-monorepo-git.md`
- `wiki/sources/memory/2026-05-27-memory.md`
- `wiki/sources/memory/2026-05-28-memory.md`
- `wiki/sources/roles/2026-05-25-roles.md`
- `wiki/sources/roles/2026-05-26-roles.md`
- `wiki/sources/roles/2026-05-27-roles.md`
- `wiki/sources/roles/2026-05-28-roles.md`
- `wiki/sources/roles/2026-05-29-094151-roles.md`
- `wiki/sources/roles/2026-05-29-213947-previous-roles.md`
- `wiki/sources/roles/2026-05-29-roles.md`
- `wiki/sources/roles/2026-05-30-roles-previous-2026-05-30-134245.md`
- `wiki/sources/roles/2026-05-30-roles-previous-2026-05-30-174402.md`
- `wiki/sources/roles/2026-05-30-roles-previous-20260530T214456Z.md`
- `wiki/sources/roles/2026-05-30-roles.md`
- `wiki/sources/roles/2026-05-31-roles-previous-20260531T101439Z.md`
- `wiki/sources/roles/2026-05-31-roles-previous-20260531T141521Z.md`
- `wiki/sources/roles/2026-05-31-roles-previous-20260531T181525Z.md`
- `wiki/sources/roles/2026-05-31-roles.md`
- `wiki/sources/roles/2026-06-01-roles-previous-20260601T061639Z.md`
- `wiki/sources/roles/2026-06-01-roles-previous-20260601T131648Z.md`
- `wiki/sources/roles/2026-06-01-roles-previous-20260601T201744Z.md`
- `wiki/sources/roles/2026-06-01-roles.md`
- `wiki/sources/roles/2026-06-02-roles-previous-20260602T125316Z.md`
- `wiki/sources/roles/2026-06-02-roles-previous-20260602T195405Z.md`
- `wiki/sources/roles/2026-06-02-roles-previous-20260603T025542Z.md`
- `wiki/sources/roles/2026-06-02-roles.md`
- `wiki/sources/roles/2026-06-03-roles-previous-20260603T165711Z.md`
- `wiki/sources/roles/2026-06-03-roles-previous-20260603T235654Z.md`
- `wiki/sources/roles/2026-06-03-roles.md`
- `wiki/sources/roles/2026-06-04-roles.md`
- `wiki/sources/roles/2026-06-05-roles-previous-20260605T175810Z.md`
- `wiki/sources/roles/2026-06-05-roles.md`
- `wiki/sources/roles/2026-06-06-roles-previous-20260606T075816Z.md`
- `wiki/sources/roles/2026-06-06-roles-previous-20260606T145756Z.md`
- `wiki/sources/roles/2026-06-06-roles-previous-20260606T185916Z.md`
- `wiki/sources/roles/2026-06-06-roles.md`

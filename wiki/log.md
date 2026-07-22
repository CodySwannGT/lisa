# Lisa Wiki Log

## 2026-07-21 - Dependency-ownership operator walkthrough

- Created `wiki/playbooks/dependency-ownership-operator-guide.md`, the operator-facing walkthrough for the dependency-ownership layer shipped by PRD CodySwannGT/lisa#1741 (stories #1886-#1891).
- Playbook rather than documentation on purpose: the page is a decision procedure an operator walks at the gate ("should I accept this dependency change?"), not a reference surface. The rules themselves remain canonical in `plugins/src/base/rules/reference/`.
- Covers all five surfaces of the layer: the `.lisa/DEPENDENCY_DECISIONS.md` record scaffold and its nine fields, the six trust classes and their ratification triggers, the advisory manifest-authoritative duplicate-pin policy (`scripts/check-duplicate-versions.mjs`), Lisa's own seeded records with every open gap tracked in `#1918`, and the seven-part confidence-rebuild kit for internalizations.
- Documents what is NOT enforced (uniform across all six supported coding agents) and the one representation gap: Antigravity ships no separate rules tree and inherits the same content through the shared mirror; Cursor receives each pair flattened to two `.mdc` rules.
- Provenance: story CodySwannGT/lisa#1891 (§4 operator docs). Asserted by `tests/unit/strategies/dependency-ownership-integration.test.ts`.
- Indexed the new page under `## Playbooks` in `wiki/index.md`.

## 2026-07-19 - Gardener demotion: Console UI knowledge from eager rules to wiki

- Created `wiki/architecture/lisa-console-ui.md` from the two Console-UI sections of `.claude/rules/PROJECT_RULES.md` ("Local `lisa ui` verification" and "Lisa Console UI (`ui/`)"), preserving every fact (entrypoints, `dist/index.js` flattening, `{ sync: false }`, Playwright pipeline boundary, toggle `dispatchEvent`, `esc()`/`el()` semantics).
- Deleted both sections from `.claude/rules/PROJECT_RULES.md` in the same change; the wiki index is now the routing surface for this subsystem knowledge.
- Provenance: gardener ticket CodySwannGT/lisa#1788 (learnings-audit run 2026-07-19, ladder rung WIKI).
- Indexed the new page under `## Architecture` in `wiki/index.md`.

## 2026-06-14 - Incremental connector ingest

- Synced the automation worktree with `origin/main` by fetching `origin` and created `wiki/ingest-20260614T000000Z` from current `origin/main` because the run started on a detached HEAD.
- Ran the enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git` and `roles`; project-scoped memory remained skipped because no eligible project-scoped Claude memory directory exists for this worktree, while global Codex memory remains out of scope.
- No same-day git or roles source notes existed for `2026-06-14`, so no provenance preservation copy was needed before writing the new connector notes.
- Refreshed the `git` source note with 7 new commits through `4bd9a9b749fa26376a5bfdd4d84cb1cb9fb51b93`, advanced the merged-PR cursor to `#1287`, and captured the release line through Lisa `2.165.6`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Updated the monorepo snapshot, template governance, workflow playbook, and index for the prior wiki ingest merge, durable esbuild `GHSA-gv7w-rqvm-qjhr` audit-ignore template exclusion, and release-history changes through `2.165.6`.

## 2026-06-12 - Incremental connector ingest

- Synced the automation worktree with `origin/main` by fetching `origin` and created `wiki/ingest-20260612T000000Z` from current `origin/main` because the run started on a detached HEAD.
- Ran the enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git` and `roles`; `memory` was checked and skipped because no project-scoped Claude memory directory exists for `/Users/codysai/.codex/worktrees/9faa/lisa`, while global Codex memory remains out of scope.
- No same-day git or roles source notes existed for `2026-06-12`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 63 new commits through `f4278cbd2b796440fc943970c2c79cfedce3ca14`, advanced the merged-PR cursor to `#1280`, and captured the release line through Lisa `2.165.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Updated the monorepo snapshot, template governance, workflow playbook, and index for Codex repair-intake exposure, Harper Fabric deploy/realtime and generated-artifact guards, Phaser 4 stack support, bootstrapper and hook hardening, Expo knip ignore metadata, and release-history changes through `2.165.0`.

## 2026-06-10 - Incremental connector ingest

- Synced the automation worktree with `origin/main` by fetching `origin` and created `wiki/ingest-20260610T000000Z` from current `origin/main` because the run started on a detached HEAD.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed for `2026-06-10`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 41 new commits through `6f6c00cb0462cf2f6e6754e80905771bb6712814`, advanced the merged-PR cursor to `#1231`, and captured the release line through Lisa `2.159.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/codysai/.codex/worktrees/dae6/lisa`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for local and remote wiki source path support, generated harness Sonar exclusions, Safety Net push guard parsing hardening, Expo apply filesystem fixes, no-config Playwright aggregate handling, Atlassian access profile/cloud-id repairs, credential-gated verification behavior, and release-history changes through `2.159.3`.

## 2026-06-09 - Incremental connector ingest

- Synced the automation worktree with `origin/main` and created `wiki/ingest-20260609T064744Z` from current `origin/main` because the run started on a detached HEAD.
- Fetched a newer `origin/main` during the run after GitHub reported PR `#1216` merged, rebased the ingestion branch, discarded the stale pre-fetch generated notes, and reran the connectors.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed for `2026-06-09`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 25 new commits through `fa4fc0069307cf650c1cfc7fd498bfedddc69231`, advanced the merged-PR cursor to `#1216`, and captured the release line through Lisa `2.155.6`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/codysai/.codex/worktrees/b484/lisa`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, tracker-mapping validation/repair, automation dirty-tree preflight relaxation, Expo `apollo-link-sentry` pinning, OpenCode lint ignores, sync-down single-branch no-op handling, repair-intake stale-default alignment, exploratory QA human-experience expansion, and release-history changes through `2.155.6`.

## 2026-06-08 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin`, then created `wiki/ingest-20260608T064627Z` from synced `origin/main` because the automation worktree started on a detached HEAD 49 commits behind the default branch.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed for `2026-06-08`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 63 new commits through `a6f7dc06ac56dfd401772e30889edfa66f3beac2`, advanced the merged-PR cursor to `#1208`, and captured the release line through Lisa `2.154.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/codysai/.codex/worktrees/11c7/lisa`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for OpenCode harness support, the fleet `all` alias, stale stack-plugin pruning, repair-intake fixes, Codex variant-plugin discovery exclusion, Expo SDK 56 template alignment, OpenClaw account-scoped Telegram route documentation, and release-history changes through `2.154.0`.

## 2026-06-07 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260607T110501Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-07-lisa-monorepo-git-previous-20260607T110501Z.md` and `wiki/sources/roles/2026-06-07-roles-previous-20260607T110501Z.md` before refreshing the current `2026-06-07` connector notes.
- Refreshed the `git` source note with 4 new commits through `c514070f1d98af24f5a84fe594f6af5d5896d281`, advanced the merged-PR cursor to `#1189`, and captured the release line through Lisa `2.147.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, same-day source-note provenance preservation, and release-history changes through `2.147.2`.

## 2026-06-07 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260607T070304Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-07-lisa-monorepo-git-previous-20260607T070304Z.md` and `wiki/sources/roles/2026-06-07-roles-previous-20260607T070304Z.md` before refreshing the current `2026-06-07` connector notes.
- Refreshed the `git` source note with 3 new commits through `c4a06bddb01ec7df1755df204f3094d9eb6dc8e4`, advanced the merged-PR cursor to `#1188`, and captured the release line through Lisa `2.147.1`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.147.1`.
- Corrected an initial probe invocation of the git connector that ran without `--state`; the over-broad untracked source note was removed before state advancement, and the connector was rerun with `wiki/state/git/latest.json`.

## 2026-06-07 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260607T030131Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed for `2026-06-07`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 21 new commits through `f0344778db527ff4eef004128d1c75761776c03b`, advanced the merged-PR cursor to `#1187`, and captured the release line through Lisa `2.147.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, wiki redaction policy validation hardening, connector source sanitization, `.lisa.config.json` lint ignoring, legacy Safety Net config compatibility, and release-history changes through `2.147.0`.
- Corrected an initial probe invocation of the git and roles connectors that ran without `--state`; the over-broad untracked notes were removed before state advancement, and the connectors were rerun with `wiki/state/git/latest.json` and `wiki/state/roles/latest.json`.

## 2026-06-06 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260606T230012Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T230012Z.md` and `wiki/sources/roles/2026-06-06-roles-previous-20260606T230012Z.md` before refreshing the current `2026-06-06` connector notes.
- Refreshed the `git` source note with 50 new commits through `be05afd1aab2a49cd10f897f4e32341d28212ddc`, advanced the merged-PR cursor to `#1184`, and captured the release line through Lisa `2.145.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for wiki ingestion safety policy, generated wiki output safety gates, `.lisa.config.json` apply guarantees, repair-intake fixes, source-less repo verification posture, Claude Remote credential handling, deploy-failure escalation, and release-history changes through `2.145.0`.

## 2026-06-06 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260606T185916Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T185916Z.md` and `wiki/sources/roles/2026-06-06-roles-previous-20260606T185916Z.md` before refreshing the current `2026-06-06` connector notes.
- Refreshed the `git` source note with 22 new commits through `53e86533d645512ffeef429e161f81a19174c7a7`, advanced the merged-PR cursor to `#1154`, and captured the release line through Lisa `2.140.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for canonical `AGENTS.md`, `lisa apply` instruction-file migration, config-driven sync-down, composable PR drive-to-merge skills, and release-history changes through `2.140.0`.

## 2026-06-06 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260606T145756Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T145756Z.md` and `wiki/sources/roles/2026-06-06-roles-previous-20260606T145756Z.md` before refreshing the current `2026-06-06` connector notes.
- Refreshed the `git` source note with 2 new commits through `c3e576e3bea23b68263849ac907916add59c38b0`, advanced the merged-PR cursor to `#1148`, and kept the captured release line at Lisa `2.137.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and carried-forward release state through `2.137.2`.
- Corrected an initial probe invocation of the git connector that ran without `--state`; the over-broad generated note was removed before state advancement, and the connector was rerun with `wiki/state/git/latest.json`.

## 2026-06-06 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260606T075816Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-06-lisa-monorepo-git-previous-20260606T075816Z.md` and `wiki/sources/roles/2026-06-06-roles-previous-20260606T075816Z.md` before refreshing the current `2026-06-06` connector notes.
- Refreshed the `git` source note with 3 new commits through `e488265b1c6d28b43b8e8b01bb6e3f936b2b4cd8`, advanced the merged-PR cursor to `#1147`, and captured the release line through Lisa `2.137.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.137.2`.

## 2026-06-06 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260606T005758Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed for `2026-06-06`, so no prior source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 3 new commits through `3f3053dc41d14b83eec953386e554d01b79a8428`, advanced the merged-PR cursor to `#1146`, and captured the release line through Lisa `2.137.1`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.137.1`.

## 2026-06-05 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260605T175810Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-05-lisa-monorepo-git-previous-20260605T175810Z.md` and `wiki/sources/roles/2026-06-05-roles-previous-20260605T175810Z.md` before refreshing the current `2026-06-05` connector notes.
- Refreshed the `git` source note with 21 new commits through `53e90ef985d52804d17140a69d7d7f8627e8f8c5`, advanced the merged-PR cursor to `#1145`, and captured the release line through Lisa `2.137.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, exploratory-QA hardening, OpenClaw mention-default change, test race fix, and release-history changes through `2.137.0`.

## 2026-06-05 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260605T105830Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- No same-day git or roles source notes existed, so no prior `2026-06-05` source provenance copy was needed before writing current connector notes.
- Refreshed the `git` source note with 3 new commits through `a13384923008e71d8491199b3829b04e3658a793`, advanced the merged-PR cursor to `#1139`, and captured the release line through Lisa `2.134.8`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.8`.

## 2026-06-04 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260604T135741Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-04-lisa-monorepo-git-previous-20260604T135741Z.md` and `wiki/sources/roles/2026-06-04-roles-previous-20260604T135741Z.md` before refreshing the current `2026-06-04` connector notes.
- Refreshed the `git` source note with 3 new commits through `2d4dce66525b15c2e6462e0505748a29a7f50921`, advanced the merged-PR cursor to `#1138`, and captured the release line through Lisa `2.134.7`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.7`.

## 2026-06-03 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260603T235654Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-03-lisa-monorepo-git-previous-20260603T235654Z.md` and `wiki/sources/roles/2026-06-03-roles-previous-20260603T235654Z.md` before refreshing the current `2026-06-03` connector notes.
- Refreshed the `git` source note with 3 new commits through `dea1ec2f81ae424a1914964f27542fff22412d13`, advanced the merged-PR cursor to `#1136`, and captured the release line through Lisa `2.134.5`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.5`.

## 2026-06-03 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-20260603T165711Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-03-lisa-monorepo-git-previous-20260603T165711Z.md` and `wiki/sources/roles/2026-06-03-roles-previous-20260603T165711Z.md` before refreshing the current `2026-06-03` connector notes.
- Refreshed the `git` source note with 3 new commits through `1637bbcef8c07329dfd37ec1133a85963cfddf0c`, advanced the merged-PR cursor to `#1135`, and captured the release line through Lisa `2.134.4`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.4`.

## 2026-06-02 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260602T195405Z` from the rebased prior ingestion state.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260602T195405Z.md` and `wiki/sources/roles/2026-06-02-roles-previous-20260602T195405Z.md` before refreshing the current `2026-06-02` connector notes.
- Refreshed the `git` source note with 1 new local ingestion commit through `72fc529f33c12e0b2ebcb56027a35b02565a797c`, while the merged-PR cursor remained at `#1133` and the release line remained Lisa `2.134.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the index and connector cursors for the carried-forward prior wiki ingestion provenance/state.

## 2026-06-02 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260602T125316Z` from the synced checkout.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260602T125316Z.md` and `wiki/sources/roles/2026-06-02-roles-previous-20260602T125316Z.md` before refreshing the current `2026-06-02` connector notes.
- Refreshed the `git` source note with 3 new commits through `e3be42fae54c1e68d03ae88dcc3c2d0797485720`, advanced the merged-PR cursor to `#1133`, and captured the release line through Lisa `2.134.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.2`.

## 2026-06-02 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current branch without conflicts, then created `wiki/ingest-20260602T031710Z` from synced `origin/main`.
- Ran the full enabled non-external-write connector set in `wiki/lisa-wiki.config.json`: `git`, `roles`, and `memory`.
- Refreshed the `git` source note with 9 new commits through `1f112ba0a118d76be3e8475edc668e04eb1aa9f5`, advanced the merged-PR cursor to `#1132`, and captured the release line through Lisa `2.134.1`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, the new `doctor` / `version` / `update` maintenance commands, global command smoke coverage, and release-history changes through `2.134.1`.

## 2026-06-01 - CLI command surface documentation update

- Updated README and wiki overview documentation to make the global Lisa CLI command surface primary.
- Documented `setup-project`, `setup-wiki`, `apply`, `doctor`, `version`, `update`, supported starter types, backwards compatibility, and update-check opt-outs.
- Added built-artifact CLI smoke coverage and a CI bin smoke job so `bin.lisa -> dist/index.js` remains executable.

## 2026-05-14 - In-repository wiki setup

- Created the initial Lisa LLM Wiki structure inside the existing monorepo.
- Registered the monorepo itself as the primary project ingestion source.
- Preserved the existing repository and branch model rather than creating a wrapper repository.
- Recorded that `.mcp.json` currently configures Linear MCP only.

## 2026-05-14 - Initial repository and GitHub ingestion

- Ingested the Lisa monorepo working tree, docs, specs, plans, commands, rules, skills, templates, workflows, package metadata, and source structure.
- Captured full fetched commit history across refs and merged PR metadata from GitHub.
- Wrote source notes under `wiki/sources/repository/` and `wiki/sources/github/`.
- Synthesized Lisa architecture, template governance, workflow, requirements, vocabulary, project, and open-question pages.
- Advanced repository and GitHub state under `wiki/state/`.

## 2026-05-14 - Documentation migration and ingestion

- Moved durable root docs, docs workflows, and specs into `wiki/documentation/` so the wiki is the canonical documentation home.
- Preserved `docs/wiki-inbox/` as an ingestion inbox and left operational `plans/` and product/template `plugins/` markdown in place.
- Added documentation provenance under `wiki/sources/docs/` and advanced docs state under `wiki/state/docs/`.

## 2026-05-25 - Full connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25`, and ran a full no-argument ingest against every enabled non-external-write connector that was available.
- Ingested `git` into `wiki/sources/git/2026-05-25-lisa-monorepo-git.md` and `roles` into `wiki/sources/roles/2026-05-25-roles.md`.
- Skipped `memory` because no provably project-scoped memory directory was available for this repository in the current runtime.
- Updated the monorepo snapshot synthesis, refreshed `wiki/index.md`, and initialized incremental connector state under `wiki/state/git/` and `wiki/state/roles/`.

## 2026-05-25 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25-2`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 47 new commits through `362e4bf1248d47e406b19d56f2d3d8b27e7740c9` and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime.
- Updated the monorepo snapshot synthesis for the latest GitHub project-coordination, usage-accounting, intake-filtering, and release-history changes.

## 2026-05-25 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-25-3844`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 65 new commits through `7a56fd065774adb22bcb7ff7857e1d89170f5f75`, advanced the merged-PR cursor to `#789`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because the only Codex memory store available in this runtime was the global `/Users/cody/.codex/memories`, which the project-scoped memory connector correctly refuses to ingest.
- Updated the monorepo snapshot synthesis for the latest council-planning, doctor-surface, GitHub build-intake, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-0130`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 31 new commits through `ea144c8b5ffbc29d5f42f35ec6daa2d3bdcbaaeb`, advanced the merged-PR cursor to `#812`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime; the isolated worktree path had no matching project memory, and global Codex memory remains out of scope.
- Updated the monorepo snapshot synthesis for the latest automation-status delivery, smoke coverage, operator documentation, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-053019`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 36 new commits through `c4879d40b123baf4f38d4c5530090b9003d4217a`, advanced the merged-PR cursor to `#837`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime; the isolated worktree path had no matching project memory, and global Codex memory remains out of scope.
- Updated the monorepo snapshot synthesis for the latest queue-status delivery, repair-intake remediation, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-093056`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 60 new commits through `fd8db85fb79d5ea18628fdf071bbe761885d793f`, advanced the merged-PR cursor to `#905`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because only global Codex memory was available, and the connector refuses non-project-scoped memory.
- Updated the monorepo snapshot synthesis for the latest intake-explain guidance, council and automation-status hardening, usage accounting fixes, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-173027`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 292 new commits through `1d85bcb3acff15cdf89216c81ceb7efe975b1565`, advanced the merged-PR cursor to `#971`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because only global Codex memory was available, and the connector refuses non-project-scoped memory.
- Updated the monorepo snapshot synthesis for the latest wiki status/freshness work, queue and intake automation hardening, CI/GitHub automation fixes, council behavior, usage accounting, and release-history changes.

## 2026-05-26 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-21h32m08s`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 9 new commits through `6e98950d496260faad821f90e5f4f6e2b059c3fb`, advanced the merged-PR cursor to `#992`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime; `CODEX_HOME` was unset and global Codex memory remains out of scope.
- Updated the monorepo snapshot synthesis for the latest plugin-sync marketplace drift fixes, fixture coverage, prior wiki ingest merge, and release-history changes.

## 2026-05-27 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-213256`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
- Refreshed the `git` source note with 7 new commits through `65043e915a23a992904badaf708fd5a849cd54e5`, advanced the merged-PR cursor to `#994`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` again because no provably project-scoped memory directory was available for this repository in the current runtime; the only known Codex memory store is global and remains out of scope.
- Updated the monorepo snapshot synthesis for the prior wiki ingest merge, plugin-sync scratch drift comparison, and release-history changes through `2.106.5`.

## 2026-05-27 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-27-053204`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 3 new commits through `73072b8e5b839dede4bf50985232d1d6bddfe9f4`, advanced the merged-PR cursor to `#995`, and confirmed that `roles` still had no roster pages to ingest.
- Ingested the Lisa project-scoped Claude memory directory into `wiki/sources/memory/2026-05-27-memory.md`; global Codex memory remained out of scope.
- Updated the monorepo snapshot synthesis for the prior wiki ingest merge, release-history changes through `2.106.6`, and newly captured project-scoped memory guidance.

## 2026-05-27 - Incremental connector ingest

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-27-133229`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 6 new commits through `c536c7a196ff811ce92403acd90493baad86ebd0`, advanced the merged-PR cursor to `#997`, and confirmed that `roles` still had no roster pages to ingest.
- Ingested the Lisa project-scoped Claude memory directory into `wiki/sources/memory/2026-05-27-memory.md`; global Codex memory remained out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for durable Codex automation checkouts, release-history changes through `2.106.8`, and the new Codex HTTP MCP plugin-shape memory note.

## 2026-05-27 - Incremental connector ingest

- Synced the durable checkout to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-27-173325`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 44 new commits through `9e52f0d12bc01a85754f30b5ec70c97e6204bfab`, advanced the merged-PR cursor to `#1017`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` because the available Claude memory directory was not provably project-scoped for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for Expo skills, query-first project answers, split exploratory QA coverage, repair-intake blocker diagnosis, ideation run ledgers, nested team orchestration, TypeScript error-suppression blocking, and crash-safe postinstall apply behavior.

## 2026-05-27 - Incremental connector ingest

- Synced the durable checkout to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-27-213503`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 19 new commits through `6dbfeb7ec507cfbb56bc905db47ea14f5bce9762`, advanced the merged-PR cursor to `#1033`, and confirmed that `roles` still had no roster pages to ingest.
- Ingested the Lisa project-scoped Claude memory directory into `wiki/sources/memory/2026-05-27-memory.md`; global Codex memory remained out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for standard wiki staff roster defaults, PRD pressure gating, hook-delivery guidance, and release-history changes through `2.115.3`.

## 2026-05-28 - Incremental connector ingest

- Synced the durable checkout to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-28-013419`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 6 new commits through `3e99859c0c73e29c341c441f2c34976f4fab2806`, advanced the merged-PR cursor to `#1035`, and confirmed that `roles` still had no roster pages to ingest.
- Ingested the Lisa project-scoped Claude memory directory into `wiki/sources/memory/2026-05-28-memory.md`; global Codex memory remained out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for the wiki-as-knowledge-source rule and release-history changes through `2.116.0`.

## 2026-05-28 - Incremental connector ingest

- Synced the durable checkout to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-28-133543`, and ran another full no-argument ingest against every enabled non-external-write connector.
- Refreshed the `git` source note with 17 new commits through `13d703327a00a157f1c9e8d546ec1c30df62c797`, advanced the merged-PR cursor to `#1040`, and confirmed that `roles` still had no roster pages to ingest.
- Skipped `memory` because the available Claude memory directory was not provably project-scoped for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, template-governance notes, workflow playbook, vocabulary, and index for the CLI package-version update check, managed wiki `.gitignore` setup, eager/reference rule split, wiki ESLint ignore behavior, and release-history changes through `2.119.0`.

## 2026-05-28 - Coding-agent parity research ingest

- Ingested the `lisa-coding-agent-parity` research artifact produced on the `worktree-coding-agent-parity` worktree at `/tmp/parity-research.md`. The artifact contains the universal feature catalog (170 features across 12 categories) for Claude Code, Codex, Cursor (`cursor-agent`), Antigravity (`agy`), and GitHub Copilot, plus the per-agent support matrix, plugin-distributability matrix, and Lisa polyfill designs across 16 gap-cell clusters.
- Wrote the source note at `wiki/sources/docs/2026-05-28-coding-agent-parity-research.md` capturing CLI versions probed (`claude` 2.1.156, `codex` 0.125.0, `cursor-agent` 2026.05.28-418efe5, `agy` 1.0.3, `copilot` 1.0.55) and the evidence sources canvassed (web research, CLI self-query, source-read, empirical runtime probes against agy / Cursor / Copilot).
- Synthesized durable knowledge across five new wiki pages: `wiki/concepts/coding-agent-feature-taxonomy.md` describing the 12 feature categories, `wiki/entities/coding-agents.md` profiling the five CLIs including config homes and per-agent quirks, `wiki/playbooks/coding-agent-parity-research.md` for the four-step research protocol, `wiki/architecture/coding-agent-parity.md` for the per-agent installer surface and polyfill strategies, and `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md` recording the choice of build-time per-agent plugin artifacts over runtime detection.
- Captured unresolved items in `wiki/open-questions/coding-agent-parity.md`: Copilot memory file location, agy plugin-hook fire behavior in interactive mode, agy plugin-root env var name, Cursor plugin install cache location, Codex `agy plugin import claude` empty-result root cause, missing per-agent capability memory for Cursor / agy / Copilot, and the stale `reference-codex-hooks-capabilities` entry that predates Codex 0.125.0's expanded event list.
- Notable load-bearing findings recorded as durable knowledge: agy plugin-bundled hooks pass schema validation and install correctly but do NOT fire in `-p` headless mode (verified by run across two probes), agy uses bare `plugin.json` at plugin root rather than namespaced manifest, agy MCP is NOT a plugin component (lives at `~/.gemini/config/mcp_config.json` with `serverUrl` HTTP transport key), Codex 0.125.0 now supports plugin-bundled hooks across ten events including `SubagentStart`, `SubagentStop`, `PreCompact`, and `PostCompact`, Cursor and Copilot both read `.claude-plugin/plugin.json` natively.
- Advanced `wiki/state/docs/coding-agent-parity-2026-05-28.json` to record the ingestion cursor.
- Updated `wiki/index.md` to surface the new architecture page, decision record, research playbook, feature-taxonomy concept page, coding-agents entity page, and open-questions page.

## 2026-05-28 — Coding-agent parity verification follow-up (empirical)

- Empirically verified and corrected the Wave 1/3 Codex + Copilot hook claims (previously `[VERIFIED-DOC]` only). Findings appended to `wiki/architecture/lisa-hook-per-agent-ship-list.md` under "Verified by run — 2026-05-28 follow-up".
- Codex 0.125.0: plugin-bundled hooks fire only after interactive install + `/hooks` trust (no non-interactive bypass exists in 0.125.0). Discovery path is `<plugin-root>/hooks/hooks.json` resolved relative to the plugin root, with `${PLUGIN_ROOT}` in command strings — the first Wave 3b cut wrote `.codex-plugin/hooks.json` with a `./hooks.json` pointer Codex never found, and used cwd-relative `./hooks/` commands; both fixed. Marketplace key is `lisa@lisa` (not the repo-slug forms); detection updated.
- Copilot 1.0.55: does NOT auto-load a plugin's `rules/` dir (so `inject-rules.sh` must ship); aliases `CLAUDE_*` plugin env vars; loads non-`.agent.md` agents via an explicit manifest pointer (rename kept for the unverified marketplace path). Probe cache `scripts/internal-copilot-runtime-probe.json` populated with evidence.
- `lisa apply --harness fleet` end-to-end probe found two dispatch bugs: `processCodexEmit` omitted `"fleet"` (fleet silently skipped Codex), and agy baked rules from the stripped `lisa-agy/rules/eager` (0 rules) instead of the base `lisa/rules/eager` (13 rules). Both fixed; inclusion logic centralized in `harnessIncludesAgent` with regression tests.

## 2026-05-29 — Stack per-agent fan-out + rule-delivery fix

- Closed the parity gap where per-agent variants existed only for the base plugin (PRs #1050, #1052). build-plugins.sh now fans out every built Claude plugin (base + 6 stacks + 2 standalones) to cursor/agy/copilot via the generic generators (27 variant dirs total); all registered in `.claude-plugin/marketplace.json`. `lisa apply` installs the base variant plus `lisa-<detected-type>-<agent>` for each detected stack (existence-filtered). Spec section "Stack fan-out" added to `wiki/architecture/pattern-b-fan-out-spec.md`.
- Fixed an agy-only rule-delivery gap (#1052): the AGENTS.md bake read only `rules/eager/`, dropping legacy flat-layout stack rules (e.g. `lisa-rails/rules/rails-conventions.md`) that inject-rules.sh delivers to Claude/Codex/Copilot via its eager-or-flat fallback and cursor via native rules load. agy's bake (`eagerRuleDirs`) now mirrors that resolution. Verified: a Rails project bakes 14 rules into agy's AGENTS.md (base 13 + rails-conventions) instead of 13. Only `rules/reference/` remains on-demand on all agents.

## 2026-05-29 - Incremental connector ingest

- Resolved the prior local connector-ingest rebase conflict by preserving the 2026-05-28 connector log entry alongside newer wiki parity entries, then ran a full no-argument ingest against every enabled non-external-write connector available in `wiki/lisa-wiki.config.json`.
- Refreshed the `git` source note with 71 new commits through `ecb6a093d767203add54de4d0d703783c80abda0`, advanced the merged-PR cursor to `#1053`, and captured the release line through Lisa `2.123.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because the only available Claude memory directory was scoped to `/Users/cody/workspace/lisa`, not `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, template-governance notes, workflow playbook, vocabulary, and index for per-agent stack variant fan-out, Codex/Copilot hook verification fixes, agy eager-or-flat rule delivery, Expo SDK 56 `/src` support, and release-history changes through `2.123.2`.

## 2026-05-29 - Incremental connector ingest

- Synced the durable checkout with `origin/main`, rebased the current branch without conflicts, created `wiki/ingest-2026-05-29-093858`, and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved the previous same-day git and roles source notes under timestamped filenames before refreshing the current `2026-05-29` connector notes, so the prior ingestion provenance remains available.
- Refreshed the `git` source note with 6 new commits through `a4c5901d607157b097ba4338d4695da5c7ce2902`, advanced the merged-PR cursor to `#1060`, and captured the release line through Lisa `2.124.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for the new Claude Remote routine readiness audit and setup-script generator commands.

## 2026-05-29 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the existing wiki branch without conflicts, then ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved the prior same-day git source note as `wiki/sources/git/2026-05-29-133933-lisa-monorepo-git.md` before refreshing the current `2026-05-29` connector note.
- Refreshed the `git` source note with 9 new commits through `f9999af37312b136cd52edd169564a04d85a7a42`, advanced the merged-PR cursor to `#1066`, and captured the release line through Lisa `2.124.2`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for agy native MCP and root-hook delivery hardening, missing optional artifact handling, installed-plugin hook path resolution, and release-history changes through `2.124.2`.

## 2026-05-29 - Cursor plugin-shape correction (issue #1055)

- Corrected `wiki/architecture/pattern-b-fan-out-spec.md` and `wiki/architecture/lisa-hook-per-agent-ship-list.md` for the Cursor variant: the prior claim that "Cursor auto-loads the `rules/` tree natively" was empirically false (a `cursor-agent` probe with the nested `rules/eager/*.md` layout returned UNKNOWN — no rule applied — identical to shipping no rule; a top-level `.mdc` + `alwaysApply:true` returned the codeword). Evidence in `evidence/cursor-rule-probe-1055.md`.
- Documented the real Cursor-native shape the generator now emits: rules as flat `rules/<name>.mdc` (eager, `alwaysApply:true`) + `rules/<name>-reference.mdc` (reference, `alwaysApply:false` + `description`), 26 total, body cross-links rewritten to the `-reference.mdc` twin; hooks relocated from the manifest to `hooks/hooks.json` (`{version:1,hooks:{<camelCaseEvent>:[{command:"./hooks/…",matcher?}]}}`, flat per-event arrays, relative commands); `.mcp.json` renamed to `mcp.json`; `inject-rules.sh` stays stripped (native `.mdc` is the single rules-once path, not a double-inject collision).
- Noted that plugin-bundled hook FIRING is not verifiable through the `cursor-agent` CLI (only project `.cursor/hooks.json` fires headless); the regression suite asserts file SHAPE only.
- Locked the behavior with `tests/unit/scripts/generate-cursor-plugin-artifacts.test.ts` (fixture-based, MCP + no-MCP variants) and `generate-cursor-plugin-artifacts.artifacts.test.ts` (committed-artifact regression), sharing `cursor-artifact-helpers.ts`.

## 2026-05-29 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the existing wiki branch without conflicts, then created `wiki/ingest-2026-05-29-213947` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-29-213947-previous-lisa-monorepo-git.md` and `wiki/sources/roles/2026-05-29-213947-previous-roles.md` before refreshing the current `2026-05-29` connector notes.
- Refreshed the `git` source note with 18 new commits through `d989e2435dad59c56568e0204241b50a0baa6093`, advanced the merged-PR cursor to `#1071`, and captured the release line through Lisa `2.124.7`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, Codex hook emission isolation under `.codex-plugin/`, Cursor plugin-shape correction, `${CURSOR_PLUGIN_ROOT}` hook commands, auto-merge ancestry documentation, and release-history changes through `2.124.7`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-013939` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Refreshed the `git` source note with 3 new commits through `0f1b1e9a08732b0534d614063d74a82167f3e933`, advanced the merged-PR cursor to `#1072`, and captured the release line through Lisa `2.124.8`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.124.8`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-054030` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-30-054043-previous-lisa-monorepo-git.md` and `wiki/sources/roles/2026-05-30-054043-previous-roles.md` before refreshing the current `2026-05-30` connector notes.
- Refreshed the `git` source note with 8 new commits through `ddd3e4d4476942ea46b491476b134177d54c770c`, advanced the merged-PR cursor to `#1074`, and captured the release line through Lisa `2.124.10`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, Copilot coding-agent notes, Pattern B fan-out spec, hook ship-list, and index for the prior wiki ingest merge, Copilot `subagentStart` hook filtering, inline Copilot `mcpServers`, invalid MCP-shape validation, and release-history changes through `2.124.10`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-094116` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved the prior same-day git source note as `wiki/sources/git/2026-05-30-094116-previous-lisa-monorepo-git.md` before refreshing the current `2026-05-30` connector note.
- Refreshed the `git` source note with 3 new commits through `efa8998a14363f90f139f76a412b964a0b8f4d68`, advanced the merged-PR cursor to `#1075`, and captured the release line through Lisa `2.124.11`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.124.11`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-134237` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-2026-05-30-134245.md` and `wiki/sources/roles/2026-05-30-roles-previous-2026-05-30-134245.md` before refreshing the current `2026-05-30` connector notes.
- Refreshed the `git` source note with 7 new commits through `c162e448b8589392b572843a641147ebddaf2e53`, advanced the merged-PR cursor to `#1077`, and captured the release line through Lisa `2.125.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, coding-agent parity architecture, and index for the 3rd-party plugin parity subsystem, plugin parity drift detection, the prior wiki ingest merge, and release-history changes through `2.125.0`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-174402` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-2026-05-30-174402.md` and `wiki/sources/roles/2026-05-30-roles-previous-2026-05-30-174402.md` before refreshing the current `2026-05-30` connector notes.
- Refreshed the `git` source note with 23 new commits through `efdfd5bc7497986eb47198b12757261020383ad3`, advanced the merged-PR cursor to `#1082`, and captured the release line through Lisa `2.127.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because the only Codex memory path available in this runtime was the global `/Users/cody/.codex/memories`, which the project-scoped memory connector correctly refuses to ingest.
- Updated the monorepo snapshot, coding-agent parity architecture, and index for the all-approved 3rd-party plugin parity implementation pass, Sentry MCP re-pointing, reimplementation placeholder skills, parity routing validator hardening, lifecycle parent rollup repair, the prior wiki ingest merge, and release-history changes through `2.127.0`.

## 2026-06-03 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260603T025542Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-02-lisa-monorepo-git-previous-20260603T025542Z.md` and `wiki/sources/roles/2026-06-02-roles-previous-20260603T025542Z.md` before writing the new connector notes.
- Refreshed the `git` source note with 4 new commits through `6e928436e7d216063d056e894fc3739b244b65a7`, advanced the merged-PR cursor to `#1134`, and captured the release line through Lisa `2.134.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.3`.

## 2026-05-30 - Incremental connector ingest

- Synced the durable checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch without conflicts, then created `wiki/ingest-2026-05-30-174429` and ran another full no-argument ingest against every enabled non-external-write connector in `wiki/lisa-wiki.config.json`.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-30-lisa-monorepo-git-previous-20260530T214456Z.md` and `wiki/sources/roles/2026-05-30-roles-previous-20260530T214456Z.md` before refreshing the current `2026-05-30` connector notes.
- Refreshed the `git` source note with 8 new commits through `2181c4f37f18e30bc65c51ea4685ae7215127ff3`, advanced the merged-PR cursor to `#1085`, and captured the release line through Lisa `2.128.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, coding-agent parity architecture, workflow playbook, and index for real curated-plugin parity reimplementations, childless Story/Spike leaf intake semantics, the prior wiki ingest merge, and release-history changes through `2.128.0`.

## 2026-05-31 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing `build/1064-jira-description-adf` onto `origin/main` without conflicts, then created `wiki/ingest-20260531T014514Z` from synced `origin/main` so the wiki PR would not include the branch's unrelated build commit.
- Refreshed the `git` source note with 18 new commits through `5cc82e48bb2940172a148db34f69b1a46523b41d`, advanced the merged-PR cursor to `#1102`, and captured the release line through Lisa `2.129.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no eligible project-scoped Codex memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot, workflow playbook, vocabulary, and index for plugin sync readiness in doctor output, plugin drift next-action guidance, exploratory QA human-language and contextless-data flags, the prior wiki ingest merge, and release-history changes through `2.129.3`.

## 2026-05-31 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260531T1014Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T101439Z.md` and `wiki/sources/roles/2026-05-31-roles-previous-20260531T101439Z.md` before refreshing the current `2026-05-31` connector notes.
- Refreshed the `git` source note with 3 new commits through `f7cbbc0a28767d84424c73f26774a41074c4d348`, advanced the merged-PR cursor to `#1104`, and captured the release line through Lisa `2.129.4`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.129.4`.

## 2026-05-31 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing `codex/harper-knip-schema-ignore` onto `origin/main` without conflicts, then created `wiki/ingest-20260531T1415Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T141521Z.md` and `wiki/sources/roles/2026-05-31-roles-previous-20260531T141521Z.md` before refreshing the current `2026-05-31` connector notes.
- Refreshed the `git` source note with 49 new commits through `1f0ac58380986b9f2edecc0c039f230f3b2da04d`, advanced the merged-PR cursor to `#1109`, and captured the release line through Lisa `2.130.1`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, exploratory QA render-latency reporting, plugin-sync nested git environment isolation, Harper schema knip suppression, Human Needed lifecycle labeling, build/repair intake merge gating, and release-history changes through `2.130.1`.

## 2026-05-31 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260531T181521Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-05-31-lisa-monorepo-git-previous-20260531T181525Z.md` and `wiki/sources/roles/2026-05-31-roles-previous-20260531T181525Z.md` before refreshing the current `2026-05-31` connector notes.
- Refreshed the `git` source note with 10 new commits through `e79fc5b8671c44326ac339b13012dab9300f6167`, advanced the merged-PR cursor to `#1112`, and captured the release line through Lisa `2.130.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, repair-intake blocker dependency cleanup, Atlassian link-create access documentation, and release-history changes through `2.130.3`.

## 2026-06-01 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260601T021727Z` from synced `origin/main` for this ingestion PR.
- No same-day git or roles source notes existed for `2026-06-01`, so no provenance preservation copy was needed before writing the new connector notes.
- Refreshed the `git` source note with 3 new commits through `e22f996a4a35759f4f37c003ddb1dc7eeabcef72`, advanced the merged-PR cursor to `#1113`, and captured the release line through Lisa `2.130.4`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.130.4`.

## 2026-06-01 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260601T061639Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T061639Z.md` and `wiki/sources/roles/2026-06-01-roles-previous-20260601T061639Z.md` before refreshing the current `2026-06-01` connector notes.
- Refreshed the `git` source note with 21 new commits through `da197ad3f677bcb4c95ce1811c21f26330770bad`, advanced the merged-PR cursor to `#1118`, and captured the release line through Lisa `2.132.0`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, `/goal-style` verification gate, update-projects flow documentation, hook-bypass hardening, apply-subcommand split, and release-history changes through `2.132.0`.

## 2026-06-01 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260601T131638Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T131648Z.md` and `wiki/sources/roles/2026-06-01-roles-previous-20260601T131648Z.md` before refreshing the current `2026-06-01` connector notes.
- Refreshed the `git` source note with 10 new commits through `051395c3030248688fca35be2145ccf36c8fac08`, advanced the merged-PR cursor to `#1121`, and captured the release line through Lisa `2.132.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Corrected an initial probe invocation of the git connector that ran without `--state`; the over-broad generated note was not committed, and the connector was rerun with `wiki/state/git/latest.json` before state advancement.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, block-no-verify hook test de-flaking, self-update release activity, and release-history changes through `2.132.3`.

## 2026-06-01 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current branch onto `origin/main` without conflicts, then created `wiki/ingest-20260601T201744Z` from synced `origin/main` for this ingestion PR.
- Preserved prior same-day git and roles source notes as `wiki/sources/git/2026-06-01-lisa-monorepo-git-previous-20260601T201744Z.md` and `wiki/sources/roles/2026-06-01-roles-previous-20260601T201744Z.md` before refreshing the current `2026-06-01` connector notes.
- Refreshed the `git` source note with 28 new commits through `27af17b457c0062cbafb0fdcff74c216faf59771`, advanced the merged-PR cursor to `#1129`, and captured the release line through Lisa `2.133.3`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, two-way PR ticket links, the `setup-project` CLI command, Expo SDK 54/56 template compatibility, package.json corruption guards, Harper Fabric template cleanup, and release-history changes through `2.133.3`.

## 2026-06-04 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin` and rebasing the current wiki branch onto `origin/main` without conflicts, then created `wiki/ingest-20260604T065711Z` from synced `origin/main` for this ingestion PR.
- No same-day git or roles source notes existed for `2026-06-04`, so no provenance preservation copy was needed before writing the new connector notes.
- Refreshed the `git` source note with 3 new commits through `e672acca43a7f954bdaf7ed7d97b0035f82445cc`, advanced the merged-PR cursor to `#1137`, and captured the release line through Lisa `2.134.6`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped `memory` because no project-scoped Claude memory directory exists for `/Users/cody/.codex/worktrees/lisa-automation-main`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge and release-history changes through `2.134.6`.

## 2026-06-06 - Doc correction: canonical, rule-free AGENTS.md (agy baking removed)

- Source of truth: PR #1150 (`feat(instructions): make AGENTS.md canonical, CLAUDE.md a pointer, add doctor migration`), merged to `main` at 2026-06-06T15:29:54Z. Verified against the landed code in the worktree before editing — `src/agy/agents-md-installer.ts` deleted, `src/core/instruction-files-migration.ts` added, agy emit path now calls `installAgentsMd` (`src/codex/agents-md-installer.ts`), `CLAUDE.md` pointer via `src/claude/claude-md-installer.ts`, migration wired into `src/cli/doctor.ts`.
- Corrected `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`: added an "Update (2026-06-06): canonical, rule-free AGENTS.md" section and fixed the `plugins/lisa-agy/` bullet that claimed rules were re-routed into a baked AGENTS.md block.
- Corrected `wiki/architecture/pattern-b-fan-out-spec.md`: added a top-of-file supersede banner and fixed every inline "agy AGENTS.md bake" / "rules-once invariant for agy" claim — the `NO rules/` output note, the rule-delivery resolution and net-result paragraphs, the `src/agy/` installer-surface section (struck the `rules-bake.ts` entry), and the `lisa-agy/` test-plan row (no longer asserts baked rules content).
- Recorded the four corrected facts in both pages: (1) `AGENTS.md` is canonical and rule-free, (2) `CLAUDE.md` is a thin `@AGENTS.md` pointer, (3) agy no longer receives baked eager rules (accepted trade-off, since agy plugin hooks do not fire in `-p` headless mode), (4) `lisa doctor` migrates existing projects via `migrateInstructionFiles` in `src/core/instruction-files-migration.ts`.
- Scanned `parity/` for "Cluster 4-agy / Option α", baking, and rules-once references: none found, so no parity artifact required changes.
- `wiki/index.md` not modified: its entries are plain title links with no per-page summaries, and both page H1 titles are unchanged.
- Out of scope (flagged, not edited): other live wiki pages still describe agy baking — `wiki/architecture/lisa-hook-per-agent-ship-list.md`, `wiki/architecture/coding-agent-parity.md`, `wiki/architecture/template-governance.md`, `wiki/entities/coding-agents.md`, `wiki/open-questions/coding-agent-parity.md`, `wiki/playbooks/coding-agent-parity-research.md`. `wiki/sources/**` and prior `wiki/log.md` entries are point-in-time evidence and were intentionally left as-is.

## 2026-06-06 - Doc correction follow-up: remaining agy-baking references

- Follow-up to the same-day "canonical, rule-free AGENTS.md" correction (PR #1151, merged). Same source of truth: PR #1150 on `main`. Corrected the six remaining live wiki pages that the first PR flagged as out of scope:
  - `wiki/architecture/lisa-hook-per-agent-ship-list.md` — top-of-file supersede banner; fixed the ticket-1054 update note, the `inject-rules.sh` catalog + ship-table rows, the agy hook-delivery bullet, and the historical fleet end-to-end run note (now marked pre-2026-06-06).
  - `wiki/architecture/coding-agent-parity.md` — Bake strategy and Block strategy entries: the agy-rules-bake instance was removed; agy now accepts the eager-rule gap (effectively Skip).
  - `wiki/architecture/template-governance.md` — rule-delivery semantics paragraph: agy is the exception with no eager-rule injection.
  - `wiki/entities/coding-agents.md` — agy headless-hooks caveat: the AGENTS.md bake alternative was tried then removed.
  - `wiki/open-questions/coding-agent-parity.md` — agy interactive-hooks open question: resolving it no longer changes the rules-delivery design.
  - `wiki/playbooks/coding-agent-parity-research.md` — Bake strategy taxonomy entry: example removed, strategy retained with no active Lisa instance.
- All edits are correction-in-place with `2026-06-06 / PR #1150 / was` qualifiers; no current-tense "agy bakes" claim remains uncorrected. `wiki/sources/**` left as point-in-time evidence. `wiki/index.md` unchanged (plain title links; titles unchanged).

## 2026-06-11 - Incremental connector ingest

- Created `wiki/ingest-20260611T000000Z` from detached `origin/main` HEAD for this ingestion PR.
- No same-day git or roles source notes existed for `2026-06-11`, so no provenance preservation copy was needed before writing the new connector notes.
- Refreshed the `git` source note with 12 new commits through `f09469adb26fe433abedd62ede613b395e25ec4f`, advanced the merged-PR cursor to `#1241`, and captured the release line through Lisa `2.159.7`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped project-scoped memory because no eligible project-scoped Claude memory directory exists for `/Users/codysai/.codex/worktrees/058c/lisa`; global Codex memory remains out of scope.
- Updated the monorepo snapshot and index for the prior wiki ingest merge, auditable implement roster decisions, required E2E regression execution proof, host config preservation during postinstall apply, and release-history changes through `2.159.7`.

## 2026-06-13 - Incremental connector ingest

- Synced the checkout with `origin/main` by fetching `origin`, then created `wiki/ingest-20260613T000000Z` from synced `origin/main` for this ingestion PR.
- No same-day git or roles source notes existed for `2026-06-13`, so no provenance preservation copy was needed before writing the new connector notes.
- Refreshed the `git` source note with 14 new commits through `05853e6ce16319386f642adcc8a55fefbb3a0ec2`, advanced the merged-PR cursor to `#1284`, and captured the release line through Lisa `2.165.4`.
- Refreshed the `roles` source note with 0 declared roles and 0 staff pages.
- Skipped project-scoped memory because no eligible project-scoped Claude memory directory exists for this automation checkout; global Codex memory remains out of scope.
- Updated the monorepo snapshot, workflow playbook, and index for the prior wiki ingest merge, commit-message diagnostics, executable plugin hook scripts, lint-ignored edit-file handling, and release-history changes through `2.165.4`.

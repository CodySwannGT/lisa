# Lisa Wiki Log

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

- Synced safely to `origin/main`, created the dedicated branch `wiki/ingest-2026-05-26-213208`, and ran another full no-argument ingest against every enabled non-external-write connector that was available.
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

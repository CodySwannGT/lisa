# Template Governance

Lisa distributes standards to downstream projects through template families and explicit installation strategies.

## Strategy Vocabulary

- `copy-overwrite`: enforced files that Lisa may replace on update.
- `create-only`: project-owned files that Lisa creates once and should not overwrite later.
- `merge`: shared defaults that must preserve local additions where possible.
- `copy-contents`: directory content copying for template payloads.
- `package-lisa`: package metadata and dependency management strategy.
- `tagged-merge`: marker-aware merging for files with Lisa-managed sections.

## Template Families

Template families observed in the monorepo include all, TypeScript, Expo, NestJS, CDK, Rails, tsconfig, oxlint, and plugin-related assets.

Recent additions extend the template surface to Phaser 4 and Harper Fabric. Phaser now has a stack pack with plugin metadata, templates, detection, and lint enforcement. Harper Fabric templates now include deploy workflow parity, generated-artifact edit guards, config-extension drop guards, and realtime skill support.

The shared TypeScript audit-ignore template carries the esbuild `GHSA-gv7w-rqvm-qjhr` exclusion as of PR `#1287`. This keeps Lisa-managed downstream projects from failing the bun audit pre-push gate for the esbuild Deno install module advisory when their exposure is dev/build-time tooling through bun/npm dependency chains. Remove the template exclusion once the transitive `tsx`, `vite`, `vitest`, and `esbuild-register` chain reaches esbuild `>=0.28.1`.

## Practical Rule

When updating Lisa templates, preserve the strategy contract. A downstream project may rely on Lisa overwriting one file while preserving another.

## Rule Distribution

Lisa base rules now ship as paired eager and reference material. Eager rule heads carry the mandatory short-form guidance agents should load immediately, while reference bodies preserve the full procedure and examples. Codex mirrors this split and CI checks the pairing so the two runtime surfaces do not drift.

Generated per-agent stack variants must preserve the same rule-delivery semantics as the base plugin. Claude, Codex, and Copilot use the rule injection script and Cursor reads rules natively; each of those paths should load eager rules or legacy flat-layout stack rules while leaving reference rules on demand. agy is the exception: as of 2026-06-06 (PR #1150) it gets **no** eager-rule injection — `AGENTS.md` is canonical and rule-free, and the former "agy bakes startup rules into AGENTS.md" mechanism was removed (agy has no SessionStart event for the injection hook). Not delivering eager rules to agy is the accepted trade-off.

## Wiki Ignore Patterns

The `lisa-wiki` setup flow no longer merges its own `.gitignore` block. It existed for wiki-only repositories that ran without the base plugin; since 2026-11 every project installs the base plugin and owns its wiki at `wiki/`, so the base plugin's managed block covers it.

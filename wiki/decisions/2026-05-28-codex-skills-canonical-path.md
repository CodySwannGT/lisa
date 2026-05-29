# Decision: Codex Skills Canonical Install Path

Date: 2026-05-28

Status: Accepted (research/architecture decision; Wave 3 implements the retirement).

## Context

Lisa today installs skills to Codex via two parallel paths:

1. **Per-project installer** — `src/codex/skills-installer.ts` runs during `lisa apply` and copies `plugins/<p>/skills/<n>/` to `.codex/skills/lisa/<n>/` in each host project. It also converts Claude slash commands (`plugins/lisa/commands/*.md`) into skills with a `lisa-` prefix, producing `.codex/skills/lisa/lisa-<cmd>/SKILL.md` invokable as `$lisa-<cmd>`. Skills are discovered by Codex's loader (`codex-rs/core-skills/src/loader.rs`) from the per-project `.codex/` directory.
2. **Plugin pointer** — `scripts/generate-codex-plugin-artifacts.mjs` emits `plugins/lisa/.codex-plugin/plugin.json` containing `{"skills": "./skills/"}` pointing into the plugin's own skills directory. When a user installs Lisa as a Codex plugin via marketplace (`codex plugin marketplace add CodySwannGT/lisa` followed by enabling Lisa in `~/.codex/config.toml`), Codex loads the same skills from the plugin's cache directory under `~/.codex/plugins/cache/<marketplace>/lisa/<version>/skills/`.

Both paths run during `lisa apply` today (belt-and-suspenders) and can produce overlapping skill discovery: a user with Lisa installed both via `lisa apply` AND via marketplace plugin install ends up with the same skill discoverable from two locations. The `lisa-coding-agent-parity` research artifact's Step 4 Cluster 11 flagged this as a reconciliation gap requiring a canonical-path decision before Wave 3 implementation.

## Decision

**Canonical path = plugin pointer.** Codex consumers install Lisa as a plugin via marketplace; the `.codex-plugin/plugin.json` `skills` pointer is the source of truth for skill discovery on Codex. `src/codex/skills-installer.ts` is retired as a primary path and kept only as a documented fallback for users who have not installed Lisa as a Codex plugin.

## Reasons

1. **Idiomatic Codex distribution.** Codex 0.125.0's plugin system handles skill discovery natively from the plugin manifest pointer. Every other Codex plugin in the documented examples uses this pattern; Lisa's per-project install was a pre-plugin-support workaround that is no longer required.
2. **Single source of truth.** A user enabling Lisa via `[plugins."lisa@CodySwannGT-lisa"] enabled = true` in `~/.codex/config.toml` gets the full Lisa skill set without any per-project apply. The mental model is cleaner: "install the plugin, get the skills."
3. **Naming consistency across the fleet (expected; empirically verified in plan §3).** Codex's plugin-resident skill discovery is expected to produce `lisa:<skill-name>` style namespacing matching how Cursor and Copilot prefix them — but this needs runtime confirmation against Codex 0.125.0's loader. Per-project install in `.codex/skills/lisa/` achieves Lisa-prefix consistency only via the commands-to-skills transformer's `lisa-` filename prefix, not via Codex's plugin namespace. Pattern B per-agent variants are simpler when every agent uses plugin-based discovery. The verification plan §3 below probes Codex's actual namespace behavior; if the expected `lisa:` prefix does not materialize the decision still stands because reason 4 (single source of truth) and reason 5 (symmetry with hooks migration) carry the choice on their own.
4. **Reduces `lisa apply` work.** One fewer per-project installer means one fewer file-tree write, one fewer chance for skill drift between Lisa releases and project applies. The `.codex/.lisa-managed.json` manifest's skill-tracking responsibility shrinks.
5. **Symmetry with the Wave 3 Codex hooks migration.** Wave 3 migrates Lisa's Codex hooks from per-project `src/codex/hooks-installer.ts` to plugin-bundled hooks (now that Codex 0.125.0 fires plugin-bundled hooks). Retiring `src/codex/skills-installer.ts` in the same wave keeps the Codex installer surface consistent: per-project writes only for surfaces Codex genuinely cannot carry in a plugin (settings via `config.toml`, AGENTS.md template).

## Alternatives Considered

- **Canonical = per-project install (the current implicit canonical).** Pro: `lisa apply` produces self-contained projects that work even if the user has not installed Lisa as a marketplace plugin. Con: requires running `lisa apply` for every project before Lisa skills are usable; duplicates work; out of step with idiomatic Codex distribution; conflicts with Pattern B's per-agent plugin variant story.
- **Keep both paths permanently as belt-and-suspenders.** Pro: maximum availability. Con: every skill loads twice from different locations; Codex's loader behavior with duplicates is unverified; users get confused about which install actually shipped the skill. Rejected as the long-term answer.

## Consequences

- **Wave 3 implementation work**: `src/codex/skills-installer.ts` is marked deprecated. Its primary code path (the verbatim copy + commands-to-skills transformation) moves into `scripts/generate-codex-plugin-artifacts.mjs` so the same content reaches users via the plugin's `skills/` directory at build time rather than at apply time.
- **Fallback retention**: `src/codex/skills-installer.ts` remains in the source tree as a fallback for users who have NOT installed Lisa as a Codex plugin. `lisa apply` runs it only if the user's `~/.codex/config.toml` does NOT have `[plugins."lisa@..."]` enabled. Detection lives in the existing Codex installer dispatch.
- **Manifest tracking**: `.codex/.lisa-managed.json` continues to track per-project artifacts (`AGENTS.md`, `config.toml` keys, fallback `skills/lisa/`) for cleanup on subsequent applies. The plugin-bundled skills are tracked by Codex's own plugin lifecycle and are not in the Lisa manifest.
- **Commands-to-skills transformation** moves with the skill content into the generator script. The `src/codex/command-skill-transformer.ts` source file stays in place (TypeScript module under `src/codex/`) and is imported by BOTH `scripts/generate-codex-plugin-artifacts.mjs` (the new canonical path) and `src/codex/skills-installer.ts` (the fallback). The generator imports it via the existing build-tooling path; the fallback installer's existing import path is unchanged. This keeps the transformation logic in a single source location with two consumers.
- **User experience change**: a new Lisa user on Codex who has NOT run `codex plugin marketplace add CodySwannGT/lisa` gets fallback per-project skills. After `marketplace add` + plugin enable, they get plugin-bundled skills and the fallback is suppressed. Documentation in `wiki/documentation/` should describe the two install modes.

## Verification Plan (for Wave 3)

1. Throwaway Codex home (`CODEX_HOME=/tmp/probe-codex-home`).
2. Install Lisa as a plugin: `codex plugin marketplace add CodySwannGT/lisa && codex plugin install lisa@CodySwannGT-lisa`.
3. Run `codex` (interactive) and confirm Lisa skills are listed with `lisa:<name>` namespace.
4. Run `codex` in a project that has NOT had `lisa apply` run. Confirm skills work.
5. Run `codex` in a separate throwaway home where Lisa is NOT installed as a plugin. Run `lisa apply` in a host project. Confirm the fallback per-project skills install populates `.codex/skills/lisa/` and the skills are discoverable.
6. Run `codex` in the same project as step 5 with Lisa ALSO installed as a plugin. Confirm exactly one copy of each skill is discovered (no double-load).

## Related Work

- Wave 3 Pattern B fan-out: per `wiki/architecture/pattern-b-fan-out-spec.md`, NO separate `plugins/lisa-codex/` artifact is generated. Codex reads `.codex-plugin/plugin.json` from `plugins/lisa/` directly (the existing dual-pointer pattern with `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json` in the same directory is preserved). The marketplace entry `lisa` serves both Claude and Codex consumers.
- Wave 3 Action 3 (Codex hooks migration): migrates the other half of the per-project-installer-to-plugin-bundled story. Apply the same retirement pattern.
- Detection of "is Lisa installed as a Codex plugin?" — the fallback rule says `lisa apply` runs `src/codex/skills-installer.ts` only if `~/.codex/config.toml` does NOT contain `[plugins."lisa@CodySwannGT-lisa"]`. Implement this detection inside `src/codex/skills-installer.ts` itself (early return when the plugin enable key is present) so the existing Codex orchestrator in `lisa apply` does not need a new dispatch decision. The same detection pattern can be reused for the hooks-installer.ts fallback in Wave 3 Action 3.

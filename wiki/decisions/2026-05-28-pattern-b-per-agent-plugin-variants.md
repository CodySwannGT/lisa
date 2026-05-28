# Decision: Pattern B Per-Agent Plugin Variants

Date: 2026-05-28

Status: Accepted (research-side decision; implementation is the responsibility of `lisa-coding-agent-parity-implement`).

## Context

Lisa is being extended to install into five coding agents: Claude Code, Codex, Cursor (`cursor-agent`), Antigravity (`agy`), and GitHub Copilot. Each agent has its own plugin format and runtime quirks. Some features Lisa polyfills (such as rule injection via a SessionStart hook) collide with features another agent auto-loads natively (such as Cursor's `rules/` auto-discovery). The same Lisa plugin distributed verbatim to every agent would double-inject rules on Cursor, ship hooks that never fire on agy headless mode, and miss Copilot's `.agent.md` filename convention for sub-agents.

## Decision

Generate per-agent plugin artifacts at build time. The shared source under `plugins/src/` produces per-agent outputs under `plugins/lisa-<agent>/`:

- `plugins/lisa/` — Claude Code artifact, the existing build output.
- `plugins/lisa-cursor/` — Cursor variant, stripped of polyfill hooks that collide with Cursor's native auto-discovery (`inject-rules.sh`).
- `plugins/lisa-agy/` — agy variant with manifest moved to bare `plugin.json` at the artifact root, Claude-only hooks stripped, and the rules-injection mechanism re-routed to the AGENTS.md template since agy plugin hooks do not fire in headless mode.
- `plugins/lisa-copilot/` — Copilot variant with sub-agent files renamed or manifest-overridden to satisfy Copilot's `<n>.agent.md` filename expectation.
- Codex artifacts continue to derive from the Claude build through `scripts/generate-codex-plugin-artifacts.mjs`, extended where Codex 0.125.0 now supports plugin-bundled hooks.

`scripts/build-plugins.sh` orchestrates the fan-out. New generator scripts (`scripts/generate-cursor-plugin-artifacts.mjs`, `scripts/generate-agy-plugin-artifacts.mjs`, `scripts/generate-copilot-plugin-artifacts.mjs`) produce the agent-specific variants. The source of truth remains `plugins/src/`; the generated artifact tree is regenerated on every build.

The `.claude-plugin/marketplace.json` at the repository root lists the per-agent variants alongside the existing plugins so a user can install the right Lisa variant for their CLI. Alternatively, the Lisa installer may auto-detect the installed CLI fleet during `lisa apply` and pick the appropriate variant without exposing the variant choice to the user.

## Alternatives Considered

- **Pattern A: Runtime detection inside polyfill scripts.** Each polyfill hook checks an environment variable such as `LISA_RUNTIME` and exits early when the runtime matches a peer agent that auto-handles the feature. Rejected because shell scripts cannot reliably identify which agent invoked them, the env-var must be set somewhere upstream, and the failure mode is silent over-injection.
- **Pattern C: Capability detection at apply time.** `lisa apply` probes each installed agent's native capabilities at run time, writes a per-project capability file, and lets polyfill hooks read it. Rejected because the probes are slow, fail in offline or restricted environments, and put the per-agent decision into runtime rather than build time. Pattern B is more inspectable: a reviewer can `cat plugins/lisa-cursor/.claude-plugin/plugin.json` and see exactly what ships to Cursor.

## Consequences

- Three new generator scripts and one extension to `scripts/build-plugins.sh`.
- Per-agent plugin artifact directories under `plugins/` go from 8 to roughly 8 × 5 = 40 effective install targets. The build process scales mechanically.
- Polyfill collision risk is eliminated for the rules-on-Cursor case and all similar future collisions, because each agent gets exactly the plugin payload appropriate for it.
- Per-hook portability audits (per the implementation skill) determine which hooks ship to which agent. Claude-only hooks such as `enforce-team-first.sh` and `setup-jira-cli.sh` stay only in the Claude artifact.
- A separate Lisa-coding-agent-parity-implement skill consumes the polyfill design output and authors the variant-generator scripts. Implementation is out of scope for this decision.

## Notes

- `PROJECT_RULES.md` already enforces that plugin artifacts are generated and `plugins/src/` is the source of truth. The new variant directories inherit that rule.
- `package.json` package weight grows because each variant ships inside `@codyswann/lisa`. The TypeScript-stack precedent (`plugins/lisa-typescript/`) shows the pattern works; the size impact should be re-measured when variants land.

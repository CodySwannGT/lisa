# Decision: Project-Scoped Codex Delivery

Date: 2026-07-10

Status: Accepted. Supersedes the 2026-05-28 plugin-pointer decision.

## Context

Lisa previously delivered Codex content through both a project overlay and a
user-wide marketplace plugin. Codex discovered the same base skills from both
locations, and the user-wide plugin also exposed every Lisa stack plugin to
every project. That duplicated skills, loaded unrelated project rules and
hooks, and could exhaust Codex's model-visible skill-description budget.

Codex plugin activation state is user-scoped, but Codex also defines a
repository marketplace at `.agents/plugins/marketplace.json`. Lisa's ownership
boundary is the project, so Lisa may publish that repository catalog but must
never call the user-scoped plugin or marketplace installation commands.

## Decision

`lisa apply` is the only Codex reconciliation entry point. It writes:

- a repository marketplace containing only the selected base, detected stack,
  and explicitly configured feature plugins;
- native skills loaded directly from those plugin bundles, with exact names
  deduplicated in each Codex-specific plugin artifact;
- the base `lisa` agents;
- the plugins matching Lisa's expanded detected project types;
- standalone plugins selected by explicit project configuration;
- plugin-bundled hooks and rules from only those project types;
- project settings and Lisa MCP servers in `.codex/config.toml`.

Claude commands without an authored skill are converted during plugin build
into Codex-only `.codex-plugin/skills/` content. The other agent variant
generators strip `.codex-plugin/`, so this does not alter Claude, Cursor, Agy,
Copilot, or OpenCode behavior.

`.codex/.lisa-managed.json` records Lisa-owned overlay files. Reapplying removes
stale agents and legacy project hook/rule/skill-link/router artifacts while
preserving host-owned files and configuration. Host-authored `.codex/hooks.json`
entries remain intact. The settings merge writes
`[features].hooks = true` and removes the deprecated `codex_hooks` key.

Lisa never runs `codex plugin add` or `codex plugin marketplace add`. Its
postinstall removes legacy Lisa Codex
plugin registrations when found and no Codex thread is active. Cleanup is
deferred during an active thread because moving cached hook files would break
that thread's captured hook commands. This migration is the only intentional
access to old user-wide Lisa state.

## Lifecycle

Projects install Lisa with Bun as a trusted development dependency. The package
postinstall runs noninteractive `lisa apply`, so both `bun install` and a version
change through `bun update @codyswann/lisa` reconcile the project overlay.
Repeated applies converge without duplicate native skill names or marketplace
entries. The generated marketplace is gitignored and existing tracked copies
are untracked because their project-local package paths require dependencies to
be installed.

## Consequences

- A Codex session sees only content relevant to the current repository.
- Codex receives the complete base catalog the project requires, but unrelated
  stack plugins and exact duplicate names no longer consume the fixed skill
  metadata budget.
- A Lisa update cannot change another project's Codex configuration.
- Removing or changing a project stack removes stale Lisa-owned artifacts on
  the next apply.
- `$skill-name` continues to use Codex's native skill invocation rather than a
  Lisa-specific router convention.
- Codex works without a separate user-wide Lisa plugin installation.
- Runtimes that cannot consume a project-owned capability retain a documented
  parity gap; Lisa does not resolve that gap with cross-project mutation.

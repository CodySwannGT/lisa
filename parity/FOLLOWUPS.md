# Plugin Parity — Deferred Follow-ups

Issue #1059 brought Lisa's curated third-party Claude plugins to cross-agent parity
(Codex / Cursor / agy / Copilot). This file records the parity work that is
**deliberately deferred** so it is honestly tracked, not silently dropped.

The approved per-plugin routing artifacts under `parity/plugin-routing/*.json` are the
source of truth for the intended outcomes; this file explains what is *not yet built*
and why.

---

## 1. `typescript-lsp` LSP re-point → NEW SUBSYSTEM (deferred)

The re-point feasibility probe (task #14) found **no existing LSP emission path for any
agent** — Lisa can fan out MCP servers but has no equivalent for `lspServers`. The
`typescript-lsp@claude-plugins-official` artifact's `re-point-mcp-lsp` actions are the
spec for this work; building it is a new subsystem, deferred:

- **Codex** — extend `componentPointers()` to emit `lspServers` (~2–3 lines).
  *Unverified:* whether the Codex plugin manifest accepts `lspServers` pointers.
- **agy** — new `collectLisaLspServers()` + `installAgyLspConfig()` (~50–80 lines,
  mirroring the existing MCP installer path).
- **Copilot** — extend `generate-copilot-plugin-artifacts.mjs` for `lspServers`.
  *Unverified:* whether the Copilot CLI honors `lspServers`.
- **Cursor** — covered natively (reads `.claude-plugin/`), no action.

**Recommendation:** bundle this infra with any *future* LSP-bearing plugins so the
build + verification cost is amortized across more than one consumer. Today
`typescript-lsp` is the only LSP plugin, so the subsystem would serve a single plugin.

---

## 2. `enable-vendor-equivalent` (Copilot) → MANUAL / NATIVE (no Lisa source change)

For `code-review`, `code-simplifier`, `coderabbit`, and `safety-net`, the **Copilot**
routing outcome is `enable-vendor-equivalent`: Copilot ships its own native equivalents
and Lisa should prefer enabling those over reimplementing.

| Plugin           | Copilot native equivalent                                   |
| ---------------- | ----------------------------------------------------------- |
| code-review      | native `/review` (pull-request / code-review)               |
| code-simplifier  | native refactor / code-quality capability                   |
| coderabbit       | CodeRabbit's own VS Code extension (review components)      |
| safety-net       | native hook runner (`cc-safety-net --copilot-cli`)          |

There is **no Lisa mechanism** to enable a third-party vendor's plugin inside Copilot's
marketplace from Lisa's side — these are **user-enabled native capabilities**. They are
documented here and **not emitted by Lisa**. (Note: `coderabbit`'s `autofix` skill has no
native Copilot equivalent, so it is reimplemented — see §3.)

---

## 3. Reimplement scaffolds are PLACEHOLDERS

The 7 skills under `.claude/skills/parity-*` are **v1 shells only**. They carry a
`synced-from` pin (where the upstream publishes semver) so `plugin-parity-drift` tracks
them against upstream; the **actual behavior authoring is out of scope** per #1059
("actual reimplementation is downstream work, each its own review"). Likewise, true
downstream distribution — moving a finished skill into `plugins/src/base` so it fans out
via the #1050 plugin pipeline — is deferred to that per-skill work.

| Scaffold (`.claude/skills/…`) | Pin status                                          |
| ----------------------------- | --------------------------------------------------- |
| `parity-code-simplifier`      | `code-simplifier@claude-plugins-official@1.0.0`     |
| `parity-coderabbit`           | `coderabbit@claude-plugins-official@1.1.1`          |
| `parity-safety-net`           | `safety-net@cc-marketplace@0.9.0`                   |
| `parity-sentry-seer`          | `sentry@claude-plugins-official@1.0.0`              |
| `parity-sentry-sdk-suite`     | `sentry@claude-plugins-official@1.0.0` (one marker for all 30 SDK skills) |
| `parity-code-review`          | **no pin** — upstream has no semver → not drift-trackable (track manually) |
| `parity-skill-creator`        | **no pin** — upstream has no semver → not drift-trackable (track manually) |

The `parity-safety-net` hook component, when authored, ships via the per-agent hook
generators (the #1054–#1058 fan-out), not bundled in the skill.

---

## 4. What IS shipped now

- **Sentry MCP re-point — real cross-agent delivery.** The sentry HTTP MCP is emitted
  from `plugins/src/base/.mcp.json`, which reaches **Codex, agy, Copilot, and Cursor**
  through their existing per-agent emission paths. This is the one component group with
  concrete, shipped cross-agent delivery.
- **7 drift-tracked reimplement placeholders** under `.claude/skills/parity-*` (5 pinned,
  2 intentionally unpinned), kept honest by `scripts/plugin-parity-drift.mjs`.
- **All 7 routing artifacts approved** under `parity/plugin-routing/`:
  `code-review`, `code-simplifier`, `coderabbit`, `safety-net`, `sentry`,
  `skill-creator`, `typescript-lsp`.

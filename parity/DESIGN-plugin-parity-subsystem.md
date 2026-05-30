# Design — Third-party Plugin Parity Subsystem (issue #1059)

**Status:** design complete, ready for builder. **Scope:** the *subsystem* (3 skills + 3 commands + 1 drift script + tests). The actual per-plugin reimplementations are OUT OF SCOPE per the issue — the subsystem only *schedules* them.

Author: architect teammate. Builds on the locked decisions in task #2 and the verified codebase facts cited below.

---

## 0. Problem & placement (locked)

Lisa curates a small set of third-party Claude plugins in `enabledPlugins` (verified `all/merge/.claude/settings.json:6-14` and root `.claude/settings.json:22-31`):

```
lisa@lisa, safety-net@cc-marketplace, code-simplifier@claude-plugins-official,
code-review@claude-plugins-official, coderabbit@claude-plugins-official,
sentry@claude-plugins-official, skill-creator@claude-plugins-official
```
(+ `typescript-lsp@claude-plugins-official` in stack settings.) These reach Claude (and Cursor, which reads `.claude-plugin/` natively) but **not** Codex/agy/Copilot. This subsystem analyzes each curated plugin, routes per-agent parity actions, and detects when a Lisa reimplementation has drifted behind its upstream plugin.

All three skills are **Lisa-repo-internal** — they operate on Lisa's own generation pipeline and curated list. They live next to the siblings at root `.claude/skills/<name>/SKILL.md` + `.claude/commands/<name>.md` (matching `lisa-codex-parity`, `lisa-coding-agent-parity`). **NOT** `plugins/src/base` — no `build:plugins`, not downstream-distributable, no artifact regeneration (`bun run check:plugins` is unaffected).

---

## 1. Final file list

### Created
| Path | Purpose |
|------|---------|
| `.claude/skills/analyze-plugin/SKILL.md` | Plan-only analyzer: inventory one curated plugin, classify components, emit per-agent routing artifact + human matrix, STOP for review. |
| `.claude/commands/analyze-plugin.md` | Pass-through command (`argument-hint`, `$ARGUMENTS`) → `/analyze-plugin` skill. |
| `.claude/skills/implement-plugin-parity/SKILL.md` | Consumes an **approved** routing artifact; deterministic changes only (emit MCP/LSP into agent variants via existing generators/installers; enable vendor equivalents; scaffold `synced-from`-stamped Lisa skills for approved reimplements). Never ports plugin code. |
| `.claude/commands/implement-plugin-parity.md` | Pass-through command → skill. |
| `scripts/plugin-parity-drift.mjs` | Deterministic, unit-testable drift detector. Scans `synced-from` skills, resolves each plugin's current upstream version from the cache, emits a stale report. Never auto-bumps. **Empirical-verification core.** |
| `.claude/skills/plugin-parity-drift/SKILL.md` | Wraps the script; documents grammar, exit codes, CI usage. |
| `.claude/commands/plugin-parity-drift.md` | Pass-through command → skill. |
| `tests/unit/scripts/plugin-parity-drift.test.ts` | Vitest unit tests (proves Scenario 3 against a fixture). |
| `parity/plugin-routing/.gitkeep` | Durable home for routing artifacts (see §5). |
| `parity/fixtures/drift/` | Test fixture cache + skills tree (see §4.4). |

### Modified
- **None required for v1.** The implement skill *reuses* the existing generators/installers as black boxes; no generator edit is needed to ship the subsystem. (If a specific reimplement case later needs a generator change, that is a separate work item, not part of this subsystem.)

### Referenced (read-only, not modified) — verified citations
- `scripts/build-plugins.sh:24-49` — `build_plugin` (Claude→Codex derive) and per-agent fan-out (`build_per_agent_variant`, lines ~52-115). Standalone variant build path the implement skill triggers via `bun run build:plugins`.
- `scripts/generate-codex-plugin-artifacts.mjs` — Codex `.codex-plugin/{plugin.json,hooks.json,mcp}` derivation (skills + MCP pointer + hooks).
- `scripts/generate-cursor-plugin-artifacts.mjs` — Cursor variant (`.mdc` rules, `mcp.json`, native hooks).
- `scripts/generate-agy-plugin-artifacts.mjs:113 generateAgyVariant` — agy variant; **drops** `.mcp.json` + `mcpServers` (line 134-173); MCP is user-global only.
- `scripts/generate-copilot-plugin-artifacts.mjs:203-238` — Copilot surfaces a bundled `.mcp.json`'s servers as an **inline `mcpServers`** object on the manifest (bare `.mcp.json`/path-pointer is ignored). Copilot also uniquely supports `lspServers` (re-point-LSP target — not currently emitted; an implement-side hook only if a curated LSP plugin is routed there).
- `src/agy/mcp-installer.ts` — `defaultUserMcpConfigPath()` `~/.gemini/config/mcp_config.json`; agy MCP shape uses `serverUrl` (not `url`); `_lisaManaged` tagged-merge. Runtime (non-plugin) MCP delivery for agy.
- `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/.claude-plugin/plugin.json` — installed plugin tree; `version` field is source of truth (verified: `claude-plugins-official/code-simplifier/1.0.0/.claude-plugin/plugin.json` → `{"name":"code-simplifier","version":"1.0.0"}`).
- `~/.claude/plugins/installed_plugins.json` — authoritative install records (`version`, `installPath`, `lastUpdated` per project). Used only as a cross-check, NOT the primary resolver (see §3.2 rationale).

---

## 2. `synced-from` frontmatter grammar (ambiguity (a), part 1)

A Lisa-native skill that reimplements an upstream plugin carries one frontmatter key:

```yaml
synced-from: <plugin>@<marketplace>@<version>
```

Examples:
```yaml
synced-from: code-simplifier@claude-plugins-official@1.0.0
synced-from: coderabbit@claude-plugins-official@1.1.1
```

**Grammar (EBNF):**
```
synced-from   = plugin-ref "@" version
plugin-ref    = name "@" marketplace          ; the canonical Claude plugin id, exactly as in enabledPlugins
name          = 1*( ALPHA / DIGIT / "-" / "_" )
marketplace   = 1*( ALPHA / DIGIT / "-" / "_" )
version       = semver                        ; MAJOR.MINOR.PATCH[-prerelease][+build], semver 2.0.0
```

**Parse rule (deterministic, unambiguous):** semver never contains `@`, so split on the **last** `@`:
- right of last `@` = `version`
- remainder = `plugin-ref` (itself `name@marketplace`; split once more on its single `@`).

`plugin-ref` is byte-identical to the `enabledPlugins` key and to the cache path `<marketplace>/<name>/`, so it doubles as the resolver lookup key — no separate marketplace field needed. This honors the task's `synced-from: <plugin>@<version>` intent where `<plugin>` is the fully-qualified plugin id.

A SKILL.md is "synced" iff its frontmatter has a parseable `synced-from`. Malformed values are reported as `unparseable` (see exit codes).

---

## 3. Drift detector — `scripts/plugin-parity-drift.mjs` (ambiguity (a), part 2)

### 3.1 CLI contract
```
node scripts/plugin-parity-drift.mjs [--skills-root <dir>]... [--cache-root <dir>] [--json]
```
- `--skills-root <dir>` (repeatable; default `<repo>/.claude/skills`): roots scanned recursively for `**/SKILL.md`. **Injectable so tests point at a fixture.**
- `--cache-root <dir>` (default `$CLAUDE_PLUGIN_CACHE` env, else `~/.claude/plugins/cache`): the installed-plugin cache root. **Injectable so tests point at a fixture.**
- `--json`: emit the machine-readable report to stdout instead of the human table. Exit code identical in both modes.

### 3.2 Upstream-version resolution (deterministic + testable)
Resolve "current upstream version" for `plugin-ref = name@marketplace` purely from the cache tree (no network, no `Date`, no `installed_plugins.json` — the cache is the offline source of truth and is trivially reproducible as a fixture):

```
resolveCurrentVersion(cacheRoot, name, marketplace):
  dir = cacheRoot/marketplace/name
  if dir not a directory:                    -> { status: "not-installed", version: null }
  versions = []
  for each immediate subdir D of dir:
     manifest = D/.claude-plugin/plugin.json
     if manifest readable and JSON.parse ok and typeof .version == "string":
        if isValidSemver(.version): versions.push(.version)
  if versions empty:                          -> { status: "unresolved", version: null }
  return { status: "ok", version: max(versions, by semver precedence) }
```

Rationale for picking **max semver across version subdirs** (verified: a single plugin like `coderabbit` has multiple subdirs `1.1.0`, `1.1.1`, `a81eb76a1539`, and `code-review` has `unknown`): the manifest `version` field — not the directory name — is authoritative; non-semver dirs (`unknown`, git-hashes) are skipped because their manifest version is what counts, and "the highest installed version" is the deterministic, machine-independent definition of "current upstream." `installed_plugins.json` is per-project and time-ordered (needs `Date`), so it is intentionally NOT the resolver — it's only an optional cross-check the human can consult.

`isValidSemver` + `compareSemver`: tiny in-script implementation (split core on `.`, numeric compare MAJOR/MINOR/PATCH; a prerelease (`-`) sorts *below* its release; build (`+`) ignored). No dependencies. Pure functions — directly unit-tested.

### 3.3 Comparison & statuses
For each synced skill, compare pinned `version` (from `synced-from`) to resolved current:

| Condition | per-skill status | contributes to exit 1? |
|-----------|------------------|------------------------|
| current == pinned | `ok` | no |
| current > pinned | `stale` (upstream advanced — Lisa reimpl behind) | **yes** |
| current < pinned | `ahead` (pin newer than installed — anomaly) | **yes** |
| resolve = `not-installed` | `not-installed` | **yes** |
| resolve = `unresolved` | `unresolved` (installed but no parseable semver) | **yes** |
| `synced-from` unparseable | `unparseable` | **yes** |

The detector **never auto-bumps** and never edits any skill — it only reports.

### 3.4 Exit codes (CI contract)
- `0` — no drift: every synced skill is `ok`.
- `1` — drift found: ≥1 skill is `stale`/`ahead`/`not-installed`/`unresolved`/`unparseable`.
- `2` — operational/usage error: unknown flag, `--cache-root` path missing, no `--skills-root` resolvable. (Distinct from drift so CI can tell "drift" from "broken invocation.")

### 3.5 `--json` report shape
```json
{
  "schemaVersion": 1,
  "cacheRoot": "/abs/cache",
  "skillsRoots": ["/abs/.claude/skills"],
  "summary": { "scanned": 3, "ok": 1, "drift": 2 },
  "results": [
    {
      "skillPath": ".claude/skills/code-simplifier/SKILL.md",
      "plugin": "code-simplifier@claude-plugins-official",
      "pinnedVersion": "1.0.0",
      "currentVersion": "2.0.0",
      "status": "stale"
    },
    {
      "skillPath": ".claude/skills/coderabbit/SKILL.md",
      "plugin": "coderabbit@claude-plugins-official",
      "pinnedVersion": "1.1.1",
      "currentVersion": "1.1.1",
      "status": "ok"
    }
  ]
}
```
Human mode: a markdown table of the same rows + a one-line summary (`2 of 3 synced skills drifted`).

### 3.6 Pseudo-code (top level)
```
main(argv):
  opts = parseArgs(argv)                      // throws -> exit 2
  if !isDir(opts.cacheRoot): exit 2
  skills = []
  for root in opts.skillsRoots:
     for file in walk(root, "**/SKILL.md"):
        fm = parseFrontmatter(file)
        if !fm["synced-from"]: continue
        skills.push({ file, raw: fm["synced-from"] })
  results = skills.map(s => {
     ref = parseSyncedFrom(s.raw)              // {name,marketplace,version} | null
     if !ref: return { ...s, status: "unparseable" }
     cur = resolveCurrentVersion(opts.cacheRoot, ref.name, ref.marketplace)
     status = classify(ref.version, cur)       // table §3.3
     return { skillPath, plugin, pinnedVersion, currentVersion: cur.version, status }
  })
  report = build(results)
  print(opts.json ? JSON.stringify(report) : humanTable(report))
  exit(results.every(r => r.status == "ok") ? 0 : 1)
```

---

## 4. Acceptance criteria → verification mapping

> Scenario numbering matches the issue. **Scenario 3 is the empirical core** and maps to a concrete `vitest`-runnable test against a committed fixture.

| # | Acceptance criterion | Verification (runnable) |
|---|----------------------|-------------------------|
| 1 | `analyze-plugin` inventories a curated plugin's components and emits a routing artifact + human matrix, then STOPS | Run `/analyze-plugin code-simplifier@claude-plugins-official`; assert `parity/plugin-routing/code-simplifier@claude-plugins-official.json` exists, validates against §6 schema (`status:"proposed"`, one routing entry per agent), and a sibling `.md` matrix is written; skill makes **no** source-tree edits. |
| 2 | `implement-plugin-parity` refuses an un-approved artifact | Run the skill against a `status:"proposed"` artifact → it exits without changes and prints the approval instruction. Flip to `status:"approved"` → it performs only the artifact's declared deterministic actions. |
| 2b | implement reuses existing generators/installers; never ports plugin code | After an approved MCP re-point, `bun run build:plugins` is deterministic and `bun run check:plugins` passes; assert the agent variant manifests carry the expected `mcpServers`/`mcp.json` and that no upstream plugin source was copied (grep for absence of ported code). |
| **3** | **Reimplementations are version-pinned and drift is detected** | **`node scripts/plugin-parity-drift.mjs --cache-root parity/fixtures/drift/cache --skills-root parity/fixtures/drift/skills --json` exits `1` and reports `code-simplifier` `stale` `1.0.0 → 2.0.0`.** Encoded as the vitest test in §4.4. |
| 3b | No drift → exit 0 | Same script against the `no-drift` fixture (pin == current) exits `0`, summary `0 drift`. |
| 3c | Detector never auto-bumps | Test asserts the fixture skill file bytes are unchanged after the run (read before/after). |
| 4 | `synced-from` grammar is enforced | Unit test: `parseSyncedFrom` accepts `name@mkt@1.2.3`, splits on last `@`, rejects malformed → `unparseable` status surfaces and forces exit 1. |
| 5 | CI can gate on drift | The exit-code contract (§3.4) is the gate; a CI step `node scripts/plugin-parity-drift.mjs` (default roots) fails the build on exit 1. |

### 4.4 Scenario-3 test (concrete, runnable)
**Fixture (committed under `parity/fixtures/drift/`):**
```
parity/fixtures/drift/
  cache/claude-plugins-official/code-simplifier/2.0.0/.claude-plugin/plugin.json   # {"name":"code-simplifier","version":"2.0.0"}
  cache/claude-plugins-official/code-simplifier/1.0.0/.claude-plugin/plugin.json   # older sibling -> resolver must pick max (2.0.0)
  cache/claude-plugins-official/coderabbit/1.1.1/.claude-plugin/plugin.json        # {"version":"1.1.1"}
  skills/code-simplifier/SKILL.md     # frontmatter synced-from: code-simplifier@claude-plugins-official@1.0.0   (STALE)
  skills/coderabbit/SKILL.md          # frontmatter synced-from: coderabbit@claude-plugins-official@1.1.1         (OK)
  skills/plain/SKILL.md               # no synced-from -> ignored
```
**`tests/unit/scripts/plugin-parity-drift.test.ts` (vitest) asserts:**
1. Spawn the script with the fixture roots + `--json`; capture stdout + exit code.
2. `expect(exitCode).toBe(1)`.
3. Report `summary` = `{ scanned: 2, ok: 1, drift: 1 }` (plain ignored).
4. `code-simplifier` result `{ pinnedVersion:"1.0.0", currentVersion:"2.0.0", status:"stale" }` — proving **max-semver resolution across the 1.0.0/2.0.0 sibling dirs**.
5. `coderabbit` result `status:"ok"`.
6. A "no-drift" variant (bump the pin to `2.0.0`) exits `0`.
7. File-bytes-unchanged assertion (3c).
8. Pure-function tests for `compareSemver`/`isValidSemver`/`parseSyncedFrom` (hardcoded known values per the Test Isolation house rule — do NOT compute expected values by calling the function under test).

Run: `bun run test:unit` (vitest; `tests/unit/scripts/` is an existing dir).

---

## 5. On-disk location for routing artifacts + drift (ambiguity (c)) — DECISION

**Decision: durable, committed `parity/` directory at repo root — NOT `/tmp`.**

```
parity/
  plugin-routing/<plugin>@<marketplace>.json   # machine-readable routing artifact (analyze writes, implement reads)
  plugin-routing/<plugin>@<marketplace>.md      # human matrix (review companion)
  fixtures/drift/...                            # committed test fixtures
  DESIGN-plugin-parity-subsystem.md             # this doc
```

**Justification (vs the siblings' `/tmp/parity-research.md`):** the sibling parity skills are *pure research* — their `/tmp` artifact is ephemeral scratch consumed in one session. This routing artifact is different in kind:
1. **It is an approval gate / contract between two skills** (`analyze` → human → `implement`). The approval must survive across sessions, machines, and reviewers.
2. **It is an auditable decision record** — reviewers see exactly what parity routing was approved, in the PR diff.
3. **`implement-plugin-parity` must read it deterministically** later; `/tmp` is not reliable across runs/agents.
4. **It pairs naturally with the committed drift fixtures and the `synced-from` stamps**, which are themselves durable repo state.

The filename uses the full `<plugin>@<marketplace>` id (one artifact per curated plugin) so re-running `analyze` for one plugin never clobbers another. Artifacts are committed; the human "approval" is simply flipping `"status": "proposed"` → `"approved"` (and is visible in git history).

---

## 6. Routing artifact schema (ambiguity (b)) + worked example

### 6.1 Schema (`parity/plugin-routing/<plugin>@<marketplace>.json`)
```jsonc
{
  "schemaVersion": 1,
  "plugin": "code-simplifier@claude-plugins-official", // canonical id (== synced-from plugin-ref)
  "pluginName": "code-simplifier",
  "marketplace": "claude-plugins-official",
  "upstreamVersion": "1.0.0",          // resolved by analyze from the cache at analysis time
  "analyzedAt": "2026-05-30",          // informational only (not load-bearing; no Date dependency in drift)
  "status": "proposed",                // "proposed" | "approved"  (human flips to approved)
  "components": [                      // inventory of the plugin's parts, each classified
    {
      "kind": "agent",                 // "skill"|"agent"|"command"|"hook"|"mcp"|"lsp"
      "id": "code-simplifier",
      "path": "agents/code-simplifier.md",
      "classification": "claude-agent",// "claude-skill"|"claude-agent"|"claude-command"|"hook"|"mcp-server"|"lsp-server"
      "notes": "single subagent; no MCP/LSP"
    }
  ],
  "routing": {                         // exactly one entry per agent; outcome is the locked enum
    "codex":   { "outcome": "reimplement",             "actions": ["scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0"], "rationale": "Codex has no plugin subagent surface; behavior reimplemented as a Lisa skill." },
    "cursor":  { "outcome": "claude-only",             "actions": [],                                                                                                  "rationale": "Cursor reads .claude-plugin/ natively; the agent loads unchanged." },
    "agy":     { "outcome": "reimplement",             "actions": ["scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0"], "rationale": "agy converts commands→skills but has no equivalent subagent plugin surface." },
    "copilot": { "outcome": "enable-vendor-equivalent","actions": ["enable copilot's native simplifier equivalent in the project-scoped marketplace"],                "rationale": "vendor ships a comparable capability; prefer enabling over reimplementing." }
  }
}
```

**Outcome enum (locked by task #2):** `already-native | re-point-mcp-lsp | enable-vendor-equivalent | claude-only | reimplement`.
- `already-native` — agent already gets it via the existing fan-out; no action.
- `re-point-mcp-lsp` — the plugin is (or carries) an MCP/LSP server; emit it into that agent's variant via the existing generator/installer (Codex `.codex-plugin` MCP pointer; Cursor `mcp.json`; agy → `src/agy/mcp-installer.ts` user-global; Copilot → inline `mcpServers` / `lspServers` on the manifest).
- `enable-vendor-equivalent` — enable the agent's native equivalent in its project-scoped marketplace.
- `claude-only` — intentionally not ported (e.g. Cursor already covered, or no equivalent); documented, no action.
- `reimplement` — scaffold a Lisa-native skill stamped `synced-from` (the only case that creates a drift-tracked artifact). **v1 scaffolds only — the actual reimplementation logic is out of scope.**

### 6.2 Worked example — `coderabbit@claude-plugins-official` (an MCP-bearing plugin)
```jsonc
{
  "schemaVersion": 1,
  "plugin": "coderabbit@claude-plugins-official",
  "pluginName": "coderabbit",
  "marketplace": "claude-plugins-official",
  "upstreamVersion": "1.1.1",
  "analyzedAt": "2026-05-30",
  "status": "proposed",
  "components": [
    { "kind": "command", "id": "coderabbit-review", "path": "commands/coderabbit-review.md", "classification": "claude-command", "notes": "user-facing review trigger" },
    { "kind": "mcp",     "id": "coderabbit",        "path": ".mcp.json",                     "classification": "mcp-server",     "notes": "HTTP MCP server" }
  ],
  "routing": {
    "codex":   { "outcome": "re-point-mcp-lsp",        "actions": ["emit coderabbit MCP into .codex-plugin via generate-codex-plugin-artifacts.mjs"], "rationale": "Codex consumes the .codex-plugin MCP pointer." },
    "cursor":  { "outcome": "already-native",          "actions": [],                                                                                  "rationale": "Cursor variant already emits mcp.json from .mcp.json." },
    "agy":     { "outcome": "re-point-mcp-lsp",        "actions": ["register coderabbit MCP via src/agy/mcp-installer.ts (user-global, serverUrl shape)"], "rationale": "agy ignores plugin MCP; runtime installer delivers it." },
    "copilot": { "outcome": "re-point-mcp-lsp",        "actions": ["surface coderabbit as inline mcpServers on the copilot manifest (generator already does this from .mcp.json)"], "rationale": "Copilot only reads inline mcpServers, not bundled .mcp.json." }
  }
}
```
This example produces **no** `synced-from` skill (no `reimplement`), so it never appears in the drift report — illustrating that drift tracking is scoped exactly to reimplementations.

---

## 7. Skill/command house-style notes (for the builder)

- **Skills** (`.claude/skills/<name>/SKILL.md`): hyphen names; frontmatter `name` + `description` (siblings also set `allowed-tools`). No `argument-hint`/`$ARGUMENTS` in skills. `analyze-plugin` & `plugin-parity-drift` → `allowed-tools: ["Bash","Read","Write","Edit","Glob","Grep","Skill"]`; `implement-plugin-parity` same set (it edits/builds).
- **Commands** (`.claude/commands/<name>.md`): frontmatter `description`, `argument-hint`, optional `allowed-tools: ["Skill"]`; body is a one-line pass-through: `Use the /<skill> skill ... $ARGUMENTS` (verified pattern in `.claude/commands/lisa-codex-parity.md`).
- Plan-only skills must explicitly STOP and refuse implementation requests (mirror `lisa-coding-agent-parity` "reject and point at the sibling").
- These three skills live ONLY in root `.claude/` (Lisa-internal), never in `all/copy-overwrite/` or `plugins/src/` (per PROJECT_RULES.md — same rule that keeps `lisa-codex-parity` root-only).

---

## 8. Risks
- **Multiple cache version dirs / `unknown` dirs** — resolver picks max valid semver from manifest `version` fields, skipping non-semver dirs; if a plugin only has non-semver manifests the status is `unresolved` (exit 1, surfaced — not silently OK). Mitigation: behavior is explicit and fixture-tested.
- **Marketplace ambiguity in `synced-from`** — solved by embedding the full `name@marketplace` id and splitting on the last `@`; verified semver never contains `@`.
- **Approval bypass** — `implement-plugin-parity` hard-gates on `status:"approved"`; an un-approved or schema-invalid artifact is a no-op error.
- **Generator drift** — implement reuses generators as-is; if a curated plugin needs a *new* emission path (e.g. first LSP routed to Copilot `lspServers`), that's a separate work item, flagged in the artifact `actions`, not silently attempted.

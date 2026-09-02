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
marketplace from Lisa's side — these are **user-enabled native capabilities** that Lisa
itself never activates. (Note: `coderabbit`'s `autofix` skill has no native Copilot
equivalent, so it is reimplemented — see §3.)

**Correction for `safety-net` (2026-08-11 re-review).** "Not emitted by Lisa" does not
hold for the `safety-net` row the way it was previously worded: the reimplemented
`parity-safety-net.sh` hook and `lisa-parity-safety-net-rules` skill (see §3) ship into
the generated Copilot plugin artifact via the same universal base-plugin fan-out every
other agent gets — `generate-copilot-plugin-artifacts.mjs` has no safety-net-specific
exclusion for them. What Lisa does not do is enable the *vendor's own* `cc-safety-net`
runner inside Copilot's marketplace — a user who wants that installs
`cc-safety-net --copilot-cli` themselves, and it then runs alongside Lisa's hook rather
than replacing it. See `parity/plugin-routing/safety-net@cc-marketplace.md`'s "Flagged
for owner review" addendum for the open question of whether to suppress the Lisa hook
on Copilot instead.

---

## 3. Reimplement skills are REAL and distributed

The v1 placeholder shells under `.claude/skills/parity-*` have been **replaced by real
Lisa-native reimplementations relocated to `plugins/src/base/skills/parity-*`**, where
they fan out via the #1050 plugin pipeline to every agent (Codex, agy, Copilot, Cursor,
Claude). The 7 root `.claude/skills/parity-*` scaffolds were deleted. Each skill that
maps to an upstream plugin publishing semver still carries its `synced-from` pin so
`plugin-parity-drift` tracks it against upstream.

| Skill (`plugins/src/base/skills/…`) | Pin status                                    |
| ----------------------------------- | --------------------------------------------- |
| `parity-code-simplifier`            | `code-simplifier@claude-plugins-official@1.0.0`     |
| `parity-coderabbit`                 | `coderabbit@claude-plugins-official@1.1.1`          |
| `parity-safety-net-rules`           | `safety-net@cc-marketplace@2.0.4`                   |
| `parity-sentry-seer`                | `sentry@claude-plugins-official@1.4.0` (reviewed, diverged) |
| `parity-sentry-sdk-setup`           | `sentry@claude-plugins-official@1.4.0` (reviewed, diverged) |
| `parity-code-review`                | **no pin** — upstream has no semver → not drift-trackable (track manually) |
| `parity-skill-creator`              | **no pin** — upstream has no semver → not drift-trackable (track manually) |

A pin marked **(reviewed, diverged)** means the skill was reviewed against that
upstream version and deliberately does not reimplement part of it; the skill body
carries the reasoning. `synced-from` is a single scalar and cannot express that
distinction, so the prose is the only place it exists — see the sentry skills, which
decline upstream 1.4.0's unnarrated onboarding progress-reporting protocol.

The `safety-net` Bash-guard **hook is now authored** as
`plugins/src/base/hooks/parity-safety-net.sh` and registered in
`plugins/src/base/.claude-plugin/plugin.json` as a `PreToolUse` matcher on `Bash`. The
companion `parity-safety-net-rules` skill views/sets/verifies the project-local custom
guard rules the hook enforces.

---

## 4. What IS shipped now

- **Sentry MCP re-point — real cross-agent delivery.** The sentry HTTP MCP is emitted
  from `plugins/src/base/.mcp.json`, which reaches **Codex, agy, Copilot, and Cursor**
  through their existing per-agent emission paths. This is the one component group with
  concrete, shipped cross-agent delivery.
- **7 real drift-tracked reimplement skills** under `plugins/src/base/skills/parity-*`
  (5 pinned, 2 intentionally unpinned), kept honest by `scripts/plugin-parity-drift.mjs`
  — whose default `--skills-root` now scans `plugins/src/base/skills` alongside
  `.claude/skills`.
- **All 7 routing artifacts approved** under `parity/plugin-routing/`:
  `code-review`, `code-simplifier`, `coderabbit`, `safety-net`, `sentry`,
  `skill-creator`, `typescript-lsp`.

---

## 5. `safety-net` 2.0 guard families NOT absorbed (deferred)

The 2026-08-11 re-pin to `safety-net@cc-marketplace@2.0.1` refreshed the pin and the
routing artifact but **did not absorb** the two guard families upstream introduced in
2.0.0. Both gaps were measured, not assumed — the probe table (upstream `explain`
verdicts beside live `parity-safety-net.sh` exit codes) is in
`parity/plugin-routing/safety-net@cc-marketplace.md`.

| upstream family | what it blocks | Lisa hook today |
| --------------- | -------------- | --------------- |
| `secret.*` | reading or copying SSH private keys, `.env` and `.env.*` files, AWS/gcloud credentials, coding-CLI credential stores, `.npmrc`, `*.key` | allows all |
| `rm.git-metadata` | deleting the `.git` control plane (the directory itself, `.git/hooks/*`) | allows |

**Why deferred rather than folded into the pin refresh.** This mirrors how the 1.0.6
refresh was sequenced: the pin bump landed first and the guard absorption followed as
its own tracked work (#1960) with a research audit and a fixture matrix. Two specifics
make `secret.*` more than a pin-refresh change:

- **It needs a new matcher surface.** `parity-safety-net.sh` is registered as a
  `PreToolUse` matcher on `Bash` only. Upstream 2.0 screens file tools as well, so the
  file-tool half of its coverage is unreachable from Lisa's hook without a registration
  change that ships to **every** downstream project.
- **It is a curated corpus, not a rule.** The family is a large path/basename/extension
  pattern set (nine distinct rule ids observed in a twelve-case probe alone), and a
  text-scan hook over-blocking on paths like `.env.example` would train users to work
  around the safety net — the exact failure mode the skill warns against.

`rm.git-metadata` is small and low-risk by comparison and is the natural first slice.

**Not yet decided:** whether to absorb these into `parity-safety-net.sh` or to reverse
#1960 and adopt upstream's native per-CLI integrations (2.0 ships an installer for
twelve agent CLIs, including Codex, Antigravity, Cursor, and Copilot CLI). The second
option would retire Lisa's own hook and is an owner-level standards call — see the
flagged addendum in `parity/plugin-routing/safety-net@cc-marketplace.md`.

## 6. `safety-net` upstream identity moved to `cc-safety-net` (re-pin pending review)

The `safety-net@cc-marketplace` plugin name is terminal at **1.0.6**: upstream's 2.x
line continues under the renamed **`cc-safety-net`** plugin (cache serves 2.1.1 as of
2026-08-24). The parity pin briefly said `2.0.4` — set while a cache still carried a
2.0.4 build under the old name — which made the drift gate read the skill as ahead of
a version the `safety-net` name no longer serves, blocking every push from a machine
with a refreshed cache. The pin and routing artifact were brought back to `1.0.6`,
the last version the old identity ships and the version the skill body's review text
actually describes.

**Follow-up (owner-level):** re-point the parity pin and routing artifact to the
`cc-safety-net@cc-marketplace` identity after a real 2.0.4 → 2.1.1 delta review. The
2.0.x engine analysis recorded in the routing artifact's component notes (canonical
command IR, `secret.*` and `rm.git-metadata` families, file-tool screening — see §5)
remains valid history and carries over to that review.

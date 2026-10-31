# Parity routing review — `code-review@claude-plugins-official`

- **Plugin:** `code-review@claude-plugins-official`
- **Upstream version:** `1.0.1`
- **Analyzed:** 2026-10-31 (re-analysis; first analysed 2026-05-30 as `unknown`)
- **Status:** `proposed` — re-analysis output. A human flips it to `approved` in a separate, visible edit before `implement-plugin-parity` may act on it. The routing validator and the drift detector accept either status, so this does not affect the push gate.

## Why this was re-analysed

The artifact was approved on 2026-05-30 with `upstreamVersion: "unknown"`, which
was correct then: the plugin cache held only `unknown` and git-hash directories,
and no manifest carried a `version`. Upstream later started publishing semver.
Once a `1.0.1` directory appeared in the cache, `scripts/plugin-routing-validate.mjs`
refused the artifact (`upstreamVersion "unknown" but the cache has semver 1.0.1`),
and because that validator runs in the pre-push gate, every push from a machine
with the current plugin cache was refused (CodySwannGT/lisa#4556).

## What was checked against 1.0.1

The cache's `1.0.1/` tree (`.claude-plugin/plugin.json`, `commands/code-review.md`,
`README.md`, `LICENSE`) was read and diffed against the `unknown/` snapshot.

- **Inventory:** unchanged — one command, no MCP, LSP, hooks, agents or skills.
  The manifest gained only `"version": "1.0.1"`.
- **Behaviour:** changed. The command now:
  1. prints the review to the terminal by default, and posts to the PR only with `--comment`;
  2. replaces the 0–100 confidence-scoring pass with a per-issue **validation** pass that
     drops anything it cannot confirm;
  3. applies an explicit **high-signal** bar — code that will fail to compile or parse,
     logic that is wrong regardless of input, or an instruction-file rule it can quote — and
     a do-not-flag list (style, input-dependent issues, subjective suggestions, pre-existing
     issues, linter-catchable issues);
  4. with `--comment`, posts each finding as an inline PR comment, with a committable
     suggestion only when it fully fixes the issue, through
     `mcp__github_inline_comment__create_inline_comment`;
  5. uses four reviewers instead of five (two instruction-file compliance, two diff-only bug
     hunters), dropping the git-history and prior-PR-comment reviewers.

## What changed in Lisa

`lisa-parity-code-review` (source `plugins/src/base/skills/lisa-parity-code-review/`)
now carries `synced-from: code-review@claude-plugins-official@1.0.1` and is
drift-tracked by `scripts/plugin-parity-drift.mjs`. It adopts (2) and (3) — every
candidate finding is re-checked against the code before it is reported, and the
high-signal bar governs the Critical and Warning tiers. (1) already matched: the
skill was always terminal-only. (4) and (5) are documented divergences in the skill
body: posting to a PR belongs to `lisa-pull-request-review`, and the skill is a
single reviewer over the local diff rather than a multi-agent pipeline, since the
non-Claude agents it serves have no common subagent surface.

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| command | `code-review` | `commands/code-review.md` | claude-command | Single slash command; no MCP/LSP/hooks/agents/skills. Re-analysed at 1.0.1 — inventory unchanged, behaviour changed (see above). |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - scaffold Lisa-native skill stamped synced-from: code-review@claude-plugins-official@1.0.1 | Codex has no plugin command surface and is not in the fan-out; reimplement as a Lisa skill. The skill already exists (lisa-parity-code-review) and was updated for 1.0.1's validate-before-report pass and high-signal bar. Upstream now publishes semver (1.0.1), so the reimplementation is drift-tracked by plugin-parity-drift instead of by manual review. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the command loads unchanged. |
| agy | `reimplement` | - scaffold Lisa-native skill stamped synced-from: code-review@claude-plugins-official@1.0.1 | Curated third-party plugins are not in agy's fan-out; reimplement as a Lisa skill. The skill already exists (lisa-parity-code-review) and was updated for 1.0.1's validate-before-report pass and high-signal bar. Upstream now publishes semver (1.0.1), so the reimplementation is drift-tracked by plugin-parity-drift instead of by manual review. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native pull-request/code-review capability in the project-scoped marketplace | Code review is a generic capability Copilot ships natively; prefer enabling over reimplementing. Re-checked against 1.0.1: the command is still a single PR-review command, so the vendor equivalent still fits. |
| devin | `reimplement` | - ship the Lisa-native skill in the lisa-devin variant, stamped synced-from: code-review@claude-plugins-official@1.0.1 | Devin installs Lisa's own lisa-devin plugin variant, which ships the Lisa-native reimplementation (lisa-parity-code-review); curated third-party Claude plugins are not part of Lisa's Devin install. Devin loads no plugin commands, so the command can only reach Devin as a skill. |

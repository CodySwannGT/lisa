# Lisa Console (UI prototype)

A self-contained, zero-build prototype of the Lisa settings console. It catalogs
every configuration surface Lisa exposes to host projects and presents it as a
navigable, editable-looking settings UI.

**Prototype scope:** every control is interactive (toggles, selects, inputs,
tabs, dirty-state tracking, save bar), but edits are not persisted — "Save"
only clears the in-memory dirty state. Reading real values IS wired up: see
`lisa ui` below.

## Run it

The real entrypoint is the CLI, which populates and syncs the project's
`.lisa.config.json` first (see `lisa sync`), then serves the console with the
merged live config injected — controls whose config key exists show the
project's actual values:

```bash
lisa ui [path] [--port 4780] [--no-sync]
```

The page is also fully standalone (no build step, no dependencies) — without
live config it falls back to Lisa's shipped defaults:

```bash
open ui/index.html
```

## Live status contract

When served by `lisa ui`, the page fetches `GET /api/status` from the same
loopback origin and renders each probe in a compact status strip. A probe has
exactly one of three states: a real `value`, `unknown` with both a
machine-readable reason and human-readable message, or `not-applicable`.
Throwing and timing-out probes degrade independently to `unknown`, so one
unavailable integration cannot block the page or cause a value to be invented.
Concurrent requests share one in-flight snapshot. In-process probes must be
asynchronous and cooperate with the supplied abort signal; JSON depth and size
budgets also bound result normalization. The first reference probe scopes
`gh auth status --active` to the project's origin hostname. The Automations
section reads the harness scheduler through the `automations` probe (Codex
`~/.codex/automations/` or an injected Claude `/schedule` listing), matching
only `lisa-auto-<project>-*` jobs and never fabricating demo rows when the
scheduler is absent or unreadable.

## Config sync (`lisa sync`)

`lisa sync [path] [--dry-run] [--json]` makes `.lisa.config.json` (with the
gitignored `.lisa.config.local.json` overlay) the source of truth for every
setting in `src/sync/registry.ts`:

- **Populate** — a completely missing config value is absorbed from its
  mirrored artifact file when one exists (e.g. `vitest.thresholds.json`),
  otherwise filled with Lisa's built-in default. Vendor sections are only
  populated when the project uses that vendor.
- **Sync** — config values are written back into every mirrored artifact file
  that exists on disk (config wins). Sync never scaffolds an artifact file
  into a stack that doesn't use it.
- **Provenance** — pure-default populations are recorded under
  `_lisaSync.populated`, so when a later Lisa version changes a default, sync
  can update values that are *still the default* while never touching values
  a human chose.
- **Required keys** (`tracker`, `jira.project`, `github.org`, …) can't be
  invented; sync reports them (exit code 1) and points at the setup skill.

Mirrored artifacts today: `vitest.thresholds.json` / `jest.thresholds.json`
(`quality.testCoverage`), `eslint.thresholds.json` (`quality.lintBudgets`),
`mutation.gate.json` (`quality.mutation.gate`), and the `thresholds` key of
`stryker.conf.json` (`quality.mutation.strykerThresholds`).

**Provider-neutral monitoring keys.** The observability audit spans Sentry,
AWS CloudWatch Alarms, AWS X-Ray, and future providers, so
`monitor.thresholds` uses vendor-free names: `minEvents24h` (default **1**)
and `faultRatePct` replace the legacy `sentryMinEvents24h` /
`xrayFaultRatePct`. The Monitoring section shows which providers are
connected (detected from credentials and instrumentation, not configured by
hand). `lisa sync` migrates a legacy monitor block when provenance proves Lisa
auto-populated the old default, while leaving human-chosen legacy values
untouched. The runtime keeps accepting those deprecated aliases, prefers the
provider-neutral key when both are present, and `lisa doctor` warns until a
project finishes migrating.

## Starter provenance & sync (planned — documented, not wired)

The **Starter templates** section of the console documents this contract; no
engine exists yet. A project records which starter repo(s) it was generated
from (`lisa setup-project` already knows them — `src/cli/starters.ts`) and
stays connected to them in both directions:

```jsonc
"starter": {
  "templates": [
    {
      "repo": "CodySwannGT/expostarter",   // origin starter
      "ref": "main",                        // ref compared on each sync
      "lastSync": { "sha": "8c1f2ab", "at": "2026-07-01" },
      "paths": ["**"]                       // optional glob scope
    }
  ],
  "sync": {
    "auto": false,                          // scheduled sync via a lisa-auto cron
    "strategy": "pull-request",             // or "direct-when-clean"
    "upstreamProposals": true,              // open issues in the starter repo
    "proposalLabel": "starter-upstream-proposal"
  }
}
```

**Downstream sync (starter → project).** A sync diffs the starter's tracked
ref since `lastSync.sha` and applies the changes to the host project,
respecting Lisa template semantics (create-only files the project now owns
are never clobbered; a `paths` scope limits what applies). Clean applications
land per `strategy`; conflicts always open a PR. `lastSync` is updated after
every successful run. Multiple templates are supported — e.g. an app starter
plus an infrastructure starter, each with its own path scope.

**Upstreaming (project → starter).** During a sync (or a standalone scan),
Lisa looks for *generic* additions the host project made — shared utilities,
dependency/security bumps, CI workflow fixes, config hardening with no
project-specific identifiers — and opens an issue in the starter repo,
labeled `proposalLabel`, containing detailed instructions on what was changed
and how to apply it to the starter. Anything referencing project names,
product features, secrets, or business logic is never proposed.

When the engine lands, `starter.*` should join the `lisa sync` registry so
the section above governs it like every other setting.

## Health (shared skill and CLI available)

The **Health** section answers two questions with different lifecycles. Health
v1 now ships its shared result and persistence contract, deterministic fast
path, harness-neutral optional agentic composition API at
`@codyswann/lisa/health`, `lisa health` CLI, and `/lisa:health` skill across all
six supported harnesses. Completed results are validated and atomically stored
at the gitignored `.lisa/health/latest.json`; `health.schedule` is the only v1
configuration key and accepts `off`, `daily`, or `weekly`. The console button,
readback, and scheduler remain downstream work.

**Is Lisa on the latest version?** — always-on status. Lisa's CLI already
checks npm on every invocation; the console surfaces the result permanently
as the top-bar chip (green dot `up to date`, amber when behind) and in the
Health section's version card. When behind, `lisa update` prints (or runs
with `--yes`) the package-manager update command.

**Is the project completely in band?** — on-demand scan behind the
"Run health check" button (plus an optional scheduled cadence via
`health.schedule` that files a ticket when drift is found). "In band" means
every Lisa-managed surface matches what the installed Lisa version would
emit. The check is a mix of deterministic and agentic verification,
packaged as one `/lisa:health` skill backed by the `lisa health` CLI so the
CLI and every coding-agent harness share one implementation; downstream
console and cron integrations can reuse it:

- **Deterministic layer** (fast, exact — reuses what exists today):
  `lisa doctor`, template diffing for copy-overwrite/managed-block files,
  `package.json` governance (force/defaults/merge conformance),
  `lisa sync --dry-run` (config fully populated, artifacts in sync), git
  hooks installed and unmodified, plugins enabled and version-current, CI
  workflow drift vs the stack template, rulesets present.
- **Optional agentic composition** (judges what a diff can't): whether local overrides
  (`eslint.config.local.ts`, grandfathered globs) still serve their original
  purpose, whether detected drift looks intentional or accidental, whether
  skipped CI jobs and disabled gates have a recorded justification. The
  shipped composition API accepts an injected evaluator. The skill uses a
  digest-bound prepare/finalize protocol: preparation emits only bounded
  evidence and writes nothing, the current harness judges that envelope, and
  finalization revalidates the evidence digest before persisting one final
  result.

The downstream console will render results as a per-check table (pass / warn /
fail, with the layer that produced each finding) and keep the last full check's
date and verdict visible in the section.

### Remote-environment requirements

The console derives required remote-environment variables from the active
tracker/source, detected project types, and integration signals in the host
project. Projects can extend or override startup-artifact discovery with
`.lisa/remote-environment.json`:

```json
{
  "variables": [
    {
      "name": "PROJECT_API_TOKEN",
      "reason": "Project-specific service access",
      "secret": true,
      "required": true
    }
  ],
  "startupScripts": {
    "claude": "scripts/claude-remote-setup.sh",
    "codex": "scripts/codex-remote-setup.sh"
  }
}
```

Only required entries are displayed. Secret values are never read into the
browser payload; the server exposes names and boolean presence only.

## What it catalogs

| Section | Source of truth in this repo |
| --- | --- |
| Setup checklist (install → sync → tracker/PRD → repo governance → secrets → automations) | `lisa apply`, `lisa sync`, `/lisa:setup:*` skills |
| Health (version status + in-band scan) | `lisa doctor`, `lisa sync --dry-run`, `lisa health`, `/lisa:health` skill |
| Core workflow (the delivery-loop slash commands and their automations) | `plugins/src/base/commands/lisa/`, `plugins/src/base/skills/` |
| Starter templates (provenance + planned two-way sync) | `src/cli/starters.ts`, planned `starter.*` config |
| General (`harness`, `tracker`, `source`, `repo`, package manager) | `src/core/config.ts`, `plugins/src/base/rules/reference/config-resolution.md` |
| Project types (8 stacks + template strategies) | `src/detection/`, `src/strategies/`, `<stack>/` template dirs |
| Coding agents (claude/codex/cursor/agy/copilot/opencode/fleet) | `src/core/lisa.ts`, `scripts/generate-*-plugin-artifacts.mjs` |
| Remote Environment (project-aware variable presence + active-agent startup scripts) | `src/cli/remote-environment.ts`, `.lisa/remote-environment.json`, detected config/types/integrations |
| Work tracker (JIRA / GitHub Issues / Linear) | `config-resolution.md`, `lisa-setup-*` skills |
| PRD source (Notion / Confluence / Linear / GitHub) | `config-resolution.md`, `lisa-setup-*` skills |
| Deploy & environments (`deploy.*`, `github.environments`) | `scripts/lisa-github-environments.sh` |
| Automations (intake/repair/exploratory crons) | `lisa-setup-automations` skill |
| Intake & monitoring thresholds | `.lisa.config.json` `intake.*` / `monitor.*` |
| Linting (custom plugins, budgets, oxlint, ast-grep) | `eslint-plugin-*/`, `src/configs/eslint/`, `sgconfig.yml` |
| Testing & coverage (runners, floors, mutation gates) | `src/configs/{vitest,jest}/`, `*.thresholds.json` |
| Git hooks (Husky / Lefthook) | `typescript/copy-contents/.husky/`, `rails/copy-overwrite/lefthook.yml` |
| CI quality gates (quality.yml jobs + inputs) | `.github/workflows/quality.yml` |
| Verification & QA (exploration mutation policy, ZAP) | `lisa-use-the-product` skill |
| GitHub repository (settings, rulesets, labels, secrets) | `scripts/lisa-github-repo-setup.sh`, `all/github-rulesets/` |
| Plugins & MCP (Lisa + curated third-party + servers) | `.claude/settings.json`, `plugins/src/` |
| Advanced (wiki source, usage pricing, Play Store) | `config-resolution.md` |

Values shown are Lisa's real defaults (as of the version in the top bar), with
a fictional demo project (`acme/acme-app`, typescript + expo, JIRA + Notion)
supplying example identifiers.

## Implementation notes

- Single `index.html`: inline CSS (token-based light/dark theming with a
  manual toggle) and vanilla JS. The catalog lives in a declarative `DATA`
  structure at the top of the script; rendering is generic per block type
  (`card`/`rows`, `table`, `tabs`, `stacks`, `hooks`, `flow`, `tiles`,
  `callout`), so adding a setting is a data edit, not a DOM edit.
- Search box filters rows/cards within the active section.
- URL hash routes to a section (e.g. `ui/index.html#linting`).

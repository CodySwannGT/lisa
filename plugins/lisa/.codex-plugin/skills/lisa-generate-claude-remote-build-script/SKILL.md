---
name: lisa-generate-claude-remote-build-script
description: "Generate the setup/build script…"
allowed-tools: ["Skill", "Bash", "Read", "Write", "Glob", "Grep"]
---

# Generate Claude Remote Build Script: $ARGUMENTS

Produce the artifacts a user pastes into a **Claude Code remote routine environment** so this repo
runs in the cloud: a setup/build script that installs everything the environment needs, an
environment-variable template, a network-allowlist list, and the names-only
`.lisa/remote-environment.json` contract consumed by `lisa ui`.

## Purpose

A routine's cloud environment lets you configure a **setup script** (runs once, cached) and
**environment variables**. This skill turns the read-only inventory from
`/lisa:analyze-claude-remote` into those concrete artifacts so the user doesn't hand-assemble them.

This skill ships in the base Lisa plugin and is distributed to every host project, so the generated
script must reflect **what this repo actually needs** — Lisa's startup hooks and configured
tracker/source, plus the host project's own package manager and tooling — not a hardcoded list.

## Inputs

- Optional flags in `$ARGUMENTS`:
  - `--out=<path>` — where to write the script. Default `scripts/claude-remote-setup.sh`.
  - `--include-optional` — also install `OPTIONAL` (dormant-stack) tools. Default: required only.
  - `--print` — print the script to stdout instead of writing a file.

## Procedure

1. **Inventory.** Invoke `/lisa:analyze-claude-remote --json` and parse its machine-readable
   inventory block (`packageManager`, `tools`, `env`, `mcp`, `gaps`, `platform`,
   `networkAccess`, `allowlistDomains`, `awsProfiles`). If the analysis cannot run, stop and report why — never
   emit a script from guesses.

2. **Compose the setup script** from the inventory. The script must be:
   - **Idempotent & detect-before-install** — every install guarded by a `command -v <tool>` check
     so re-runs are no-ops and already-present tools are skipped.
   - **Fast** — fits the ~5-minute environment-cache budget; avoid heavyweight installs unless
     `REQUIRED`. Long/optional installs (docker images, chromium, ruby) go in a clearly-marked
     optional section gated by `--include-optional`.
   - **PATH-correct** — export the package manager's bin dir (e.g. `$HOME/.bun/bin`) after install
     so subsequent steps and the cached environment resolve it.
   - **Cloud-proxy aware** — when the package manager is flagged `RISK` (bun), add a comment
     documenting the known proxy package-fetch issue and, where safe, run the install with retries
     so a transient proxy failure doesn't poison the cache. Do not silently swap package managers if
     `engines` forbids it; surface the risk as a comment instead.
   - **Non-fatal on optional tools** — `REQUIRED` tool failures should exit non-zero (so the env
     build fails loudly); `OPTIONAL` tool failures should warn and continue.

3. **Emit the environment-variable template.** Write a commented block listing every `env` entry
   from the inventory grouped by integration, marked `REQUIRED`/`OPTIONAL` and `secret`/`plain`,
   with the reason. **Never write real secret values** — only names and placeholders, because the
   environment config is visible to anyone who can edit it. Entries flagged `providedBy: settings.json`
   (the committed `.claude/settings.json` `env` flags, e.g. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) are
   **already applied from the committed file** — list them under an `# Already provided by committed
   .claude/settings.json — no UI entry needed` heading, not as values to set. The "set in the
   environment UI" template is for **secrets only**. For every secret entry that carries
   `acquireUrl`/`accessScope`/`headlessSubstrate` (the
   active tracker/source credentials from the analysis's group 4a), render those as comment lines
   directly above the name — `# Acquire: <url>` and `# Access: <scope>` — so the user knows exactly
   where to get the token and what permissions it needs. Emit only the **env-var form** of the name
   that the analysis reported (including any per-account suffixed form like `LINEAR_API_KEY_<slug>`);
   never emit a keychain instruction — keychain does not exist in a cloud routine.
   When the entry is `GH_TOKEN`, add a comment from `platform.githubProxy` clarifying that the token
   is for `gh` CLI commands against the project/Lisa repos, not for raw git clone/fetch/push or
   sibling repos reachable through the routine's GitHub proxy.
   For OPTIONAL non-tracker MCP recovery entries discovered by
   `/lisa:analyze-claude-remote`, preserve the same names-only behavior:
   include `JAM_PAT`, `SONARQUBE_TOKEN` (+ `SONARQUBE_ORG`/`SONARQUBE_URL`), or
   similar documented substrate env vars only as optional secrets, with their
   acquire/scope comments when the analysis supplied them. Never invent values or promote dormant substrates to required.
   When AWS entries are present, list only `LISA_AWS_BOOTSTRAP_JSON` as the
   required secret and `LISA_REMOTE_AGENT=claude` as plain configuration. Never
   emit standard `AWS_ACCESS_KEY_ID` variables and never recommend `aws sso login`.

3a. **Emit substrate setup snippets.** When the inventory marks an MCP
   `headlessUsable: true` through a documented substrate, render the matching
   wiring guidance as commented, opt-in setup:
   - CLI substrates: emit the detected install/login commands gated on the
     optional env var. For Jam, this means `curl -fsSL https://native.jam.dev/install | bash`,
     `export PATH="$HOME/.local/bin:$PATH"`, `printf '%s' "$JAM_PAT" | jam auth login --token`,
     and `jam skills install`, all inside `[ -n "${JAM_PAT:-}" ] && ...` guards so missing
     optional secrets do not fail the environment build.
   - Container-backed MCP substrates (e.g. the official SonarQube MCP): the MCP
     runs headless as-is in a cloud routine — Docker is preinstalled — so wire the
     real MCP rather than substituting REST. Emit, guarded on the optional env
     token, the vendor CLI install (`curl -o- https://raw.githubusercontent.com/SonarSource/sonarqube-cli/refs/heads/master/user-scripts/install.sh | bash`),
     `sonar integrate <agent>`, and a `sonar run mcp`-image pre-pull so the first
     run fits the ~5-min cache budget. Provide `SONARQUBE_TOKEN`
     (+ `SONARQUBE_ORG`/`SONARQUBE_URL`); never emit `sonar auth login` (keychain
     does not exist headless).
   - REST-only substitute substrates: for a vendor whose MCP genuinely cannot run
     headless, do not install an MCP — emit comments naming the REST host and env
     var, and rely on the access skill or generated consumer to call the API.
   - PAT-bearer MCP substrates: print a commented `.mcp.json` `headers` snippet from the
     inventory's `mcpHeaders`. Use this only when the analysis explicitly says the same MCP
     transport supports static-token auth. Do not print a Jam `.mcp.json` header snippet because
     Jam's preferred headless substrate is its PAT-authenticated CLI.

3b. **Install the shared AWS bootstrap.** When AWS is present, invoke
   `/lisa:setup-remote-aws --platform=claude`. Reuse the resulting
   `scripts/remote-agent-aws-setup.sh`; do not generate a second credential or
   profile implementation. Add `bash scripts/remote-agent-aws-setup.sh` to the
   generated cloud setup after required package installation.

3c. **Write the project-aware console contract.** Write
   `.lisa/remote-environment.json` from the same fresh inventory. Its `variables`
   array must contain only entries that are `required: true` for this project and
   its active integrations; omit optional, conditional, and dormant integrations.
   Each entry contains `name`, `reason`, `source`, `secret`, and `required`, but
   never a value. Set `startupScripts.claude` to the generated `--out` path. Do
   not add AWS merely because Lisa ships AWS support: add
   `LISA_AWS_BOOTSTRAP_JSON` only when the inventory reports active AWS usage.
   Preserve any valid startup-script entries for other agents that already exist
   in the manifest.

4. **Emit the allowlist + gaps notice.** List any custom domains the setup or runtime reaches
   (from `networkAccess.allowlistDomains`, falling back to legacy `allowlistDomains`) that the user
   must add when the environment needs Custom network access. Do not include default Trusted domains
   such as GitHub, npm/PyPI registries, or Docker Hub. Echo the `gaps` from the analysis
   (auto-memory not synced, interactive-auth/stdio-MCP unavailable, etc.) and the
   `platform.secretsVisibility` warning as a header comment so the user knows what the script
   **cannot** fix.

5. **Write and report.** Write the script to `--out` (default `scripts/claude-remote-setup.sh`),
   `chmod +x` it, and write `.lisa/remote-environment.json`. Print both paths, a
   one-line summary of what the script installs and which env vars to set, and
   the exact next step (paste its contents — or a
   `bash scripts/claude-remote-setup.sh` invocation — into the routine
   environment's setup script, and add the env vars in the environment config).
   When `--print` is passed, print the script to stdout and do not write either
   file.

## Generated script shape

The emitted script should follow this skeleton (populated from the live inventory — this is the
shape, not a fixed payload):

```bash
#!/usr/bin/env bash
# Claude Code remote-routine setup for <repo>. Generated by /lisa:generate-claude-remote-build-script.
# Paste into your routine environment's setup script. Re-runnable and idempotent.
#
# GAPS this script cannot fix (configure separately):
#   - <gaps from analysis, e.g. auto-memory is machine-local and not synced to cloud routines>
# Already provided by committed .claude/settings.json (applied automatically — no UI entry needed):
#   - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, ENABLE_LSP_TOOL, BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS
# SECRETS to set in the environment config (names only — set real values there, not here):
#   # --- credentials for the active tracker/source (set in the environment UI) ---
#   # Acquire: https://github.com/settings/personal-access-tokens
#   # Access:  fine-grained PAT on target repo: Contents R/W, Issues R/W, Pull requests R/W, Metadata R
#   # Note: GH_TOKEN is for gh CLI only. Raw git uses Claude's connected-GitHub proxy/identity;
#   # sibling repos reached only by raw git do not need to be in this token scope.
#   - GH_TOKEN=<token>                          # REQUIRED, github is the active tracker+source
#   - LISA_AWS_BOOTSTRAP_JSON=<complete SecretString> # REQUIRED for AWS
# PLAIN:
#   - LISA_REMOTE_AGENT=claude
# NETWORK: set the environment to Custom and allowlist these non-default domains if not on Full:
#   - <networkAccess.allowlistDomains, if any>
set -uo pipefail

need() { command -v "$1" >/dev/null 2>&1; }
require() { need "$1" || { echo "FATAL: required tool '$1' missing and install failed" >&2; exit 1; }; }

# --- package manager (REQUIRED) ---
# Resolve the PM from packageManager/engines/lockfiles — emit the manager the
# `packageManager` inventory field reported, NEVER a hardcoded bun. An npm-only
# project (engines.bun = "please-use-npm") must install with npm; emitting
# `bun install` would create a stray bun.lock and break it (the SE-5221
# regression). Only install/PATH-export the manager actually selected below.
detect_package_manager() {
  _field="" _forced="" _forbidden=""
  if [ -f package.json ] && command -v jq >/dev/null 2>&1; then
    _field=$(jq -r '(.packageManager // "") | sub("@.*$";"")' package.json 2>/dev/null)
    _forced=$(jq -r 'first((.engines // {})[] | strings | capture("please-use-(?<pm>bun|npm|yarn|pnpm)")?.pm) // ""' package.json 2>/dev/null)
    _forbidden=$(jq -r '[(.engines // {}) | to_entries[] | select(((.value|strings) // "") | test("please-use|do-not-use";"i")) | .key] | join(" ")' package.json 2>/dev/null)
  fi
  case "$_field" in bun | npm | yarn | pnpm) printf '%s\n' "$_field"; return 0 ;; esac
  case "$_forced" in bun | npm | yarn | pnpm) printf '%s\n' "$_forced"; return 0 ;; esac
  _pm_allowed() { case " $_forbidden " in *" $1 "*) return 1 ;; *) return 0 ;; esac; }
  { [ -f bun.lockb ] || [ -f bun.lock ]; } && _pm_allowed bun && { printf 'bun\n'; return 0; }
  [ -f pnpm-lock.yaml ] && _pm_allowed pnpm && { printf 'pnpm\n'; return 0; }
  [ -f yarn.lock ] && _pm_allowed yarn && { printf 'yarn\n'; return 0; }
  [ -f package-lock.json ] && _pm_allowed npm && { printf 'npm\n'; return 0; }
  printf 'npm\n'
}
PM="$(detect_package_manager)"
if [ "$PM" = "bun" ] && ! need bun; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
# NOTE: bun has known proxy package-fetch issues in cloud sessions; retry to survive transient proxy errors.
for i in 1 2 3; do "$PM" install && break || sleep 5; done

# --- required CLIs ---
need gh || (sudo apt-get update -y && sudo apt-get install -y gh)
need jq || sudo apt-get install -y jq
require gh; require jq

# --- AWS assume-role profiles, when AWS inventory is active ---
bash scripts/remote-agent-aws-setup.sh

# --- optional, only with --include-optional ---
# (docker / ruby / chromium / etc., guarded)
```

## Confirmation policy

Writing the script file is the deliverable — do not ask whether to proceed. Default to writing
`scripts/claude-remote-setup.sh`, then report the path and next steps. The only legitimate reasons
to stop are: the analysis could not run, or the `--out` path is not writable.

## Rules

- Always derive the script and `.lisa/remote-environment.json` from a fresh
  `/lisa:analyze-claude-remote` run — never from a stale or assumed inventory.
- Never write real secret values into the script or template — names and placeholders only.
- For active tracker/source credentials, carry the analysis's `Acquire:` URL and `Access:` scope into
  the template as comments, and emit only the env-var form of the name — never a keychain command.
- For `GH_TOKEN`, preserve the analysis's GitHub proxy split: it is for `gh` CLI commands only, and
  raw git/cross-repo clone guidance must not expand the token scope to sibling repositories.
- Never emit an install for a tool the analysis did not surface, and never install `OPTIONAL` tools
  unless `--include-optional` is set.
- When AWS is in the inventory, reuse `/lisa:setup-remote-aws` and its shared
  setup script; never emit a second profile implementation or `aws sso login`.
- Prefer `networkAccess.allowlistDomains` over legacy top-level `allowlistDomains`; never emit
  domains already covered by the routine environment's default Trusted list.
- Keep the script idempotent and detect-before-install so it is safe to re-run and cache.
- Preserve the inventory's `REQUIRED` vs `OPTIONAL` distinction in both fail-behavior (fatal vs
  warn) and section placement.
- Surface, never hide, the `gaps` — a generated script must not imply it makes a repo fully
  cloud-ready when known constraints remain.

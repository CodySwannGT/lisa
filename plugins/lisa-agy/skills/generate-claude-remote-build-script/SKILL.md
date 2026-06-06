---
name: generate-claude-remote-build-script
description: "Generate the setup/build script (and env-var template) to paste into a Claude Code remote routine environment so this repo runs in the cloud. Runs /lisa:analyze-claude-remote to inventory needs, then writes an idempotent, detect-before-install bash script that installs the required CLIs/binaries and package manager for both Lisa and the host project, plus a commented environment-variable template (names only, never real secrets) and a list of custom domains to allowlist. The script is fast (fits the ~5-minute environment-cache budget), re-runnable, and cloud-proxy aware."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Glob", "Grep"]
---

# Generate Claude Remote Build Script: $ARGUMENTS

Produce the artifacts a user pastes into a **Claude Code remote routine environment** so this repo
runs in the cloud: a setup/build script that installs everything the environment needs, plus an
environment-variable template and a network-allowlist list.

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
   inventory block (`packageManager`, `tools`, `env`, `mcp`, `gaps`, `allowlistDomains`). If the
   analysis cannot run, stop and report why — never emit a script from guesses.

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

4. **Emit the allowlist + gaps notice.** List any custom domains the setup or runtime reaches
   (from `allowlistDomains`) that the user must add to the environment's network access, and echo
   the `gaps` from the analysis (auto-memory not synced, interactive-auth/stdio-MCP unavailable,
   etc.) as a header comment so the user knows what the script **cannot** fix.

5. **Write and report.** Write the script to `--out` (default `scripts/claude-remote-setup.sh`),
   `chmod +x` it, and print: the path, a one-line summary of what it installs and which env vars to
   set, and the exact next step (paste its contents — or a `bash scripts/claude-remote-setup.sh`
   invocation — into the routine environment's setup script, and add the env vars in the
   environment config). When `--print` is passed, print to stdout and do not write a file.

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
#   - GH_TOKEN=<token>                          # REQUIRED, github is the active tracker+source
# NETWORK: allowlist these domains in the environment if not on full access:
#   - <allowlistDomains, if any>
set -uo pipefail

need() { command -v "$1" >/dev/null 2>&1; }
require() { need "$1" || { echo "FATAL: required tool '$1' missing and install failed" >&2; exit 1; }; }

# --- package manager (REQUIRED) ---
if ! need bun; then
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"
# NOTE: bun has known proxy package-fetch issues in cloud sessions; retry to survive transient proxy errors.
for i in 1 2 3; do bun install && break || sleep 5; done

# --- required CLIs ---
need gh || (sudo apt-get update -y && sudo apt-get install -y gh)
need jq || sudo apt-get install -y jq
require gh; require jq

# --- optional, only with --include-optional ---
# (docker / ruby / chromium / etc., guarded)
```

## Confirmation policy

Writing the script file is the deliverable — do not ask whether to proceed. Default to writing
`scripts/claude-remote-setup.sh`, then report the path and next steps. The only legitimate reasons
to stop are: the analysis could not run, or the `--out` path is not writable.

## Rules

- Always derive the script from a fresh `/lisa:analyze-claude-remote` run — never from a stale or
  assumed inventory.
- Never write real secret values into the script or template — names and placeholders only.
- For active tracker/source credentials, carry the analysis's `Acquire:` URL and `Access:` scope into
  the template as comments, and emit only the env-var form of the name — never a keychain command.
- Never emit an install for a tool the analysis did not surface, and never install `OPTIONAL` tools
  unless `--include-optional` is set.
- Keep the script idempotent and detect-before-install so it is safe to re-run and cache.
- Preserve the inventory's `REQUIRED` vs `OPTIONAL` distinction in both fail-behavior (fatal vs
  warn) and section placement.
- Surface, never hide, the `gaps` — a generated script must not imply it makes a repo fully
  cloud-ready when known constraints remain.

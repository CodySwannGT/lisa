---
name: analyze-claude-remote
description: "Audit whether the current repository can run as a Claude Code remote routine (cloud session). Read-only analysis that inventories what Lisa AND the host project need to configure or build in the cloud environment — external CLIs/binaries to install, environment variables and secrets to set, startup hooks and their headless-safety, MCP server scope/transport/auth, user-scoped config and auto-memory gaps that don't replicate to the cloud, and platform constraints (bun proxy, IP allowlist, network tier, no interactivity). Emits grouped findings plus a machine-readable inventory that /lisa:generate-claude-remote-build-script consumes."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Analyze Claude Remote: $ARGUMENTS

Run a read-only audit of whether **this repository can run as a Claude Code remote routine**
(a cloud session that runs on Anthropic-managed infrastructure, not the user's machine), and
inventory everything that would have to be **installed** or **configured** in the cloud
environment for both Lisa and the host project to function.

## Purpose

Claude Code routines run in a fresh cloud environment that clones the repo from its default
branch. Setup scripts (to install tools) and environment variables (to provide config/secrets)
are configurable per environment — but **only repo-committed Claude Code config reaches the
cloud**, user-scoped config and machine-local auto-memory do not, and some local affordances
(interactive auth, stdio MCP, desktop control, statusline) cannot work headless at all.

This skill produces the answer to: *"If I turn this repo into a routine, what do I need to put
in the environment's setup script and env vars, and what simply won't work?"* It is the
read-only analysis half; `/lisa:generate-claude-remote-build-script` turns its inventory into an
actual setup script.

This skill ships in the base Lisa plugin and is distributed to every host project, so it must
discover requirements **dynamically from the repo** rather than assuming Lisa-repo specifics. It
audits two layers together:

- **Lisa's needs** — startup hooks (`install-pkgs.sh`, `setup-jira-cli.sh`, rule injection),
  the configured `tracker`/`source`, and the CLIs/MCP/env those imply.
- **The host project's needs** — its own package manager, build/test tooling, app runtime
  dependencies, CI-assumed binaries, and project-scoped MCP servers.

## Inputs

- Optional flags in `$ARGUMENTS` to narrow scope (e.g. `--section=tools`, `--json` to print only
  the machine-readable inventory).
- The current repository root: `.claude/settings.json`, enabled plugins' `hooks/hooks.json`,
  `.mcp.json`, `.lisa.config.json` / `.lisa.config.local.json`, `package.json` (or other
  manifest), lockfiles, `scripts/`, `.github/workflows/`, and committed skills/commands/hooks.

## Confirmation policy

Do **not** ask whether to proceed. Once invoked, run the read-only audit, print the grouped
findings and the inventory, and stop. Do not mutate any repository, environment, tracker, or
automation state. The only legitimate reason to stop early is that the working directory cannot
be resolved to an inspectable repository root.

## Audit contract

Report grouped sections, each check tagged with one status:

- `REQUIRED` — must be installed/set or a routine run cannot do core work.
- `OPTIONAL` — needed only for a specific integration/stack that is dormant in this repo's config.
- `GAP` — works locally but **cannot** work in a cloud routine regardless of configuration;
  the user must change approach (e.g. promote a fact to a repo rule, switch a substrate).
- `OK` — already cloud-safe; nothing to do.
- `RISK` — likely to work but with a known cloud caveat the user should verify (e.g. bun proxy).

Group the findings as:

1. **Runtime & package manager** — resolve the package manager from `packageManager`, `engines`,
   and the lockfile. Identify the install command a `SessionStart` hook or the project would run.
   Flag `bun` as `RISK` (known cloud-proxy package-fetch issues) and note whether `engines`
   forbids fallback package managers. Confirm node/runtime version expectations.

2. **Startup hooks** — enumerate `SessionStart` and `SubagentStart` hooks from
   `.claude/settings.json` and every enabled plugin's `hooks/hooks.json`. For each, state what it
   runs, whether it is headless-safe, whether it needs network or write access to system paths,
   and whether it fits the cloud setup-script time budget (~5 minutes for environment caching;
   `SessionStart` hooks re-run every session and must be fast). Lisa's `install-pkgs.sh` and
   `setup-jira-cli.sh` are the usual headline items.

3. **External CLIs / binaries** — scan hooks, `scripts/`, committed skills/commands, and
   `.github/workflows/` for invoked binaries that a base cloud image likely lacks. Assume node,
   git, and coreutils are present; `gh` is available but should be installed explicitly if scripts
   call it. Classify each `REQUIRED` (core path uses it) vs `OPTIONAL` (only a dormant stack/skill
   uses it). Typical finds: `gh`, `jq`, `docker` (ZAP), `aws`, `acli`, `ruby`/`rubocop`,
   `python3`, `playwright`/chromium, secret scanners.

4. **Environment variables & secrets** — scan for `process.env.*`, `${VAR}`/`$VAR` in shell,
   `secrets.*`/`env:` in CI, and config-referenced tokens. Group by integration (GitHub, AWS,
   Atlassian/JIRA/Confluence, Notion, Linear, Anthropic, notifications, feature flags, other).
   Cross-reference `.lisa.config.json` `tracker`/`source` to mark which credentials are **active**
   for this repo vs **dormant** (`OPTIONAL`). Always surface Claude Code feature flags actually set
   in `.claude/settings.json` (e.g. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`) as `REQUIRED` to match
   local behavior, since the environment `env` block is the reliable place to set them.

5. **MCP servers** — read every committed `.mcp.json`. For each server report transport and auth.
   Project-scoped HTTP/SSE servers are `OK`. Flag stdio servers as `RISK`/`GAP` (need a local
   process — only viable if the cloud session can spawn them from the repo). Flag
   interactively/OAuth-authed servers (e.g. Linear) as `GAP` for first-time auth — they cannot
   complete a browser flow headless. Note any user-scoped MCP (`~/.claude.json`) as `GAP` — it
   never reaches the cloud; it must be moved into project `.mcp.json`.

6. **Config scope & memory gaps** — identify reliance on user-scoped config that will not load
   remotely: `~/.claude/CLAUDE.md`, user `enabledPlugins`, user skills/agents, user MCP. Most
   importantly, flag **auto-memory** as a `GAP`: the persistent file-based memory directory is
   machine-local and is not synced to cloud routines, so any learnings stored there are absent in
   a remote run. Recommend promoting load-bearing memories into committed `.claude/rules/`.

7. **Platform constraints** — surface the non-config constraints as `GAP`/`RISK` so the user is
   not surprised: routines run with no interactive permission prompts and cannot ask the user
   mid-run; interactive auth (SSO/OAuth browser, keychain) is unavailable; GitHub org IP
   allowlisting blocks cloud sessions; outbound traffic is proxied and custom domains need
   allowlisting; resource limits (~4 vCPU / 16 GB RAM / 30 GB disk); no desktop/computer-use; no
   statusline/theme rendering.

8. **Host-project app needs** — note any build/test/run command a routine would invoke and any
   runtime service it depends on (database, queue, external API) that will not exist in a fresh
   cloud environment, so the user can decide whether the routine's task is even feasible there.

## Output

Render the report grouped exactly as above. Start with one `Summary:` line, then a `Counts:` line
covering `REQUIRED`, `OPTIONAL`, `GAP`, `RISK`, `OK`. Print each group as `<n>. <title>` and one
line per check as `- <STATUS> <id>: <summary>`, with optional `Observed:` and `Action:` lines
beneath that separate fact from advice. Render an empty group as a single `OK`/`SKIP` line with the
reason rather than omitting it.

End with a fenced, machine-readable inventory block (also printed when `--json` is passed) so
`/lisa:generate-claude-remote-build-script` can consume it without re-deriving everything:

```json
{
  "packageManager": { "name": "bun", "installCmd": "bun install", "risk": "cloud-proxy" },
  "tools": [
    { "name": "gh", "required": true, "reason": "github-* skills and scripts shell out to gh" },
    { "name": "jq", "required": true, "reason": "hooks and scripts parse JSON" }
  ],
  "env": [
    { "name": "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "required": true, "secret": false, "reason": "set in .claude/settings.json" },
    { "name": "GH_TOKEN", "required": false, "secret": true, "reason": "gh CLI auth beyond the routine's repo connection" }
  ],
  "mcp": [ { "name": "linear-server", "transport": "http", "authGap": true } ],
  "gaps": [ "auto-memory not synced to cloud", "bun package fetch behind proxy" ],
  "allowlistDomains": []
}
```

## Delegation and reuse

- Reuse `config-resolution` semantics (local overrides global) when reading `.lisa.config.json` /
  `.lisa.config.local.json` to decide which integrations are active vs dormant.
- Complementary to `/lisa:doctor`: doctor answers "is this repo ready to use Lisa locally?";
  this skill answers "can this repo run as a remote routine, and what must the cloud env provide?"
  Do not duplicate doctor's local-readiness checks — focus on the local-vs-cloud delta.
- The companion generator `/lisa:generate-claude-remote-build-script` consumes this skill's
  inventory block; keep the block shape stable.

## Rules

- Never mutate repository, environment, tracker, or automation state. This skill is read-only.
- Classify by **evidence in the repo**, not assumption — cite the file that proves each finding.
- Distinguish active from dormant strictly by the resolved `.lisa.config.json` config; do not mark
  a dormant tracker's credentials `REQUIRED`.
- Never report a `GAP` as satisfiable by configuration — a gap is a constraint, and the action must
  be a change of approach, not "set an env var".
- Never invent tools or env vars that no committed file references.

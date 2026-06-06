---
name: analyze-claude-remote
description: "Audit whether the current repository can run as a Claude Code remote routine (cloud session). Read-only analysis that inventories what Lisa AND the host project need to configure or build in the cloud environment — external CLIs/binaries to install, environment variables and secrets to set, startup hooks and their headless-safety, MCP server scope/transport/auth, user-scoped config and auto-memory gaps that don't replicate to the cloud, and platform constraints (bun proxy, IP allowlist, network tier, no interactivity). Reads `.lisa.config.json` `tracker`/`source` to determine which tracker/PRD-source integrations are active, resolves each to its headless-viable substrate (CLI/curl + token, never browser-OAuth MCP, never OS-keychain), and spells out the exact secret env vars, where to obtain each token, and the precise access scope required — without guessing. Emits grouped findings plus a machine-readable inventory that /lisa:generate-claude-remote-build-script consumes."
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
   for this repo vs **dormant** (`OPTIONAL`). Distinguish *where* each var must be set, because the
   answer differs and getting it wrong sends the user to do redundant work:

   - **Committed `.claude/settings.json` `env` flags** (e.g. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`,
     `ENABLE_LSP_TOOL`, `BASH_*`) — this file is repo-committed, so it reaches the cloud and Claude
     Code applies its `env` block when it launches. These are **already provided — no action**.
     Surface them as `OK` (cite the file), not `REQUIRED`. Do **not** tell the user to re-enter them
     in the environment UI; a duplicate there only risks drifting from the committed value. The lone
     caveat: the setup script runs *before* Claude Code launches, so it cannot see these — flag any
     that the **setup script itself** would need (rare) as needing a UI value too.
   - **Secrets** (tokens/keys) — cannot be committed, so the committed `settings.json` can't carry
     them. These are the only vars that genuinely **must be set in the environment-variables UI**.
     Mark active-integration secrets `REQUIRED`; dormant ones `OPTIONAL`.

4a. **Tracker / PRD-source credentials** — this is the load-bearing part of the audit and must be
   driven by config, not by what the scan happens to find. Resolve the active integrations first:

   ```bash
   TRACKER=$(jq -r '.tracker // "jira"' .lisa.config.json 2>/dev/null)   # tickets: jira | github | linear
   SOURCE=$(jq -r '.source // empty'    .lisa.config.json 2>/dev/null)   # PRDs:   notion | confluence | github | linear
   ```
   (Apply `config-resolution`: `.lisa.config.local.json` overrides `.lisa.config.json`.) For the
   **active** `tracker` and the **active** `source` — and only those — emit a `REQUIRED` credential
   finding using the **Credential reference** table below. For every integration that is *not* the
   active tracker/source, its credentials are `OPTIONAL` (dormant) — never mark them `REQUIRED`.

   Two non-negotiable headless rules govern which substrate a routine can actually use:

   - **Browser-OAuth MCP is dead headless.** A routine cannot complete an interactive OAuth/SSO
     browser flow. So for any integration whose local substrate is an OAuth MCP (the committed
     `linear-server` MCP; the Notion MCP; the Atlassian MCP) or an interactively-authed CLI
     (`acli auth login --web`), the MCP/interactive tier is a `GAP` — the audit must route to that
     integration's **token substrate** (CLI/curl + API token) and report the token's env vars.
   - **OS keychain is absent headless.** Lisa's access skills read the token from the OS keychain
     first (`security` / `secret-tool` / `cmdkey`) and fall back to an **env var**. A cloud routine
     has no keyring daemon, so only the env-var fallback works. Always report the **env-var form**,
     including the per-account suffixed names (`ATLASSIAN_API_TOKEN_<slug>`, `NOTION_API_TOKEN_<slug>`,
     `LINEAR_API_KEY_<slug>`) when the integration keys tokens by email/workspace.

   For each active integration, the finding must carry: the env var name(s), where to get the token
   (`Acquire:` URL), and the **exact** access/scope required (`Access:`) — copied from the table, not
   guessed. If a value the table needs (server URL, project key, workspace id, email, team key) is
   missing from `.lisa.config.json`, flag it as a `GAP`/`Action:` to set it, rather than inventing one.

5. **MCP servers** — read every committed `.mcp.json`. For each server report transport and auth.
   Project-scoped HTTP/SSE servers with no interactive auth are `OK`. Flag stdio servers as
   `RISK`/`GAP` (need a local process — only viable if the cloud session can spawn them from the
   repo). Flag interactively/OAuth-authed servers as `GAP` for headless auth — they cannot complete
   a browser flow headless **regardless of transport** (an HTTP MCP like `linear-server` is still a
   `GAP` because its *auth* is OAuth, not because of its transport). When an OAuth MCP backs an
   active tracker/source, do not stop at the `GAP` — cross-reference group 4a and point to the
   integration's token substrate as the headless replacement (e.g. `linear-server` MCP → `LINEAR_API_KEY`
   + Linear GraphQL). Note any user-scoped MCP (`~/.claude.json`) as `GAP` — it never reaches the
   cloud; it must be moved into project `.mcp.json`.

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

## Credential reference (tracker / source → headless secret)

Authoritative mapping for group 4a, transcribed from Lisa's `setup-*` skills and access layers
(`setup-github`, `setup-atlassian`, `setup-jira`, `setup-notion`, `setup-linear`,
`atlassian-access`, `notion-access`). Use the row for the **active** `tracker`/`source` only. Report
the **env-var form** of each secret — keychain reads do not work in a cloud routine. Slugs:
`<email-slug>` = email via `tr '[:upper:]@.' '[:lower:]__'`; `<ws-slug>` = workspace via
`tr '[:upper:]-' '[:lower:]_'`. If a token has both an unsuffixed and a per-account form, the
unsuffixed `…_TOKEN`/`…_KEY` is the simplest to set in a single-account routine.

### GitHub — `tracker: github` and/or `source: github`
- Headless substrate: `gh` CLI authed by token (every Lisa GitHub script gates on `gh auth status`).
- Env: `GH_TOKEN` (the routine's built-in repo connection may not authenticate the `gh` CLI — verify; set `GH_TOKEN` if `gh auth status` fails). `PAT` only for cross-repo flows.
- Acquire: fine-grained — `https://github.com/settings/personal-access-tokens`; classic — `https://github.com/settings/tokens`.
- Access: fine-grained → Repository access to the target repo(s); Repository permissions: Contents R/W, Issues R/W, Pull requests R/W, Metadata R (mandatory); add Workflows R/W only if editing `.github/workflows`, and Organization → Projects R/W only if using ProjectV2. Classic equivalent: `repo` + `workflow` (+ `project`, `read:org` for boards). The identity must hold WRITE/MAINTAIN/ADMIN on the repo.

### JIRA — `tracker: jira`
- Headless substrate: `jira-cli` + curl (Basic auth). The acli and Atlassian-MCP tiers need prior interactive/OAuth auth → not viable headless.
- Env: `JIRA_API_TOKEN`, `JIRA_SERVER` (e.g. `https://acme.atlassian.net`), `JIRA_LOGIN` (account email), `JIRA_PROJECT` (default project key); optional `JIRA_INSTALLATION` (default `cloud`), `JIRA_BOARD`. (`setup-jira-cli.sh` writes the jira-cli config from these on SessionStart.)
- Acquire: `https://id.atlassian.com/manage-profile/security/api-tokens`.
- Access: the API token inherits the Atlassian user's permissions — the user must have Browse/Create/Edit/Transition on the target project. An unscoped token suffices for jira-cli; a scoped token must cover the JIRA project read/write operations.

### Confluence — `source: confluence`
- Headless substrate: curl + Basic auth + **scoped** API token.
- Env: `ATLASSIAN_API_TOKEN` (or per-account `ATLASSIAN_API_TOKEN_<email-slug>`). Config (`.lisa.config.json`): `atlassian.cloudId`, `atlassian.site`, `atlassian.email`.
- Acquire: `https://id.atlassian.com/manage-profile/security/api-tokens` → "Create API token **with scopes**" → App: **Confluence**.
- Access (select EXACTLY): `read:page:confluence`, `read:hierarchical-content:confluence`, `read:comment:confluence`, `read:space:confluence`, `write:page:confluence`, `write:comment:confluence`, `write:label:confluence`, `search:confluence`.

### Notion — `source: notion`
- Headless substrate: curl + Bearer + internal-integration token. The Notion MCP tier is OAuth → not viable headless.
- Env: `NOTION_API_TOKEN` (or per-account `NOTION_API_TOKEN_<ws-slug>`). Config: `notion.workspaceId`, `notion.prdDatabaseId`.
- Acquire: `https://www.notion.so/profile/integrations` → New integration → type **Internal** → copy the `ntn_*` Internal Integration Token.
- Access: internal-integration token. **Non-optional:** share the target PRD database with the integration (Notion's share-based model) or every call returns 404/`object_not_found`.

### Linear — `tracker: linear` and/or `source: linear`
- Headless substrate: curl GraphQL (`https://api.linear.app/graphql`) + personal API key. The committed `linear-server` MCP is OAuth/browser → cannot authenticate headless; the API key is the only headless path.
- Env: `LINEAR_API_KEY` (or per-account `LINEAR_API_KEY_<ws-slug>`). Config: `linear.workspace`; `linear.teamKey` required when Linear is the tracker.
- Acquire: `https://linear.app/<workspace>/settings/account/security` → Personal API keys → New API key.
- Access: the personal API key inherits the user's workspace permissions — the user must be able to read/create/update Issues in the destination team.

## Output

Render the report grouped exactly as above. Start with one `Summary:` line, then a `Counts:` line
covering `REQUIRED`, `OPTIONAL`, `GAP`, `RISK`, `OK`. Print each group as `<n>. <title>` and one
line per check as `- <STATUS> <id>: <summary>`, with optional `Observed:` and `Action:` lines
beneath that separate fact from advice. Render an empty group as a single `OK`/`SKIP` line with the
reason rather than omitting it.

Immediately after the grouped findings, render a **`Credentials to provision`** subsection — a
checklist of the secrets the user must set in the routine's environment for the **active**
`tracker`/`source` (from group 4a). One block per active integration, each with its env-var name(s),
an `Acquire:` URL, and an `Access:` scope line, plus a one-line note that the environment UI is where
these are set (the generated build script only emits a names-only template, never values). If both
`tracker` and `source` resolve to the same vendor (e.g. both `github`), render it once. List **only
secrets** here — do not include the committed `.claude/settings.json` `env` flags; close the
subsection with a one-line reminder that those flags are already provided by the committed file and
need no UI entry.

End with a fenced, machine-readable inventory block (also printed when `--json` is passed) so
`/lisa:generate-claude-remote-build-script` can consume it without re-deriving everything. Secret
`env` entries for active integrations MUST carry `acquireUrl`, `accessScope`, and `headlessSubstrate`
so the generator can render acquisition comments into its template:

```json
{
  "packageManager": { "name": "bun", "installCmd": "bun install", "risk": "cloud-proxy" },
  "tools": [
    { "name": "gh", "required": true, "reason": "github-* skills and scripts shell out to gh" },
    { "name": "jq", "required": true, "reason": "hooks and scripts parse JSON" }
  ],
  "tracker": "github",
  "source": "github",
  "env": [
    { "name": "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "required": false, "secret": false, "providedBy": "settings.json", "uiAction": "none", "reason": "committed in .claude/settings.json env — applied automatically; do not re-enter in the UI" },
    {
      "name": "GH_TOKEN", "required": true, "secret": true, "integration": "github",
      "reason": "active tracker+source; gh scripts gate on gh auth status",
      "headlessSubstrate": "gh CLI (token)",
      "acquireUrl": "https://github.com/settings/personal-access-tokens",
      "accessScope": "fine-grained PAT on target repo: Contents R/W, Issues R/W, Pull requests R/W, Metadata R; +Workflows R/W if editing .github/workflows; +Projects R/W if using ProjectV2"
    }
  ],
  "mcp": [
    { "name": "linear-server", "transport": "http", "auth": "oauth", "headlessUsable": false, "replacedBy": "LINEAR_API_KEY + Linear GraphQL", "dormant": true }
  ],
  "gaps": [ "auto-memory not synced to cloud", "bun package fetch behind proxy", "OS keychain absent — env-var token form only" ],
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
- Credential scopes and acquisition URLs come from the **Credential reference** table (sourced from
  Lisa's `setup-*` skills) — transcribe them exactly; never guess at the access a token needs.
- For the active `tracker`/`source`, always report the **env-var** form of the secret, never the OS
  keychain form — keychain reads do not work in a cloud routine.
- A browser-OAuth MCP (or interactively-authed CLI) backing an active integration is a `GAP`; the
  remediation is its token substrate from the table, not "authenticate the MCP".

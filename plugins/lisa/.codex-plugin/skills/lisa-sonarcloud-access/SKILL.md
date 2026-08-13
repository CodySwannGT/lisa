---
name: lisa-sonarcloud-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# SonarCloud Access: $ARGUMENTS

Single chokepoint for Sonar quality and security data. Caller skills MUST NOT
invoke `mcp__sonarqube__*` tools directly; they ask for data by operation name and
this skill owns the tool selection.

## Substrate

There is exactly one substrate: the **official SonarQube MCP server**, provided by
the `sonarqube` plugin and launched by the `sonar` CLI (`sonar run mcp`). It
authenticates headlessly from environment variables — no browser, no OS keychain —
so it is the same substrate on a developer machine and in a headless cloud routine.

That makes this skill conformant with `credential-substrate-precedence` as a
single-substrate access layer: this MCP **is** the configured-provider substrate
(it is token-authenticated, not browser-OAuth), so there is no interactive tier to
demote and no second REST tier to add. Identity-match against the configured org
remains mandatory, as on every substrate.

- `SONARQUBE_CLI_TOKEN` — required (Sonar user/analysis token).
- `SONARQUBE_CLI_ORG` — required for SonarQube Cloud.
- `SONARQUBE_CLI_SERVER` — required for a self-hosted SonarQube Server.

These are the **SonarQube CLI** variable names (`SONARQUBE_CLI_*`), which the
`sonar run mcp` wrapper forwards into the MCP container — verified against a live
SonarQube Cloud org. Do **not** substitute the raw MCP-image names
(`SONARQUBE_TOKEN`/`SONARQUBE_ORG`/`SONARQUBE_URL`): those are read only when
running the Docker image directly, and the `sonar` CLI ignores them (auth exits
non-zero). The CI scan gate's `SONAR_TOKEN` is a third, separate name.

### Where those variables come from

The `sonar` CLI reads them **from the environment only** — it has no provider
integration of its own — so on a surface that deliberately materializes nothing
to disk the credential can be provisioned and unreachable at the same time.
Resolve it through `lisa-secrets-access` and export it into the launching
process, exactly as the shared `sonar-secrets.sh` hook already does. The bare
`$SONARQUBE_CLI_TOKEN` in the environment is the documented **fallback** rung,
not the only one:

```bash
# Preferred: the one sanctioned reader. Without this rung a project keeping its
# credentials in Bitwarden, Doppler, or AWS cannot authenticate the MCP at all,
# and Sonar access degrades to "run `sonar auth login` in a browser" — dead in
# cron, CI, and cloud sessions. See `credential-substrate-precedence`.
read_sonar_secret() {
  local name="$1"
  [ -n "${!name:-}" ] && { echo "${!name}"; return; }
  local resolver
  for resolver in .claude/skills/lisa-secrets-access/scripts/resolve-secret.mjs \
                  .agents/skills/lisa-secrets-access/scripts/resolve-secret.mjs; do
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get "$name" 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      break
    fi
  done
  return 1
}

# Exported into this process only. Writing it anywhere durable would create a
# second live copy of a credential whose single store is the provider.
SONARQUBE_CLI_TOKEN=$(read_sonar_secret SONARQUBE_CLI_TOKEN) && export SONARQUBE_CLI_TOKEN
SONARQUBE_CLI_ORG=$(read_sonar_secret SONARQUBE_CLI_ORG) && export SONARQUBE_CLI_ORG
```

`sonar-secrets.sh` runs the same resolution with a longer search path (it also
probes `.codex/skills/…` and `node_modules/@codyswann/lisa/plugins/lisa/…`,
because a hook fires in checkouts that never installed an agent plugin) and with
a timeout, because it sits in front of every prompt. Use its search order
verbatim when this skill runs inside a hook.

Wiring is performed once by `/lisa:setup:sonar` (which drives `sonar integrate
<agent>`); this access layer assumes the MCP is already wired. This is distinct
from the CI `SONAR_TOKEN` secret that authenticates the SonarCloud scan job in
`quality.yml` — that gate is separate and unchanged.

## Probe (tool-access-gate)

Prove access with a cheap read-only MCP call before relying on it — the `sonar` CLI
being on PATH is not access. Probe by searching projects (the `projects` toolset is
always enabled):

- If a `mcp__sonarqube__*` project-search tool returns, access is proven.
- If no `mcp__sonarqube__*` tool is present, or the call fails authentication, fail
  loudly and do not improvise a substitute:

```text
Error: no SonarQube access. Run /lisa:setup:sonar (or `sonar integrate <agent>`), and set SONARQUBE_CLI_TOKEN (+ SONARQUBE_CLI_ORG for Cloud / SONARQUBE_CLI_SERVER for Server).
```

There is no hand-rolled REST fallback: the official MCP is headless-capable via the
token env vars, so it is the only sanctioned substrate. A missing MCP is a
tool-access-gate failure to surface, not a reason to curl the Web API.

## Operation → toolset map

Consumers pass a coarse, vendor-native operation; resolve it with the matching
`mcp__sonarqube__*` tool from the named toolset and return parsed JSON in a
`<result>` block.

| Operation | SonarQube MCP toolset |
|---|---|
| `gate-status` | `quality-gates` |
| `issues` | `issues` |
| `hotspots` | `security-hotspots` |
| `rule-detail` | `rules` |
| `source-snippet` | `cag` (context augmentation) / component source |
| `coverage` | `coverage` |
| `duplication` | `duplications` |
| `dependency-risks` | `dependency-risks` |
| `projects` | `projects` |

Pass the project key through the tool's `projectKey` argument (or rely on a
server-configured `SONARQUBE_PROJECT_KEY`); pass `branch` / `pullRequest` where the
tool accepts them.

## Mutation boundary

Every operation in the map above is **read-only** — quality, coverage, and
security data. So the `credential-substrate-precedence` guarded fallback for
mutating operations (write, read back, assert the tenant from the response, roll
back on mismatch) is not engaged here; with one substrate there is nothing to
fall back to in any case. A future operation that mutates Sonar state — marking
a hotspot safe, changing an issue's status — is a write and MUST reconcile by
read-back before any retry.

## Invariants

- The official SonarQube MCP is the only substrate; there is no REST fallback.
- `SONARQUBE_CLI_*` values are resolved through `lisa-secrets-access` and
  exported in-process, with the bare environment variables as the documented
  fallback. Never write them to a dotfile or a `.env` on a local surface.
- Auth is env-var only (`SONARQUBE_CLI_TOKEN` [+ `SONARQUBE_CLI_ORG` | `SONARQUBE_CLI_SERVER`]);
  never the interactive `sonar auth login` keychain flow inside a factory.
- Sonar host access requires the host (`sonarcloud.io`, `sonarqube.us`, or the
  Server URL) in any custom remote-network allowlist.
- Consumers ask for data by operation name; this skill owns tool selection.

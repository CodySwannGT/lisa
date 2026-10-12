---
name: lisa-sonarcloud-access
description: "Vendor-neutral access layer for SonarQube Cloud/Server. Sonar triage skills MUST delegate through this skill rather than calling the SonarQube MCP tools directly. Preferred substrate: the official SonarQube MCP server (mcp__sonarqube__*), authenticated headlessly from SONARQUBE_CLI_TOKEN (+ SONARQUBE_CLI_ORG for Cloud, SONARQUBE_CLI_SERVER for Server); the Sonar Web API, authenticated with the same token, is the sanctioned fallback when the MCP is not wired on this surface."
allowed-tools: ["Bash", "Read", "Skill"]
---

# SonarCloud Access: $ARGUMENTS

Single chokepoint for Sonar quality and security data. Caller skills MUST NOT
invoke `mcp__sonarqube__*` tools directly; they ask for data by operation name and
this skill owns the tool selection.

## Substrate

The **preferred** substrate is the **official SonarQube MCP server**, provided by
the `sonarqube` plugin and launched by the `sonar` CLI (`sonar run mcp`). It
authenticates headlessly from environment variables — no browser, no OS keychain —
so it is the same substrate on a developer machine and in a headless cloud routine.
Prefer it because it owns the tool selection this skill exists to centralise.

It is not the only sanctioned substrate. The **Sonar Web API**, authenticated with
the same token, is a sanctioned fallback for read-only operations when the MCP is
not wired on this surface. An earlier revision of this file said otherwise — that
the MCP was "the only sanctioned substrate" and a missing MCP was "not a reason to
curl the Web API" — and that was wrong on its face: `.github/workflows/quality.yml`
already reads `api/ce/task` with a token to turn an opaque failed scan into an
operator-readable one. A rule the shipping repository contradicts is documentation,
not a constraint.

The distinction that does hold: a token-authenticated MCP **is** the
configured-provider substrate under `credential-substrate-precedence` (it is not
browser-OAuth), so there is no interactive tier to demote here. That is a statement
about tier ORDER, not about exclusivity. Identity-match against the configured org
remains mandatory on either substrate.

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
  #
  # Ordered across trusted machine-managed substrates, ending at the installed
  # package. Checkout-local paths are deliberately absent: a familiar generated
  # destination is still repository-controlled executable code. The plugin
  # rungs are the floor: `resolve-secret.mjs` ships beside this skill, so a rung
  # pointing at it is reachable from anywhere the plugin itself is installed.
  # Without one, a consumer repository that vendors none of the leading paths
  # never reaches a resolver at all — the ladder exits without having asked
  # anything, which is what pushed agents into improvising their own credential
  # lookups. This LADDER is identical in every skill that resolves a credential
  # and `credential-resolver-ladder` fails if any copy diverges. Only what
  # happens AFTER the ladder may differ between them.
  # Execute only machine-managed plugin/package resolvers. Checkout-local
  # candidates are repository-controlled code, not trusted merely by path.
  local candidates=()
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    candidates+=("$CLAUDE_PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    candidates+=("$PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  # Last rung deliberately needs no environment variable: an agent that was
  # never handed a plugin root still has the installed package to fall back on.
  candidates+=(node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs)

  local resolver
  local tried=()
  for resolver in "${candidates[@]}"; do
    tried+=("$resolver")
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get "$name" 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      # Empty/error means this substrate had no answer; try the next trusted one.
    fi
  done
  # Name every path. A bare `return 1` sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths and store coordinates only — never any
  # resolved value, on any path.
  echo "Error: could not resolve $name through lisa-secrets-access." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  return 1
}

# Exported into this process only. Writing it anywhere durable would create a
# second live copy of a credential whose single store is the provider.
SONARQUBE_CLI_TOKEN=$(read_sonar_secret SONARQUBE_CLI_TOKEN) && export SONARQUBE_CLI_TOKEN
SONARQUBE_CLI_ORG=$(read_sonar_secret SONARQUBE_CLI_ORG) && export SONARQUBE_CLI_ORG
```

`sonar-secrets.sh` runs the same resolution with two differences that belong to
a hook rather than to a skill: it anchors every candidate at `$repo_root` (a
hook fires from whatever directory the agent happens to be in) and it wraps the
`resolve-secret.mjs` call in a timeout, because it sits in front of every
prompt. Use its search order verbatim when this skill runs inside a hook.

This paragraph used to claim the hook searched a *longer* path than the ladder
above. It did — the ladder above stopped after `.agents/`, so in a checkout
that vendored neither leading path it reached no resolver at all and returned
without a word. The two now cover the same layouts, and the fix that closed
that gap is guarded by `credential-resolver-ladder`.

Wiring is performed once by `/lisa:setup:sonar` (which drives `sonar integrate
<agent>`); this access layer assumes the MCP is already wired. This is distinct
from the CI `SONAR_TOKEN` secret that authenticates the SonarCloud scan job in
`quality.yml` — that gate is separate and unchanged.

## Probe (tool-access-gate)

Prove access with a cheap read-only MCP call before relying on it — the `sonar` CLI
being on PATH is not access. Probe by searching projects (the `projects` toolset is
always enabled):

- If a `mcp__sonarqube__*` project-search tool returns, access is proven.
- If no `mcp__sonarqube__*` tool is present on this surface, that is a **demotion,
  not a blocker**. Fall back to the Sonar Web API with the same resolved token for
  the read-only operation at hand.
- Only when neither substrate can prove access — no MCP tool *and* no usable token
  — is this a terminal tool-access-gate failure. Say so, and do not improvise a
  third route:

```text
Error: no SonarQube access. Run /lisa:setup:sonar (or `sonar integrate <agent>`), and set SONARQUBE_CLI_TOKEN (+ SONARQUBE_CLI_ORG for Cloud / SONARQUBE_CLI_SERVER for Server).
```

The distinction matters because the two cases have different remedies. An absent
MCP on a surface that holds a valid credential is a wiring gap the agent can work
around; treating it as terminal manufactures a tool-access failure on a surface
that has access.

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
back on mismatch) is not engaged here, because nothing in the map writes. The
Web API fallback is sanctioned for READS only; it does not open a mutation path.
A future operation that mutates Sonar state — marking
a hotspot safe, changing an issue's status — is a write and MUST reconcile by
read-back before any retry.

## Invariants

- The official SonarQube MCP is the preferred substrate, not the only one. The
  Sonar Web API with the same token is a sanctioned read-only fallback, and a
  missing MCP is a demotion rather than a terminal failure.
- `SONARQUBE_CLI_*` values are resolved through `lisa-secrets-access` and
  exported in-process, with the bare environment variables as the documented
  fallback. Never write them to a dotfile or a `.env` on a local surface.
- Auth is env-var only (`SONARQUBE_CLI_TOKEN` [+ `SONARQUBE_CLI_ORG` | `SONARQUBE_CLI_SERVER`]);
  never the interactive `sonar auth login` keychain flow inside a factory.
- Sonar host access requires the host (`sonarcloud.io`, `sonarqube.us`, or the
  Server URL) in any custom remote-network allowlist.
- Consumers ask for data by operation name; this skill owns tool selection.

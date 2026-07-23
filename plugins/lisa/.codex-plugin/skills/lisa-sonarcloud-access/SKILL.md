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
so it is the same substrate on a developer machine and in a headless cloud routine:

- `SONARQUBE_CLI_TOKEN` — required (Sonar user/analysis token).
- `SONARQUBE_CLI_ORG` — required for SonarQube Cloud.
- `SONARQUBE_CLI_SERVER` — required for a self-hosted SonarQube Server.

These are the **SonarQube CLI** variable names (`SONARQUBE_CLI_*`), which the
`sonar run mcp` wrapper forwards into the MCP container — verified against a live
SonarQube Cloud org. Do **not** substitute the raw MCP-image names
(`SONARQUBE_TOKEN`/`SONARQUBE_ORG`/`SONARQUBE_URL`): those are read only when
running the Docker image directly, and the `sonar` CLI ignores them (auth exits
non-zero). The CI scan gate's `SONAR_TOKEN` is a third, separate name.

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

## Invariants

- The official SonarQube MCP is the only substrate; there is no REST fallback.
- Auth is env-var only (`SONARQUBE_CLI_TOKEN` [+ `SONARQUBE_CLI_ORG` | `SONARQUBE_CLI_SERVER`]);
  never the interactive `sonar auth login` keychain flow inside a factory.
- Sonar host access requires the host (`sonarcloud.io`, `sonarqube.us`, or the
  Server URL) in any custom remote-network allowlist.
- Consumers ask for data by operation name; this skill owns tool selection.

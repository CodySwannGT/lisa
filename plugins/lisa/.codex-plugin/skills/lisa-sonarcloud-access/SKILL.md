---
name: lisa-sonarcloud-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# SonarCloud Access: $ARGUMENTS

Single chokepoint for SonarCloud operations. Caller skills MUST NOT call
`mcp__sonarqube__*` tools directly or curl `https://sonarcloud.io/api/`
themselves.

## Invocation Contract

```text
operation: gate-status project_key:<KEY> [branch:<BRANCH>] [pull_request:<N>]
operation: issues project_key:<KEY> [branch:<BRANCH>] [pull_request:<N>] [types:<csv>] [severities:<csv>]
operation: hotspots project_key:<KEY> [branch:<BRANCH>] [pull_request:<N>]
operation: rule-detail key:<RULE_KEY>
operation: source-snippet component:<COMPONENT_KEY> from:<N> to:<N>
```

Return parsed JSON in a `<result>` block.

## Substrate Selection

Probe in order:

1. Sonar MCP, if available and authenticated.
2. `SONAR_TOKEN` against the SonarCloud Web API.

SonarCloud documents bearer-token authentication for the Web API. Use:

```bash
sonar_api() {
  local path="$1"
  [ -n "$SONAR_TOKEN" ] || {
    echo "Error: SONAR_TOKEN is not set." >&2
    return 1
  }
  curl -sS "https://sonarcloud.io/api${path}" \
    -H "Authorization: Bearer $SONAR_TOKEN"
}
```

If a host still requires the legacy token-as-basic-auth form, make that an
explicit adapter branch in this skill; consumers do not choose auth style.

If neither tier works, fail with:

```text
Error: no SonarCloud access substrate available. Authenticate the Sonar MCP or set SONAR_TOKEN.
```

## REST Dispatch

| Operation | REST path |
|---|---|
| `gate-status` | `/qualitygates/project_status?projectKey=<KEY>[&branch=<BRANCH>][&pullRequest=<N>]` |
| `issues` | `/issues/search?componentKeys=<KEY>[&branch=<BRANCH>][&pullRequest=<N>]...` |
| `hotspots` | `/hotspots/search?projectKey=<KEY>[&branch=<BRANCH>][&pullRequest=<N>]` |
| `rule-detail` | `/rules/show?key=<RULE_KEY>` |
| `source-snippet` | `/sources/lines?key=<COMPONENT_KEY>&from=<N>&to=<N>` |

## Invariants

- Fallback is gated on `SONAR_TOKEN`.
- SonarCloud host access requires `sonarcloud.io` in any custom remote network
  allowlist.
- Consumers ask for analysis data by operation name; this skill owns the Web API
  path shape.

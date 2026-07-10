---
name: lisa-sentry-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Sentry Access: $ARGUMENTS

Single chokepoint for Sentry operations. Caller skills MUST NOT call
`mcp__sentry__*`, `sentry-cli`, or `https://sentry.io/api/` directly.

## Invocation Contract

```text
operation: list-issues org:<ORG> project:<PROJECT> query:<QUERY> [environment:<ENV>]
operation: get-issue issue_id:<ID>
operation: events org:<ORG> project:<PROJECT> query:<QUERY>
operation: releases org:<ORG> project:<PROJECT>
```

Return parsed JSON in a `<result>` block.

## Substrate Selection

Probe in order:

1. Sentry MCP, if available and authenticated.
2. `sentry-cli`, if installed and authenticated to the requested org/project.
3. `SENTRY_AUTH_TOKEN` bearer token against Sentry REST.

Sentry documents API auth tokens for REST API calls. The headless REST tier uses:

```bash
sentry_api() {
  local path="$1"
  [ -n "$SENTRY_AUTH_TOKEN" ] || {
    echo "Error: SENTRY_AUTH_TOKEN is not set." >&2
    return 1
  }
  curl -sS "https://sentry.io/api/0${path}" \
    -H "Authorization: Bearer $SENTRY_AUTH_TOKEN"
}
```

If neither tier works, fail with:

```text
Error: no Sentry access substrate available. Authenticate Sentry MCP/CLI or set SENTRY_AUTH_TOKEN.
```

## Invariants

- Fallback is gated on `SENTRY_AUTH_TOKEN`.
- Org/project come from `.sentryclirc`, `.lisa.config.json`, or explicit
  operation args; never infer by searching all accessible orgs.
- Consumer skills do not embed Sentry REST paths.

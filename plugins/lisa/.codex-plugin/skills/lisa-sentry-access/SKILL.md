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

Probe in order — the ordering is the shared `credential-substrate-precedence`
contract, not a Sentry-local choice. The first tier that is ready **and**
identity-matches the configured org/project is used; a substrate authenticated
against a different org is skipped, never used.

1. **Tier 1 — configured-provider substrate: `SENTRY_AUTH_TOKEN`** bearer token
   against Sentry REST, resolved through `lisa-secrets-access`.
2. **Tier 1a — `sentry-cli`**, if installed and authenticated to the requested
   org/project from that same token (the CLI arm of the provider substrate).
3. **Tier 2 — interactive MCP fallback: Sentry MCP**, if available and
   authenticated. Used when tier 1 is genuinely unavailable: no
   `SENTRY_AUTH_TOKEN`, no REST/CLI adapter for the operation, or a Sentry outage.

Sentry documents API auth tokens for REST API calls, and the same token works
interactively and headlessly — which is why it leads. The REST tier uses:

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

- Tier order is `credential-substrate-precedence`: `SENTRY_AUTH_TOKEN` first, the
  Sentry MCP as a preserved first-class fallback. Identity-match against the
  configured org/project is mandatory on every tier.
- Org/project come from `.sentryclirc`, `.lisa.config.json`, or explicit
  operation args; never infer by searching all accessible orgs.
- Consumer skills do not embed Sentry REST paths.

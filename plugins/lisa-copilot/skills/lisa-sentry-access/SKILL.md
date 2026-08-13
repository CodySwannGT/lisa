---
name: lisa-sentry-access
description: "Vendor-neutral access layer for Sentry. Sentry-oriented skills MUST delegate through this skill rather than calling Sentry MCP tools, sentry-cli, or REST directly. Per the credential-substrate-precedence contract, resolves SENTRY_AUTH_TOKEN (REST, or sentry-cli authenticated from the same token) first when present and identity-matched to the configured org/project, then falls back to the Sentry MCP."
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
# Resolve the token through the chokepoint before giving up on the environment.
# `$SENTRY_AUTH_TOKEN` is the documented fallback, not the only rung: without
# this, a project that keeps its credentials in Bitwarden, Doppler, or AWS has
# no tier 1 path at all and silently resolves through the interactive MCP —
# the exact divergence `credential-substrate-precedence` exists to remove.
# Mirrors `linear-access`, `atlassian-access`, and `notion-access`.
read_sentry_token() {
  [ -n "${SENTRY_AUTH_TOKEN:-}" ] && { echo "$SENTRY_AUTH_TOKEN"; return; }
  local resolver
  for resolver in .claude/skills/lisa-secrets-access/scripts/resolve-secret.mjs \
                  .agents/skills/lisa-secrets-access/scripts/resolve-secret.mjs; do
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get SENTRY_AUTH_TOKEN 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      break
    fi
  done
  return 1
}

sentry_api() {
  local path="$1"
  local token
  token=$(read_sentry_token) || {
    echo "Error: no Sentry auth token. Set SENTRY_AUTH_TOKEN, or store it as" >&2
    echo "SENTRY_AUTH_TOKEN in this project's secrets provider." >&2
    return 1
  }
  curl -sS "https://sentry.io/api/0${path}" \
    -H "Authorization: Bearer $token"
}
```

Tier 1a authenticates `sentry-cli` from the **same resolved token**
(`SENTRY_AUTH_TOKEN=$(read_sentry_token) sentry-cli …`) — never from a second
credential store, and never from an interactive `sentry-cli login` keychain.

If neither tier works, fail with:

```text
Error: no Sentry access substrate available. Authenticate Sentry MCP/CLI or set SENTRY_AUTH_TOKEN.
```

## Mutation boundary

Every operation in the Invocation Contract is **read-only** — issue, event, and
release retrieval. So the `credential-substrate-precedence` guarded fallback for
mutating operations (write, read back, assert the tenant from the response, roll
back on mismatch) is not engaged here, and a failed tier is simply skipped. Any
future operation that mutates Sentry state — resolving an issue, editing a
release — is a write and MUST reconcile by read-back under that protocol before
any retry; do not add one to the contract without it.

## Invariants

- Tier order is `credential-substrate-precedence`: `SENTRY_AUTH_TOKEN` first, the
  Sentry MCP as a preserved first-class fallback. Identity-match against the
  configured org/project is mandatory on every tier.
- The token is resolved through `lisa-secrets-access`, with the bare
  `SENTRY_AUTH_TOKEN` environment variable as the documented fallback. Never read
  a second credential store (OS keychain, `~/.sentryclirc` token) directly — the
  one-store rule lives at the chokepoint.
- Org/project come from `.sentryclirc`, `.lisa.config.json`, or explicit
  operation args; never infer by searching all accessible orgs.
- Consumer skills do not embed Sentry REST paths.

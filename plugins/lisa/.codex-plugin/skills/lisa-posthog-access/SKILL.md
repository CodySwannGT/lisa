---
name: lisa-posthog-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# PostHog Access: $ARGUMENTS

Single chokepoint for PostHog operations. Caller skills and rules MUST NOT call
`mcp__posthog__*` tools or PostHog REST directly.

## Invocation Contract

```text
operation: query project_id:<ID> payload:{...}
operation: insights project_id:<ID>
operation: persons project_id:<ID> [query:<QUERY>]
operation: events project_id:<ID> [after:<ISO>] [before:<ISO>]
```

Return parsed JSON in a `<result>` block.

## Substrate Selection

Probe in order — the ordering is the shared `credential-substrate-precedence`
contract, not a PostHog-local choice. The first tier that is ready **and**
identity-matches the configured project is used; a substrate authenticated against
a different project is skipped, never used.

1. **Tier 1 — configured-provider substrate: `POSTHOG_PERSONAL_API_KEY`** bearer
   token against the configured PostHog host, resolved through
   `lisa-secrets-access`.
2. **Tier 2 — interactive MCP fallback: PostHog MCP**, if available and
   authenticated. Used when tier 1 is genuinely unavailable: no
   `POSTHOG_PERSONAL_API_KEY`, no REST adapter for the operation, or a PostHog
   outage.

PostHog documents personal API keys and bearer authentication, and the same key
works interactively and headlessly — which is why it leads. The REST tier uses:

```bash
POSTHOG_HOST=${POSTHOG_HOST:-https://app.posthog.com}
posthog_api() {
  local path="$1"
  local method="${2:-GET}"
  local body="${3:-}"
  [ -n "$POSTHOG_PERSONAL_API_KEY" ] || {
    echo "Error: POSTHOG_PERSONAL_API_KEY is not set." >&2
    return 1
  }
  local args=(-sS -X "$method" -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-binary "$body")
  curl "${args[@]}" "${POSTHOG_HOST%/}/api${path}"
}
```

If neither tier works, fail with:

```text
Error: no PostHog access substrate available. Authenticate the PostHog MCP or set POSTHOG_PERSONAL_API_KEY.
```

## Invariants

- Tier order is `credential-substrate-precedence`: `POSTHOG_PERSONAL_API_KEY`
  first, the PostHog MCP as a preserved first-class fallback. Identity-match
  against the configured project is mandatory on every tier.
- `POSTHOG_HOST` defaults to PostHog Cloud but can point at a self-hosted
  deployment.
- Consumer skills do not embed PostHog REST paths.

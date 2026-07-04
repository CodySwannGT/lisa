---
name: lisa-posthog-access
description: "Vendor-neutral access layer for PostHog. PostHog skills and observability rules MUST delegate through this skill rather than calling PostHog MCP tools or REST directly. Resolves PostHog MCP first when available, then falls back to POSTHOG_PERSONAL_API_KEY bearer auth."
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

Probe in order:

1. PostHog MCP, if available and authenticated.
2. `POSTHOG_PERSONAL_API_KEY` bearer token against the configured PostHog host.

PostHog documents personal API keys and bearer authentication. The headless REST
tier uses:

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

- Fallback is gated on `POSTHOG_PERSONAL_API_KEY`.
- `POSTHOG_HOST` defaults to PostHog Cloud but can point at a self-hosted
  deployment.
- Consumer skills do not embed PostHog REST paths.

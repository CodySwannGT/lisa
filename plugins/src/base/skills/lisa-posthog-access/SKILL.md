---
name: lisa-posthog-access
description: "Vendor-neutral access layer for PostHog. PostHog skills and observability rules MUST delegate through this skill rather than calling PostHog MCP tools or REST directly. Per the credential-substrate-precedence contract, resolves POSTHOG_PERSONAL_API_KEY bearer auth first when present and identity-matched to the configured project, then falls back to the PostHog MCP."
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

# Resolve the key through the chokepoint before giving up on the environment.
# `$POSTHOG_PERSONAL_API_KEY` is the documented fallback, not the only rung:
# without this, a project that keeps its credentials in Bitwarden, Doppler, or
# AWS has no tier 1 path at all and silently resolves through the interactive
# MCP — the exact divergence `credential-substrate-precedence` exists to remove.
read_posthog_key() {
  [ -n "${POSTHOG_PERSONAL_API_KEY:-}" ] && { echo "$POSTHOG_PERSONAL_API_KEY"; return; }
  #
  # Ordered repo-first, ending at the plugin's own copy. Repo-relative rungs
  # lead because a project that vendors the resolver has declared which copy it
  # wants used, and that decision must survive this change untouched. The plugin
  # rungs are the floor: `resolve-secret.mjs` ships beside this skill, so a rung
  # pointing at it is reachable from anywhere the plugin itself is installed.
  # Without one, a consumer repository that vendors none of the leading paths
  # never reaches a resolver at all — the ladder exits without having asked
  # anything, which is what pushed agents into improvising their own credential
  # lookups. This LADDER is identical in every skill that resolves a credential
  # and `credential-resolver-ladder` fails if any copy diverges. Only what
  # happens AFTER the ladder may differ between them.
  local candidates=(
    .claude/skills/lisa-secrets-access/scripts/resolve-secret.mjs
    .agents/skills/lisa-secrets-access/scripts/resolve-secret.mjs
    .opencode/skills/lisa/lisa-secrets-access/scripts/resolve-secret.mjs
    .codex/skills/lisa/lisa-secrets-access/scripts/resolve-secret.mjs
  )
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
      via_lisa=$(node "$resolver" get POSTHOG_PERSONAL_API_KEY 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      break
    fi
  done
  # Name every path. A bare `return 1` sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths and store coordinates only — never any
  # resolved value, on any path.
  echo "Error: could not resolve POSTHOG_PERSONAL_API_KEY through lisa-secrets-access." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  return 1
}

posthog_api() {
  local path="$1"
  local method="${2:-GET}"
  local body="${3:-}"
  local key
  key=$(read_posthog_key) || {
    echo "Error: no PostHog key. Set POSTHOG_PERSONAL_API_KEY, or store it as" >&2
    echo "POSTHOG_PERSONAL_API_KEY in this project's secrets provider." >&2
    return 1
  }
  local args=(-sS -X "$method" -H "Authorization: Bearer $key")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-binary "$body")
  curl "${args[@]}" "${POSTHOG_HOST%/}/api${path}"
}
```

If neither tier works, fail with:

```text
Error: no PostHog access substrate available. Authenticate the PostHog MCP or set POSTHOG_PERSONAL_API_KEY.
```

## Mutation boundary

Every operation in the Invocation Contract is **read-only** — analytics
retrieval. `query` is an HTTP POST, but it reads: it submits a query body and
changes no PostHog state. So the `credential-substrate-precedence` guarded
fallback for mutating operations (write, read back, assert the tenant from the
response, roll back on mismatch) is not engaged here, and a failed tier is
simply skipped. Adding a genuinely mutating operation — creating an insight,
editing a feature flag — pulls that protocol in: a write of unknown outcome MUST
reconcile by read-back before any retry.

## Invariants

- Tier order is `credential-substrate-precedence`: `POSTHOG_PERSONAL_API_KEY`
  first, the PostHog MCP as a preserved first-class fallback. Identity-match
  against the configured project is mandatory on every tier.
- The key is resolved through `lisa-secrets-access`, with the bare
  `POSTHOG_PERSONAL_API_KEY` environment variable as the documented fallback.
  Never read a second credential store directly.
- `POSTHOG_HOST` defaults to PostHog Cloud but can point at a self-hosted
  deployment.
- Consumer skills do not embed PostHog REST paths.

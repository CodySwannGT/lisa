---
name: lisa-jam-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Jam Access: $ARGUMENTS

Single chokepoint for Jam operations. Caller skills and rules MUST NOT call
`mcp__Jam__*` tools directly.

## Invocation Contract

```text
operation: get-trace url:<jam-url-or-id>
operation: get-recording url:<jam-url-or-id>
operation: get-bug-report url:<jam-url-or-id>
```

Return parsed JSON or a concise structured summary in a `<result>` block.

## Substrate Selection

Probe in order — the ordering is the shared `credential-substrate-precedence`
contract, not a Jam-local choice. The first tier that is ready **and**
identity-matches the configured Jam account is used; one authenticated elsewhere
is skipped, never used.

1. **Tier 1 — configured-provider substrate: Jam CLI authenticated with `JAM_PAT`**,
   resolved through `lisa-secrets-access`.
2. **Tier 2 — interactive MCP fallback: Jam MCP**, if the tool is available and
   authenticated. Used when tier 1 is genuinely unavailable: no `JAM_PAT`, no CLI
   adapter for the operation, or a Jam outage.

Jam documents a PAT-authenticated CLI that is cleaner for remote routines than
editing `.mcp.json` headers, and it is the same substrate interactively and
headlessly — which is why it leads. The CLI tier uses:

```bash
curl -fsSL https://native.jam.dev/install | bash
export PATH="$HOME/.local/bin:$PATH"

# Resolve the PAT through the chokepoint before giving up on the environment.
# `$JAM_PAT` is the documented fallback, not the only rung: without this, a
# project that keeps its credentials in Bitwarden, Doppler, or AWS has no tier 1
# path at all and silently resolves through the interactive MCP — the exact
# divergence `credential-substrate-precedence` exists to remove.
read_jam_pat() {
  [ -n "${JAM_PAT:-}" ] && { echo "$JAM_PAT"; return; }
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
      via_lisa=$(node "$resolver" get JAM_PAT 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      break
    fi
  done
  # Name every path. A bare `return 1` sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths and store coordinates only — never any
  # resolved value, on any path.
  echo "Error: could not resolve JAM_PAT through lisa-secrets-access." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  return 1
}

# Piped, never written to disk and never passed as an argv token: a PAT on a
# command line is readable from the process table by every user on the host.
read_jam_pat | jam auth login --token
jam skills install
```

If neither tier works, fail with:

```text
Error: no Jam access substrate available. Authenticate the Jam MCP, set JAM_PAT, or store JAM_PAT in this project's secrets provider.
```

## Mutation boundary

Every operation in the Invocation Contract is **read-only** — fetching a trace,
a recording, or a bug report. So the `credential-substrate-precedence` guarded
fallback for mutating operations (write, read back, assert the tenant from the
response, roll back on mismatch) is not engaged here, and a failed tier is
simply skipped. A future operation that mutates Jam state — commenting on or
deleting a Jam — is a write and MUST reconcile by read-back before any retry.

## Invariants

- Tier order is `credential-substrate-precedence`: `JAM_PAT` CLI first, Jam MCP as
  a preserved first-class fallback. Do not retry a failed tier blindly.
- The PAT is resolved through `lisa-secrets-access`, with the bare `JAM_PAT`
  environment variable as the documented fallback. Never read a second
  credential store directly.
- Never commit a Jam PAT into `.mcp.json` or any generated setup artifact.
- Headless Jam access requires `native.jam.dev` for the installer and
  `api.jam.dev` for CLI/API calls in any custom remote network allowlist.
- If a requested operation is not yet mapped to the Jam CLI substrate, surface
  that exact missing adapter instead of pretending the trace is unavailable.

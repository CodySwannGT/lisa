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
printf '%s' "$JAM_PAT" | jam auth login --token
jam skills install
```

If neither tier works, fail with:

```text
Error: no Jam access substrate available. Authenticate the Jam MCP or set JAM_PAT.
```

## Invariants

- Tier order is `credential-substrate-precedence`: `JAM_PAT` CLI first, Jam MCP as
  a preserved first-class fallback. Do not retry a failed tier blindly.
- Never commit a Jam PAT into `.mcp.json` or any generated setup artifact.
- Headless Jam access requires `native.jam.dev` for the installer and
  `api.jam.dev` for CLI/API calls in any custom remote network allowlist.
- If a requested operation is not yet mapped to the Jam CLI substrate, surface
  that exact missing adapter instead of pretending the trace is unavailable.

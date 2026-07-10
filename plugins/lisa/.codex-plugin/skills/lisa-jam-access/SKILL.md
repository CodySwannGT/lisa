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

Probe in order:

1. Jam MCP, if the tool is available and authenticated.
2. Jam CLI authenticated with `JAM_PAT`.

Jam documents a PAT-authenticated CLI that is cleaner for remote routines than
editing `.mcp.json` headers. The headless tier uses:

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

- Fallback is gated on `JAM_PAT`; do not retry Jam MCP failures blindly.
- Never commit a Jam PAT into `.mcp.json` or any generated setup artifact.
- Headless Jam access requires `native.jam.dev` for the installer and
  `api.jam.dev` for CLI/API calls in any custom remote network allowlist.
- If a requested operation is not yet mapped to the Jam CLI substrate, surface
  that exact missing adapter instead of pretending the trace is unavailable.

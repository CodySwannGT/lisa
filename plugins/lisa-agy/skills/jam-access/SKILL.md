---
name: jam-access
description: "Vendor-neutral access layer for Jam. Jam triage rules and skills MUST delegate through this skill rather than calling Jam MCP tools directly. Resolves Jam MCP first when available, then falls back to JAM_PAT bearer auth for headless routines."
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
2. `JAM_PAT` bearer token against Jam's MCP/trace HTTP substrate.

Jam documents personal access tokens for MCP clients so a browser OAuth flow is
not required. The headless tier uses:

```bash
curl -sS "https://mcp.jam.dev/mcp" \
  -H "Authorization: Bearer $JAM_PAT" \
  -H "Content-Type: application/json" \
  --data-binary "$PAYLOAD"
```

If neither tier works, fail with:

```text
Error: no Jam access substrate available. Authenticate the Jam MCP or set JAM_PAT.
```

## Invariants

- Fallback is gated on `JAM_PAT`; do not retry Jam MCP failures blindly.
- Never commit a Jam PAT into `.mcp.json`. Use env interpolation in host MCP
  config, for example `Authorization: Bearer ${JAM_PAT}`.
- If a requested operation is not yet mapped to the Jam HTTP substrate, surface
  that exact missing adapter instead of pretending the trace is unavailable.

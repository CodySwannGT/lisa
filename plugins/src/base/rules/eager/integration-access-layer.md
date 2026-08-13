# Integration Access Layer

Skills and rules that use external integrations route through the matching
`*-access` skill. Do not call vendor MCP tools or REST APIs directly from a
consumer skill.

Secrets are the same shape: every credential resolves through
`lisa-secrets-access`, which owns the provider list, the note format, and the
resolution order. Read it rather than restating it — and never ask a human to
paste a value the provider can supply.

Resolution order is the configured-provider token/CLI substrate first when its
bootstrap credential is present and identity-matched, then the interactive MCP as
fallback, then a loud error naming the exact credential to set. Identity-match is
mandatory on every substrate — one authenticated as a different tenant is skipped,
never used. The ordering itself is settled in
[reference/credential-substrate-precedence.md](../reference/credential-substrate-precedence.md);
full matrix and migration rules:
[reference/integration-access-layer.md](../reference/integration-access-layer.md).

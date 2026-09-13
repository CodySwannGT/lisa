# Integration Access Layer

Skills and rules that use external integrations route through the matching
`*-access` skill. Do not call vendor MCP tools or REST APIs directly from a
consumer skill.

Resolve credentials through `lisa-secrets-access`; do not duplicate its
provider configuration or ask a human to paste a value it can supply.

For missing AWS credentials, use its `LISA_AWS_BOOTSTRAP_JSON` recovery guidance
before proposing an interactive login.

Use the configured-provider token/CLI first when its bootstrap credential is
present, then interactive MCP, then an error naming the missing credential.
Every method must match the intended tenant; skip mismatched identities.
Resolution order:
[reference/credential-substrate-precedence.md](../reference/credential-substrate-precedence.md);
full matrix and migration rules:
[reference/integration-access-layer.md](../reference/integration-access-layer.md).

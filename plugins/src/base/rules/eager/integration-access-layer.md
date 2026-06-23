# Integration Access Layer

Skills and rules that use external integrations route through the matching
`*-access` skill. Do not call vendor MCP tools or REST APIs directly from a
consumer skill.

Resolution order is MCP when available and authenticated, then documented
token/REST substrate when the env var is set, then a loud error naming the env
var. Full matrix and migration rules:
[reference/integration-access-layer.md](../reference/integration-access-layer.md).

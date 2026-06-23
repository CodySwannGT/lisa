---
name: linear-access
description: "Vendor-neutral access layer for Linear. Linear skills MUST delegate through this skill rather than calling Linear MCP tools or Linear GraphQL directly. Resolves Linear MCP first when authenticated, then falls back to LINEAR_API_KEY + Linear GraphQL in headless environments."
allowed-tools: ["Bash", "Read", "Skill"]
---

# Linear Access: $ARGUMENTS

Single chokepoint for Linear operations. Caller skills (`linear-*`) MUST go
through this skill. They MUST NOT call `mcp__linear-server__*` tools directly or
curl `https://api.linear.app/graphql` themselves.

## Invocation Contract

```text
operation: list-teams [query:<KEY>]
operation: get-team id:<ID>
operation: list-projects [team:<KEY>] [label:<NAME>] [state:<arr>]
operation: get-project id:<ID>
operation: save-project payload:{...}
operation: list-issues [team:<ID>] [project:<ID>] [label:<NAME>] [state_type:<arr>]
operation: get-issue id:<ID>
operation: save-issue payload:{...}
operation: list-comments issue_id:<ID>
operation: save-comment issue_id:<ID> body:"..."
operation: list-issue-labels [team:<ID>]
operation: create-issue-label payload:{...}
operation: list-project-labels
operation: create-project-label payload:{...}
operation: list-documents project_id:<ID>
operation: get-document id:<ID>
```

Return parsed JSON in a `<result>` block. On failure, prefix the message with
`Error:` and include the failing operation name.

## Substrate Selection

Read config:

```bash
WORKSPACE=$(jq -r '.linear.workspace // empty' .lisa.config.json 2>/dev/null)
TEAM_KEY=$(jq -r '.linear.teamKey // empty' .lisa.config.json 2>/dev/null)
```

Probe in order:

1. Linear MCP, if `mcp__linear-server__list_teams` is available and can list the
   configured workspace/team.
2. `LINEAR_API_KEY` with Linear GraphQL (`https://api.linear.app/graphql`).

The Linear GraphQL docs support personal API keys for scripts and authenticate
with an `Authorization: <API_KEY>` header. Treat `LINEAR_API_KEY` as the
headless substrate. If neither tier works, fail with:

```text
Error: no Linear access substrate available. Authenticate the Linear MCP or set LINEAR_API_KEY.
```

## GraphQL Adapter

All GraphQL calls use:

```bash
linear_graphql() {
  local query="$1"
  local variables="${2:-{}}"
  [ -n "$LINEAR_API_KEY" ] || {
    echo "Error: LINEAR_API_KEY is not set." >&2
    return 1
  }
  jq -n --arg query "$query" --argjson variables "$variables" \
    '{query:$query, variables:$variables}' |
    curl -sS -X POST "https://api.linear.app/graphql" \
      -H "Content-Type: application/json" \
      -H "Authorization: '"$LINEAR_API_KEY"'" \
      --data-binary @-
}
```

Map operation names to Linear GraphQL queries/mutations in this access skill.
Consumers pass business-shaped arguments only; they do not embed GraphQL.

## Invariants

- MCP is preferred when it is present and already authenticated.
- GraphQL fallback runs only when `LINEAR_API_KEY` is present.
- Missing MCP plus missing token is a hard failure naming `LINEAR_API_KEY`.
- Mutations send only the fields being changed, matching existing Linear skill
  guidance that `save_*` style updates should not clobber unrelated fields.

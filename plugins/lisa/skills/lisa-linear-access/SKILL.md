---
name: lisa-linear-access
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
operation: history id:<ID>
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

## `history` — transition history (read-only)

`history id:<ID>` returns an Issue's ordered past state changes — the raw
material for rejection detection (an Issue that reached a `review`/`done`-ward
state and is now back in `ready`). `IssueHistory` is reachable today through the
existing `linear_graphql` adapter but was **not** in the documented contract; an
undocumented-but-reachable capability is not exposed, so it now appears in the
Invocation Contract above. Reuse the existing adapter — this is a
contract/surface change, not a new transport (the `integration-access-layer`
rule forbids consumers from reaching around the layer).

Query through `linear_graphql` (oldest→newest; page `history(first:…, after:…)`
via `pageInfo` for busy Issues so history never silently truncates):

```graphql
query($id:String!){
  issue(id:$id){
    history(first:100){
      pageInfo{hasNextPage endCursor}
      nodes{
        createdAt
        fromState{name type}
        toState{name type}
        actor{name}
        addedLabelIds
        removedLabelIds
      }
    }
  }
}
```

- **Shape.** For each node emit `{ from, to, when, who }` — `fromState.name` →
  `toState.name`, `createdAt` (ISO timestamp), `actor.name`. Nodes with no
  `fromState`/`toState` are non-state edits (label-only, assignee, etc.); keep
  them for the label stream, skip them for workflow-state ordering.
- **Label history (honest caveat).** Linear's build lanes are **label-driven**
  (`lisa-linear-build-intake` keys the queue on `status:*` labels), so label
  moves matter as much as workflow-state moves. `IssueHistory` carries label
  changes as `addedLabelIds` / `removedLabelIds` — arrays of label **IDs**, not
  names. It does **not** inline label names, and it does not carry the label's
  full prior/next set — only the per-event deltas. Resolve IDs → names by
  cross-referencing `list-issue-labels`. Do not overclaim: a caller that needs
  `status:*` label transitions reconstructs them from the ID deltas plus the
  label catalog, not from an inline name on the history node.
- **Empty is valid.** An Issue that never changed state returns an **empty**
  history — an empty history is a valid result, not an error.
- **Graceful degrade — never block the build.** A failed history fetch returns
  the layer's `Error:` result. Callers MUST treat that as **unknown** history
  and proceed — a history read failure never blocks the build. MCP cannot reach
  `IssueHistory`, so the `history` operation resolves only through the
  `LINEAR_API_KEY` GraphQL substrate; without it, the result is unknown.

## Invariants

- MCP is preferred when it is present and already authenticated.
- GraphQL fallback runs only when `LINEAR_API_KEY` is present.
- Missing MCP plus missing token is a hard failure naming `LINEAR_API_KEY`.
- Mutations send only the fields being changed, matching existing Linear skill
  guidance that `save_*` style updates should not clobber unrelated fields.

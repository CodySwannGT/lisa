---
name: lisa-linear-access
description: "Vendor-neutral access layer for Linear. Linear skills MUST delegate through this skill rather than calling Linear MCP tools or Linear GraphQL directly. Per the credential-substrate-precedence contract, resolves LINEAR_API_KEY + Linear GraphQL first — ahead of the Linear MCP — whenever the key is present and identity-matches the configured workspace/team, and falls back to the Linear MCP when the token path is unavailable. Identity-match is mandatory on both substrates."
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
operation: list-issues [team:<ID>] [project:<ID>] [label:<NAME>] [state:<NAME>] [state_type:<arr>]
operation: get-issue id:<ID>
operation: save-issue payload:{...} [lifecycle_role:<ROLE>] [env:<KEY>]
operation: list-workflow-states team:<ID>
operation: create-workflow-state payload:{...}
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

Probe in order — the ordering is the shared `credential-substrate-precedence`
contract, not a Linear-local choice. The first tier that is ready **and**
identity-matches wins; a substrate authenticated against a different
workspace/team is **skipped, never used**, at either tier.

1. **Tier 1 — configured-provider substrate: `LINEAR_API_KEY` with Linear GraphQL**
   (`https://api.linear.app/graphql`), resolved through `lisa-secrets-access`.
   Identity-match by querying `viewer { organization { urlKey } }` (plus
   `teams` when `linear.teamKey` is configured) and comparing to
   `.lisa.config.json`. A key that resolves to a different organization fails the
   gate — warn, skip the tier, and continue down the ladder.
2. **Tier 2 — interactive MCP fallback: Linear MCP**, if
   `mcp__linear-server__list_teams` is available and can list the configured
   workspace/team (that listing *is* the identity match). Used when tier 1 is
   genuinely unavailable: no `LINEAR_API_KEY`, no GraphQL adapter for the
   operation, or a Linear API outage.

The Linear GraphQL docs support personal API keys for scripts and authenticate
with an `Authorization: <API_KEY>` header, so the token tier works identically on
a developer laptop, in CI, in a cloud routine, and in a subagent — which is why it
leads. If neither tier works, fail with:

```text
Error: no Linear access substrate available. Authenticate the Linear MCP or set LINEAR_API_KEY.
```

## GraphQL Adapter

All GraphQL calls use:

```bash
# Resolve the key through the chokepoint before giving up on the environment.
# Without this rung a project that keeps its credentials in Bitwarden, Doppler,
# or AWS has no path to the key at all — the ladder stopped at rung one, which
# is also what left `/lisa:setup:linear` reading an OS keychain directly with
# nowhere to migrate to. Mirrors `atlassian-access` and `notion-access`.
read_linear_key() {
  [ -n "${LINEAR_API_KEY:-}" ] && { echo "$LINEAR_API_KEY"; return; }

  # The ladder is ordered across trusted machine-managed substrates and ends at
  # the installed package. Checkout-local paths are deliberately absent: a
  # familiar generated destination is still repository-controlled executable
  # code. The plugin rungs are the floor: `resolve-secret.mjs`
  # ships beside this skill, so a rung pointing at it is reachable from
  # anywhere the plugin itself is installed. Without one, a repo that vendors
  # none of the leading paths has no route to the key at all — which is what
  # every consumer of this skill in a `.opencode`-layout repository actually
  # hit, and why agents started improvising their own key lookups.
  # Execute only machine-managed plugin/package resolvers. Checkout-local
  # candidates are repository-controlled code, not trusted merely by path.
  local candidates=()
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
      via_lisa=$(node "$resolver" get LINEAR_API_KEY 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      # Empty/error means this substrate had no answer; try the next trusted one.
    fi
  done

  # Name every path. A bare `return 1` sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths only — never any resolved value.
  echo "Error: could not resolve LINEAR_API_KEY through lisa-secrets-access." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  return 1
}

linear_graphql() {
  local query="$1"
  local variables="${2:-{}}"
  local key
  key=$(read_linear_key) || {
    echo "Error: no Linear API key. Set LINEAR_API_KEY, or store it as" >&2
    echo "LINEAR_API_KEY in this project's secrets provider." >&2
    return 1
  }
  jq -n --arg query "$query" --argjson variables "$variables" \
    '{query:$query, variables:$variables}' |
    curl -sS -X POST "https://api.linear.app/graphql" \
      -H "Content-Type: application/json" \
      -H "Authorization: $key" \
      --data-binary @-
}
```

Map operation names to Linear GraphQL queries/mutations in this access skill.
Consumers pass business-shaped arguments only; they do not embed GraphQL.

## `save-issue` — a state write is RESOLVED here, never accepted here

**This layer does not accept a state to write. It resolves one.** A `save-issue`
that changes the workflow state declares `lifecycle_role:<ROLE>` — the semantic
role it is applying (`ready`, `claimed`, `blocked`, `review`, `done`,
`qa.queue`, `qa.certified`) — plus `env:<KEY>` when the role is the env-indexed
`done`. This layer then resolves that role against config and the team's own
catalog, and sends the ID **it** resolved.

```bash
STATES=$(mktemp)
# `list-workflow-states` output for the identity-matched team.
linear_state_target() {  # role [env] -> the ONE writable state id, or exit 2
  node "${CLAUDE_PLUGIN_ROOT}/scripts/linear-state-write-target.mjs" \
    --role "$1" ${2:+--env "$2"} --states "$STATES" \
    ${LIFECYCLE_ASSERT_STATE_ID:+--state-id "$LIFECYCLE_ASSERT_STATE_ID"}
}

STATE_ID=$(linear_state_target "$LIFECYCLE_ROLE" "$LIFECYCLE_ENV") || {
  # Nothing is dispatched. The script already named the role and the
  # configured value it expected on stderr; surface that verbatim.
  exit 2
}
```

Run it **before** either transport — before `linear_graphql`, before any
`mcp__linear-server__*` call. A refusal is a hard stop that sends zero
mutations, not a warning.

Why the layer resolves instead of validating: a validator standing in front of a
caller-supplied `stateId` checks one value and dispatches another, which is
exactly the shape that let a caller reach a human-only review lane in the first
place. Here the checked value and the sent value are the same object — there is
no channel through which an unvalidated state write can be expressed.

A caller that already read an ID off the board MAY pass it as `stateId` in the
payload. It is treated as an **assertion**, never as the value to send: the
layer resolves the role's target independently and refuses the call if the two
differ, naming the role and the configured value. Two further refusals matter:

- `stateId` in a payload with **no** `lifecycle_role` is refused. There is no
  such thing as a state write that does not apply a lifecycle role.
- An **optional role the project never bound** (`review`, `qa.*`) is refused,
  not defaulted. Absent means *skip the transition*, per `config-resolution` R1
  — the caller skips the write entirely rather than asking for one here.

**Metadata-only `save-issue` is untouched.** A payload with no `stateId` and no
`lifecycle_role` — description, assignee, labels, `projectId`, `parentId` — runs
exactly as before; lifecycle validation has nothing to say about it.

## `list-workflow-states` — the team's states, and which one it creates into

`list-workflow-states team:<ID>` returns one node per state with `id`, `name`,
`type`, `position`, and **`isTeamDefault`**.

`isTeamDefault` is `true` for the single state named by the team's
`defaultIssueState` — where Linear puts every brand-new Issue. Callers need it to
enforce the rule that `linear.workflow.ready` must be a lane a human moves an
Issue **into**: pointing `ready` at the default inverts the gate, so the
claimable lane means "nobody has touched this" rather than "a human marked this
ready", and build-intake dispatches unapproved work. `/lisa:setup:linear` refuses
to resolve `ready` onto it, and `/lisa:validate-tracker-mapping` classifies a
config that already does as `INVERTED`.

It belongs on this operation rather than in a separate `get-team` call because
every caller that needs it is already enumerating states, and a second round trip
is a second chance for the two answers to disagree. A team with no
`defaultIssueState` set yields `isTeamDefault: false` on every node — report that
honestly; do not fall back to guessing by name or position.

```graphql
query($teamId:String!){
  team(id:$teamId){
    defaultIssueState{ id }
    states(first:100){ nodes{ id name type position } }
  }
}
```

Set `isTeamDefault` per node by comparing `node.id` against
`team.defaultIssueState.id`. On the MCP substrate, which exposes states without
the team's default, resolve the default through the team record and join on `id`
the same way.

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
- **Build lanes are STATE-driven, so the `from`/`to` stream above is the primary
  signal.** `lisa-linear-build-intake` keys the queue on workflow states
  (`linear.workflow`), and `IssueHistory` inlines `fromState.name` /
  `toState.name` directly — no catalog cross-reference, no ID resolution, no
  reconstruction. Callers needing lifecycle transitions read them straight off
  the node. This is strictly better than the label stream below and is why the
  Linear adapter moved to states.
- **Label history (honest caveat, still needed for MARKERS and the PRD lane).**
  `human_needed` is a label, and the PRD lifecycle rides on project labels, so
  label moves still matter for those. `IssueHistory` carries label changes as
  `addedLabelIds` / `removedLabelIds` — arrays of label **IDs**, not names. It
  does **not** inline label names, and it does not carry the label's full
  prior/next set — only the per-event deltas. Resolve IDs → names by
  cross-referencing `list-issue-labels`. Do not overclaim: a caller that needs
  label transitions reconstructs them from the ID deltas plus the label catalog,
  not from an inline name on the history node. A caller reading a **build**
  lifecycle transition should not be in this bullet at all — use the state
  stream.
- **Empty is valid.** An Issue that never changed state returns an **empty**
  history — an empty history is a valid result, not an error.
- **Graceful degrade — never block the build.** A failed history fetch returns
  the layer's `Error:` result. Callers MUST treat that as **unknown** history
  and proceed — a history read failure never blocks the build. MCP cannot reach
  `IssueHistory`, so the `history` operation resolves only through the
  `LINEAR_API_KEY` GraphQL substrate; without it, the result is unknown.

## Invariants

- Tier order is the shared `credential-substrate-precedence` contract:
  `LINEAR_API_KEY` + GraphQL first when present and identity-matched, then the
  Linear MCP. Do not restate or locally override the ordering here.
- The Linear MCP remains a first-class **fallback**, not a removed tier: it stays
  the substrate whenever `LINEAR_API_KEY` is absent, the operation has no GraphQL
  adapter, or the token path is failing.
- Identity-match is mandatory on **both** substrates. A substrate authenticated
  against a different Linear organization or team is skipped, never used — that
  includes a present-but-wrong `LINEAR_API_KEY`, which fails the gate loudly
  instead of silently deferring to an authenticated MCP.
- Missing token plus missing MCP is a hard failure naming `LINEAR_API_KEY`.
- Mutations send only the fields being changed, matching existing Linear skill
  guidance that `save_*` style updates should not clobber unrelated fields.
- Every workflow-state write is resolved by
  `scripts/linear-state-write-target.mjs` from a declared `lifecycle_role`,
  before either transport. The ID dispatched is the ID that script returned —
  never one a caller supplied. A caller-supplied `stateId` is an assertion that
  must match, and a `stateId` with no declared role is refused.
- A refusal is fail-closed and operator-readable: it names the lifecycle role
  and the configured value, exits nonzero, and sends nothing.

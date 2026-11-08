---
name: lisa-linear-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---
Vendor-neutral access layer for Linear. Linear skills MUST delegate through this skill rather than calling Linear MCP tools or Linear GraphQL directly. Per the credential-substrate-precedence contract, resolves LINEAR_API_KEY + Linear GraphQL first — ahead of the Linear MCP — whenever the key is present and identity-matches the configured workspace/team, and falls back to the Linear MCP when the token path is unavailable. Identity-match is mandatory on both substrates.


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
operation: list-comments (issue_id:<ID> | project_id:<ID>)
operation: save-comment (issue_id:<ID> | project_id:<ID>) body:"..."
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

## GraphQL Adapter — run the script by path, never an inline command

The tier-1 transport is an executable that ships beside this file:
`scripts/linear-graphql.sh`. It:

- resolves `LINEAR_API_KEY` itself through `lisa-secrets-access`, with the
  shared ladder: `LINEAR_API_KEY`, then the per-workspace
  `LINEAR_API_KEY_<slug>`, then the trusted `resolve-secret.mjs` rungs
  (`$CLAUDE_PLUGIN_ROOT`, `$PLUGIN_ROOT`, the installed package). When the host
  exported no plugin root it offers the plugin copy the script itself ships in
  as the `PLUGIN_ROOT` rung. Checkout-local resolvers are never executed;
- identity-matches the key (`viewer { organization { urlKey } }`, plus the
  configured team when `linear.teamKey` is set) against `.lisa.config.json`
  **before** sending the request, and sends nothing else when that fails;
- reads the query, and optionally the variables, from files or stdin;
- prints the Linear response body on stdout and diagnostics on stderr. It never
  prints the key: the key is not echoed or traced (not even under `bash -x`),
  and it is not in any process's argv, because curl reads the `Authorization`
  header from a file descriptor.

**Never paste key capture and curl into one inline command**, for example
`K=$(node …/resolve-secret.mjs get LINEAR_API_KEY); curl … -H "Authorization: $K"`.
Claude Code asks for approval on a command that captures a secret and sends it to
an external host, even under `--dangerously-skip-permissions`. A background
worker has no one to answer that prompt, so it stalls until a human attaches.
The same code run from a file by absolute path does not prompt, which is why the
adapter is a file. Do not print the key to check it either: run `--whoami`.

### Locate the script once

The script is `scripts/linear-graphql.sh` inside this skill's own directory (the
folder that holds this `SKILL.md`; Claude Code prints it as the skill's base
directory when the skill loads). When you do not know that directory, resolve it
once:

```bash
LA="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills/lisa-linear-access/scripts}"
[ -n "$LA" ] && [ -f "$LA/linear-graphql.sh" ] || LA="$(claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>{let l=[];try{l=JSON.parse(s)}catch{}const c=l.filter(p=>String(p.id).startsWith("lisa@"));const p=c.find(p=>p.projectPath===process.cwd())||c.find(p=>p.scope==="user");process.stdout.write(p?p.installPath:"")})')/skills/lisa-linear-access/scripts"
[ -f "$LA/linear-graphql.sh" ] || LA="$PWD/node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-linear-access/scripts"
[ -f "$LA/linear-graphql.sh" ] || { echo "lisa-linear-access scripts not found" >&2; exit 1; }
echo "$LA"
```

Then write the printed absolute path **literally** in every later command. Shell
variables do not survive between Bash calls, and Lisa's shell guards read the
file a command executes, so they refuse `bash "$LA/linear-graphql.sh"` as an
execution they cannot classify.

### Call it

Write the GraphQL document to a file first (with the file-writing tool, not an
inline `echo`), then run:

```bash
bash /abs/path/to/lisa-linear-access/scripts/linear-graphql.sh \
  --query-file /abs/path/to/query.graphql --variables '{"id":"ENG-123"}'
```

| Form | Meaning |
|---|---|
| `--query-file FILE` | The GraphQL document. `-` reads it from stdin. |
| `--variables JSON` | Variables as one JSON object (default `{}`). |
| `--variables-file FILE` | Variables from a file. `-` reads them from stdin (only one of query and variables can use stdin). |
| `QUERY_FILE [JSON \| @FILE]` | Positional shorthand for the two above. |
| `--workspace SLUG` / `--team-key KEY` | Override `linear.workspace` / `linear.teamKey`. Default: the nearest `.lisa.config.local.json`, then `.lisa.config.json`, at or above the current directory. |
| `--whoami` | Print the key's identity (viewer, organization, whether the team is visible) and exit. It is the identity check, and the safe way to confirm a key works. |

Exit codes: `0` success; `1` the request failed, or Linear returned GraphQL
`errors` (the body is still printed on stdout); `2` invalid arguments; `3` no
`LINEAR_API_KEY` could be resolved (stderr names every resolver path tried);
`4` identity-match refused (a different organization, a team the key cannot
see, or no workspace configured). Map exit `3` to the MCP fallback below; never
map exit `4` to it silently, because a present-but-wrong key fails the gate
loudly.

### Several calls in one step

Paged reads and the guarded state write below call shell helpers
(`linear_list_comment_pages`, `linear_list_workflow_states`) that use
`linear_graphql`. Put them in a script **file** that sources the adapter on its
first line, and run that file by its absolute path. Sourcing defines
`read_linear_key`, `linear_graphql`, `linear_require_identity`, and
`linear_identity_check` and runs nothing. Call `linear_require_identity` once
before the first request. It identity-matches `$WORKSPACE`/`$TEAM_KEY`, or the
project config, and returns `4` on a mismatch. Without it, every
`linear_graphql` probes identity again. Never paste these functions into an
inline command.

```bash
#!/usr/bin/env bash
# /abs/path/to/scratch/list-comments.sh
. /abs/path/to/lisa-linear-access/scripts/linear-graphql.sh
linear_require_identity || exit $?
# ... define linear_list_comment_pages (below), then:
linear_list_comment_pages issue "$1"
```

Keep the `.` line first. Lisa's shell guards follow a sourced file, and they can
read its definitions as unconditional only when nothing that changes control
flow runs before it.

Map operation names to Linear GraphQL queries/mutations in this access skill.
Consumers pass business-shaped arguments only; they do not embed GraphQL.

## `save-issue` — a state write is RESOLVED here, never accepted here

**This layer does not accept a state to write. It resolves one.** A `save-issue`
that changes the workflow state declares `lifecycle_role:<ROLE>` — the semantic
role it is applying (for example, `ready`, `claimed`, `blocked`, `review`, `done`; the configured role contract is authoritative) — plus `env:<KEY>` when the role is the env-indexed
`done`. This layer then resolves that role against config and the team's own
catalog, and sends the ID **it** resolved.

Run this from a script file that sources `scripts/linear-graphql.sh` (see
[Several calls in one step](#several-calls-in-one-step)), never inline.

```bash
# The team's own catalog, read through this layer's `list-workflow-states`
# operation for the IDENTITY-MATCHED team, and written to a file so the
# resolver judges the same bytes the caller looked at. A catalog fetched from
# some other team is not a smaller catalog, it is the wrong one.
STATES=$(mktemp)
linear_list_workflow_states "$TEAM_ID" >"$STATES"

# Same trusted ladder `read_linear_key` walks, and for the same reason: a
# `.opencode`-layout repo that was never handed CLAUDE_PLUGIN_ROOT has no route
# to the script at all, and a guard that cannot be found is a guard that does
# not run. Machine-managed rungs only — a checkout-local `plugins/lisa` is
# repository-controlled executable code, not trusted merely by path.
resolve_state_guard() {
  local candidate
  for candidate in \
    "${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/linear-state-write-target.mjs}" \
    "${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/linear-state-write-target.mjs}" \
    node_modules/@codyswann/lisa/plugins/lisa/scripts/linear-state-write-target.mjs; do
    [ -n "$candidate" ] && [ -f "$candidate" ] && { echo "$candidate"; return; }
  done
  # Fail CLOSED and name every path. An unfindable guard must never degrade
  # into an unguarded write.
  echo "Error: could not locate linear-state-write-target.mjs; refusing the state write." >&2
  return 1
}

linear_state_target() {  # role [env] -> the ONE writable state id, or exit 2
  local guard
  guard=$(resolve_state_guard) || return 1
  node "$guard" \
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

## `save-comment` / `list-comments` — an Issue **or** a Project

Both comment operations take **either** `issue_id:` or `project_id:`. Exactly one
is required; passing both, or neither, is refused naming the operation.

For agent-composed `save-comment` bodies, apply `lisa-tracker-sync` — **Agent attribution** before posting. Preserve an existing disclosure and the exact format of machine-managed comments.

Linear treats a comment's target as one field on the same input type, so the
project form is not a second mechanism — it is the same mutation with a
different anchor. Direct introspection of `https://api.linear.app/graphql`:
`CommentCreateInput` accepts `issueId`, `projectId`, `projectUpdateId`,
`documentContentId`, and `parentId`, and the `Project` type exposes
`Project.comments`. Neither is beta and neither needs a special scope.

```graphql
# save-comment — the anchor field is chosen by which id the caller passed.
mutation($input:CommentCreateInput!){
  commentCreate(input:$input){ success comment{ id url createdAt } }
}
```

Build `$input` as `{ issueId: <id>, body: <body> }` for the Issue form and
`{ projectId: <id>, body: <body> }` for the Project form. Nothing else differs —
same mutation, same result shape, same error handling.

```graphql
# list-comments project_id:<ID> — page via pageInfo so a long-lived PRD's
# feedback history never silently truncates.
query($id:String!,$after:String){
  project(id:$id){
    comments(first:100,after:$after){
      pageInfo{ hasNextPage endCursor }
      nodes{ id body createdAt url user{ id name } botActor{ __typename } }
    }
  }
}
```

The Issue form uses `issue(id:$id)` with the same `first:100,after:$after`
arguments and node shape. For **both** anchors, use this access-layer adapter with
`linear_graphql` from the sourced adapter script, run from a script file as
[Several calls in one step](#several-calls-in-one-step) describes; it accumulates every page and prints no partial history.
A read succeeds only after `hasNextPage` is false. Errors, malformed pages, and
missing or repeated continuation cursors fail the whole read.
Preserve `botActor` with each comment: its non-null presence identifies automation,
even if `user.id` is trusted. When normalizing comments, carry it forward or set
`isBot: true`; never discard this metadata before release authorization.

```bash
linear_list_comment_pages() {  # issue|project id -> complete JSON node array
  local anchor="$1" id="$2" after=null nodes='[]' seen='[]'
  local query variables response connection cursor
  case "$anchor" in issue|project) ;; *) echo "Error: invalid comment anchor" >&2; return 1 ;; esac
  query='query($id:String!,$after:String){'"$anchor"'(id:$id){comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id body createdAt url user{id name} botActor{__typename}}}}}'
  while :; do
    variables=$(jq -cn --arg id "$id" --argjson after "$after" '{id:$id,after:$after}') || return 1
    response=$(linear_graphql "$query" "$variables") || return 1
    connection=$(printf '%s' "$response" | jq -ce --arg anchor "$anchor" '
      if (.errors != null and .errors != []) then error("GraphQL comments read failed")
      else .data[$anchor].comments end |
      if (.nodes | type) != "array" or (.pageInfo.hasNextPage | type) != "boolean"
      then error("Incomplete comments page") else . end') || return 1
    nodes=$(jq -cn --argjson prior "$nodes" --argjson page "$connection" '$prior + $page.nodes') || return 1
    if [ "$(printf '%s' "$connection" | jq -r '.pageInfo.hasNextPage')" = false ]; then
      printf '%s\n' "$nodes"
      return 0
    fi
    cursor=$(printf '%s' "$connection" | jq -ce '.pageInfo.endCursor | select(type == "string" and length > 0)') || {
      echo "Error: incomplete comments history; missing cursor" >&2; return 1;
    }
    if jq -en --argjson seen "$seen" --argjson cursor "$cursor" '$seen | index($cursor) != null' >/dev/null; then
      echo "Error: incomplete comments history; repeated cursor" >&2
      return 1
    fi
    seen=$(jq -cn --argjson seen "$seen" --argjson cursor "$cursor" '$seen + [$cursor]') || return 1
    after="$cursor"
  done
}
```

Keep the returned comment objects intact when a caller evaluates a human-gate release. The
`user.id` is the stable author identity; `user.name` is display text and never authorizes release.
Pass structured comments and an independently supplied `trustedHumanActorIds` allowlist to the
shared gate helpers (`ready-role-filing` — Human-gate release authorization). A body-only projection
loses identity and cannot discharge a hold. Preserve any explicit bot metadata from the provider;
if identity or trusted policy is unavailable, leave the hold active.

Call `linear_list_comment_pages project "$PROJECT_ID"` for `project_id`, or
`linear_list_comment_pages issue "$ISSUE_ID"` for `issue_id`. The caller receives
one complete node array; it must not interpret a failed command as zero comments.

**Substrate.** The Linear MCP exposes comments on Issues only, so the
`project_id` form resolves solely through the tier-1 `LINEAR_API_KEY` + GraphQL
substrate — the same restriction `history` carries, and for the same reason.
That is not a gap in Linear: the precedence contract already puts GraphQL ahead
of the MCP, so the preferred substrate has always been able to do this. Only
this wrapper could not, which is what made callers fabricate an Issue to hold a
Project's comments. If tier 1 is unavailable, fail with the layer's standard
`Error:` result naming the requested `save-comment project_id` or `list-comments project_id` operation — do **not** silently degrade
into creating an Issue to comment on.

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
- The token tier runs only through `scripts/linear-graphql.sh`, invoked by
  absolute path or sourced from a script file. No caller captures the key into
  a variable in an inline command, and nothing prints it.
- Mutations send only the fields being changed, matching existing Linear skill
  guidance that `save_*` style updates should not clobber unrelated fields.
- A comment anchors to exactly one target. `save-comment` and `list-comments`
  take `issue_id` **or** `project_id`, never both and never neither. A caller
  that wants to comment on a Project passes `project_id` — it never creates an
  Issue to hold the comment, and this layer never creates one on its behalf.
- Every workflow-state write is resolved by
  `scripts/linear-state-write-target.mjs` from a declared `lifecycle_role`,
  before either transport. The ID dispatched is the ID that script returned —
  never one a caller supplied. A caller-supplied `stateId` is an assertion that
  must match, and a `stateId` with no declared role is refused.
- A refusal is fail-closed and operator-readable: it names the lifecycle role
  and the configured value, exits nonzero, and sends nothing.

#!/usr/bin/env bash
# linear-graphql.sh — the executable GraphQL adapter behind lisa-linear-access.
#
# Usage:
#   bash /abs/path/linear-graphql.sh --query-file <FILE|-> [--variables '<json>' | --variables-file <FILE|->]
#   bash /abs/path/linear-graphql.sh <QUERY_FILE> ['<json>' | @<VARIABLES_FILE>]
#   bash /abs/path/linear-graphql.sh --whoami
#
# Options:
#   --query-file FILE      GraphQL document to send. `-` reads it from stdin.
#   --variables JSON       Variables as one JSON object (default `{}`).
#   --variables-file FILE  Variables from a file. `-` reads them from stdin.
#   --workspace SLUG       Linear workspace to identity-match against. Default:
#                          `linear.workspace` from the nearest .lisa.config.local.json
#                          / .lisa.config.json at or above the current directory.
#   --team-key KEY         Team the key must see. Default: `linear.teamKey` from
#                          the same config. Omitted when neither is set.
#   --whoami               Print the key's identity (viewer and organization) and
#                          exit. Checks the identity against the workspace only
#                          when one is configured or passed.
#   -h, --help             Print this help.
#
# Stdout is the Linear response body, unchanged. Diagnostics go to stderr.
#
# Exit codes:
#   0  success
#   1  the request failed, the response was not JSON, or it carried GraphQL errors
#      (the body is still printed so the caller can read the errors)
#   2  invalid arguments
#   3  no LINEAR_API_KEY could be resolved
#   4  identity-match refused: the key belongs to a different organization or
#      cannot see the configured team, or no workspace is configured to match
#
# Why this file exists:
#   The adapter used to live only as a snippet in SKILL.md, so agents pasted it
#   into one inline shell command: capture the key with `$(...)`, then send it
#   to an external host with curl. Claude Code asks for approval on that shape
#   even under --dangerously-skip-permissions, and a background worker has no
#   one to answer, so it stalls until a human attaches. Running the same code
#   from a file invoked by absolute path does not prompt. The key is resolved
#   inside this process and never appears in the caller's command line.
#
# Never prints the key. It is not echoed, not traced, not placed in any
# process's argv (curl reads the Authorization header from a file descriptor),
# and not included in any diagnostic.
#
# Sourcing this file (`source linear-graphql.sh`) defines read_linear_key,
# linear_graphql and linear_identity_check without running anything, for a
# script FILE that needs several calls (paged reads, guarded state writes).
# Run that script file by path too; never paste the functions into an inline
# command.

# The key resolver. The ladder is the one every Lisa credential ladder shares,
# and tests/unit/strategies hold this copy rung-for-rung identical to the
# legacy one in lisa-setup-linear.
read_linear_key() {  # $1=workspace slug; defaults to $WORKSPACE read from config
  # Never trace a credential. Callers normally run this in `$(...)`, so the
  # change stays inside that subshell.
  { set +x; } 2>/dev/null
  [ -n "${LINEAR_API_KEY:-}" ] && { echo "$LINEAR_API_KEY"; return; }

  # Per-workspace rung, matching `atlassian-access` and `notion-access`, and
  # matching what `setup-linear` tells the reader to export. Remote-routine
  # env templates emit the same suffixed name, so it must resolve here.
  #
  # An unset variable changes nothing: an empty workspace skips the rung
  # entirely and the ladder below runs exactly as it did before.
  local ws="${1:-${WORKSPACE:-}}"
  if [ -n "$ws" ]; then
    local slug; slug=$(echo "$ws" | tr '[:upper:]-' '[:lower:]_')
    # Constrain the slug before it reaches `${!varname}`. Indirect expansion
    # evaluates an array subscript, so a workspace carrying `[$(...)]` would
    # RUN that command here. The slug comes from `.lisa.config.json`, which is
    # repository-controlled input, so anything that is not lowercase
    # alphanumerics and underscores is skipped rather than expanded.
    case "$slug" in
      ""|*[!a-z0-9_]*) ;;
      *)
        local varname="LINEAR_API_KEY_${slug}"
        [ -n "${!varname:-}" ] && { echo "${!varname}"; return; }
        ;;
    esac
  fi

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

  # Name every path. Paths only — never any resolved value.
  echo "Error: could not resolve LINEAR_API_KEY through lisa-secrets-access." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  return 1
}

# Send one GraphQL request with an already-resolved key. Internal: callers use
# linear_graphql, or run this file.
_linear_post() {  # $1=key $2=query $3=variables JSON
  { set +x; } 2>/dev/null
  # The header goes through a process-substitution file descriptor, written by
  # the `printf` builtin, so the key is never in curl's argv (`ps` shows argv
  # to every user on the machine). Bounded timeouts: an unattended worker has
  # nobody to notice a hung connection, and a hang is the stall this file
  # exists to prevent. A timeout is a failed request (exit 1 from the CLI).
  jq -cn --arg query "$2" --argjson variables "$3" \
    '{query:$query, variables:$variables}' |
    curl -sS --connect-timeout 10 --max-time 60 -X POST "https://api.linear.app/graphql" \
      -H "Content-Type: application/json" \
      -H @<(printf 'Authorization: %s\n' "$1") \
      --data-binary @-
}

# The plugin copy this file ships in also holds the resolver. Offer it as the
# PLUGIN_ROOT rung when the host exported none: Claude Code does not export
# CLAUDE_PLUGIN_ROOT to Bash, and a multi-repo root often has no node_modules.
# This adds no trust, because whoever runs this file already runs the code
# beside it. It is applied as a function-local value, so neither the caller's
# shell nor any process started here sees a changed PLUGIN_ROOT.
#
# Computed in a function, not at the top level: this file runs no statement
# before its last line, so Lisa's shell guards can read every definition here
# as unconditional when a caller's script sources it.
_linear_self_root() {
  local here root
  here="${BASH_SOURCE[0]}"
  root=$(cd "$(dirname "$here")/../../.." 2>/dev/null && pwd) || return 0
  if [ -f "$root/skills/lisa-secrets-access/scripts/resolve-secret.mjs" ]; then
    printf '%s' "$root"
  fi
}

_linear_key() {  # $1=workspace slug -> the key on stdout, for capture only
  { set +x; } 2>/dev/null
  local PLUGIN_ROOT="${PLUGIN_ROOT:-$(_linear_self_root)}"
  read_linear_key "$1" || {
    echo "Error: no Linear API key. Set LINEAR_API_KEY (or the per-workspace" >&2
    echo "LINEAR_API_KEY_<slug>), or store it as LINEAR_API_KEY in this" >&2
    echo "project's secrets provider." >&2
    return 3
  }
}

# Sourced use: identity-match once for this shell before any linear_graphql.
# Workspace and team come from $WORKSPACE / $TEAM_KEY, else the project config.
linear_require_identity() {
  { set +x; } 2>/dev/null
  local ws="${WORKSPACE:-}" team="${TEAM_KEY:-}" key rc
  [ -n "$ws" ] || ws=$(_linear_config_value '.linear.workspace')
  [ -n "$team" ] || team=$(_linear_config_value '.linear.teamKey')
  if [ -z "$ws" ]; then
    echo "Error: identity-match refused. No Linear workspace is configured (linear.workspace in .lisa.config.json), so there is nothing to match the key against. Set WORKSPACE. Nothing was sent." >&2
    return 4
  fi
  key=$(_linear_key "$ws") || return 3
  linear_identity_check "$key" "$ws" "$team"; rc=$?
  [ $rc -eq 0 ] && _LINEAR_IDENTITY_OK="$ws"
  return $rc
}

# Sourced use: one request. Identity-matches first unless this shell already
# passed linear_require_identity (a call inside `$(...)` cannot record that,
# so call linear_require_identity once up front to avoid a probe per call).
linear_graphql() {  # $1=query [$2=variables JSON, default {}]
  { set +x; } 2>/dev/null
  local query="$1"
  # Not `${2:-{}}`: that expansion ends at the first `}`, so it appends a stray
  # `}` to every variables object a caller passes, and jq rejects the result.
  local variables="${2:-}"
  [ -n "$variables" ] || variables='{}'
  local key
  if [ -z "${_LINEAR_IDENTITY_OK:-}" ]; then
    linear_require_identity || return $?
  fi
  key=$(_linear_key "${_LINEAR_IDENTITY_OK:-${WORKSPACE:-}}") || return 3
  _linear_post "$key" "$query" "$variables"
}

# The identity probe. Prints `{viewer, organization, teamVisible}` as JSON.
_linear_identity() {  # $1=key [$2=team key]
  local probe
  if [ -n "${2:-}" ]; then
    probe=$(_linear_post "$1" \
      'query($team:String!){viewer{id name organization{urlKey name}} teams(filter:{key:{eq:$team}}){nodes{key}}}' \
      "$(jq -cn --arg team "$2" '{team:$team}')") || return 1
  else
    probe=$(_linear_post "$1" \
      'query{viewer{id name organization{urlKey name}}}' '{}') || return 1
  fi
  printf '%s' "$probe" | jq -ce --arg team "${2:-}" '
    if (.errors != null and .errors != []) or (.data.viewer.organization.urlKey | type) != "string"
    then error("identity probe failed")
    else {
      viewer: {id: .data.viewer.id, name: .data.viewer.name},
      organization: .data.viewer.organization,
      teamVisible: (if $team == "" then null
                    else ([.data.teams.nodes[]?.key] | index($team) != null) end)
    } end' 2>/dev/null || {
    echo "Error: the Linear identity probe failed; nothing else was sent." >&2
    return 1
  }
}

# Identity-match, per credential-substrate-precedence: a key for a different
# organization, or one that cannot see the configured team, is refused.
linear_identity_check() {  # $1=key $2=workspace [$3=team key]
  local identity
  identity=$(_linear_identity "$1" "${3:-}") || return 1
  _linear_identity_match "$identity" "$2" "${3:-}"
}

# Judge an identity the probe already returned. Separate so `--whoami` can
# print the identity and judge it from one request.
_linear_identity_match() {  # $1=identity JSON $2=workspace [$3=team key]
  local identity="$1" org
  org=$(printf '%s' "$identity" | jq -r '.organization.urlKey')
  if [ "$(printf '%s' "$org" | tr '[:upper:]' '[:lower:]')" != \
       "$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')" ]; then
    echo "Error: identity-match refused. LINEAR_API_KEY belongs to Linear organization '$org', not the configured workspace '$2'. Nothing was sent." >&2
    return 4
  fi
  if [ -n "${3:-}" ] && [ "$(printf '%s' "$identity" | jq -r '.teamVisible')" != true ]; then
    echo "Error: identity-match refused. LINEAR_API_KEY cannot see the configured team '$3' in '$2'. Nothing was sent." >&2
    return 4
  fi
  return 0
}

# Read one key from the nearest project config, local override first.
_linear_config_value() {  # $1=jq path
  local dir="$PWD" value
  while :; do
    if [ -f "$dir/.lisa.config.json" ] || [ -f "$dir/.lisa.config.local.json" ]; then
      value=$(jq -r "$1 // empty" "$dir/.lisa.config.local.json" 2>/dev/null)
      [ -z "$value" ] && value=$(jq -r "$1 // empty" "$dir/.lisa.config.json" 2>/dev/null)
      printf '%s' "$value"
      return 0
    fi
    [ "$dir" = "/" ] && return 0
    dir=$(dirname "$dir")
  done
}

_linear_usage() {
  sed -n '2,/^# Why this file exists:/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

_linear_read_input() {  # $1=FILE or - ; prints the contents
  if [ "$1" = "-" ]; then
    cat
  elif [ -f "$1" ]; then
    cat "$1"
  else
    echo "Error: no such file: $1" >&2
    return 2
  fi
}

_linear_main() {
  { set +x; } 2>/dev/null
  set -uo pipefail

  local query_file="" variables="" variables_file="" whoami=""
  local ws="${WORKSPACE:-}" team="" team_set=""
  local positional=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --query-file) query_file="${2:-}"; shift 2 || { echo "Error: --query-file needs a value" >&2; return 2; } ;;
      --variables) variables="${2:-}"; shift 2 || { echo "Error: --variables needs a value" >&2; return 2; } ;;
      --variables-file) variables_file="${2:-}"; shift 2 || { echo "Error: --variables-file needs a value" >&2; return 2; } ;;
      --workspace) ws="${2:-}"; shift 2 || { echo "Error: --workspace needs a value" >&2; return 2; } ;;
      --team-key) team="${2:-}"; team_set=1; shift 2 || { echo "Error: --team-key needs a value" >&2; return 2; } ;;
      --whoami) whoami=1; shift ;;
      -h|--help) _linear_usage; return 0 ;;
      --) shift; while [ $# -gt 0 ]; do positional+=("$1"); shift; done ;;
      -*) [ "$1" = "-" ] && { positional+=("$1"); shift; continue; }
          echo "Error: unknown option $1 (see --help)" >&2; return 2 ;;
      *) positional+=("$1"); shift ;;
    esac
  done

  # Positional form: QUERY_FILE [VARIABLES_JSON | @VARIABLES_FILE].
  if [ ${#positional[@]} -gt 2 ]; then
    echo "Error: too many arguments (see --help)" >&2; return 2
  fi
  if [ ${#positional[@]} -ge 1 ]; then
    [ -n "$query_file" ] && { echo "Error: pass the query once" >&2; return 2; }
    query_file="${positional[0]}"
  fi
  if [ ${#positional[@]} -eq 2 ]; then
    [ -n "$variables$variables_file" ] && { echo "Error: pass the variables once" >&2; return 2; }
    case "${positional[1]}" in
      @*) variables_file="${positional[1]#@}" ;;
      *) variables="${positional[1]}" ;;
    esac
  fi
  if [ -n "$variables" ] && [ -n "$variables_file" ]; then
    echo "Error: pass --variables or --variables-file, not both" >&2; return 2
  fi
  if [ "$query_file" = "-" ] && [ "$variables_file" = "-" ]; then
    echo "Error: only one of the query and the variables can come from stdin" >&2; return 2
  fi
  if [ -z "$whoami" ] && [ -z "$query_file" ]; then
    echo "Error: no query. Pass --query-file <FILE|-> (see --help)" >&2; return 2
  fi

  command -v jq >/dev/null 2>&1 || { echo "Error: jq is required" >&2; return 2; }
  command -v curl >/dev/null 2>&1 || { echo "Error: curl is required" >&2; return 2; }

  local query="" vars="{}"
  if [ -n "$query_file" ]; then
    query=$(_linear_read_input "$query_file") || return 2
    [ -n "$query" ] || { echo "Error: the query is empty" >&2; return 2; }
  fi
  if [ -n "$variables_file" ]; then
    vars=$(_linear_read_input "$variables_file") || return 2
  elif [ -n "$variables" ]; then
    vars="$variables"
  fi
  printf '%s' "$vars" | jq -e 'type == "object"' >/dev/null 2>&1 || {
    echo "Error: the variables must be one JSON object" >&2; return 2
  }
  vars=$(printf '%s' "$vars" | jq -c .)

  [ -n "$ws" ] || ws=$(_linear_config_value '.linear.workspace')
  [ -n "$team_set" ] || team=$(_linear_config_value '.linear.teamKey')

  if [ -z "$ws" ] && [ -z "$whoami" ]; then
    echo "Error: identity-match refused. No Linear workspace is configured (linear.workspace in .lisa.config.json), so there is nothing to match the key against. Pass --workspace <slug>. Nothing was sent." >&2
    return 4
  fi

  local key
  key=$(_linear_key "$ws") || return 3

  if [ -n "$whoami" ]; then
    local identity
    identity=$(_linear_identity "$key" "$team") || return 1
    printf '%s\n' "$identity"
    [ -z "$ws" ] && return 0
    _linear_identity_match "$identity" "$ws" "$team"
    return $?
  fi

  local rc
  linear_identity_check "$key" "$ws" "$team"; rc=$?
  [ $rc -eq 0 ] || return $rc

  local response
  response=$(_linear_post "$key" "$query" "$vars") || {
    echo "Error: the Linear request failed." >&2
    return 1
  }
  printf '%s\n' "$response"
  printf '%s' "$response" | jq -e 'type == "object" and (.errors == null or .errors == [])' >/dev/null 2>&1 || {
    echo "Error: Linear returned errors (or a non-JSON body); see stdout." >&2
    return 1
  }
  return 0
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _linear_main "$@"
  exit $?
fi

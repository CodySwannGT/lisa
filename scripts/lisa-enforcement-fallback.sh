#!/usr/bin/env bash
#
# Run Lisa's Bash enforcement guards when the plugin that normally provides them
# is not installed.
#
# Every PreToolUse guard — block-no-verify, parity-safety-net,
# block-shell-json-parsing, block-instruction-file-edits,
# block-direct-issue-create — is declared in the
# Lisa plugin. A cloud session
# installs plugins at session start from the marketplace the repository
# declares, and when that does not happen the container runs with
# `installed_plugins.json` empty and no enforcement whatsoever.
#
# That is how a dispatched session committed with `--no-verify`: not by evading
# a guard, but in an environment where none existed. The guards failed open, and
# silently, which is the worst of the three ways they could fail.
#
# A repository hook is the delivery that cannot fail this way. `.claude/settings.json`
# is part of the clone, so it reaches a cloud session whether or not a plugin
# ever installs.
set -uo pipefail

payload="$(cat)"

# `:-` substitutes on unset and on set-but-empty, and on nothing else. A value
# of " " is neither: `-n " "` is true, so it used to survive the emptiness test
# below, every candidate path became " /scripts/lisa-hooks/..." , no file
# matched, and every guard was skipped. That is the empty-string-fallback class
# verbatim — a value that passes the truthiness test, normalizes to nothing, and
# makes the downstream match find nothing.
#
# So the variable is trimmed FIRST and the substitution keyed off the trimmed
# value. Whitespace then reaches `git rev-parse` exactly as an unset variable
# does, instead of resolving to a root that cannot exist.
repo_root="${CLAUDE_PROJECT_DIR-}"
repo_root="${repo_root#"${repo_root%%[![:space:]]*}"}"
repo_root="${repo_root%"${repo_root##*[![:space:]]}"}"
if [ -z "$repo_root" ]; then
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
fi
# No root at all means no repository to protect — a tool call outside any
# checkout. That is a genuine absence of subject matter, not a missing guard,
# and is the one case that still stands down.
[ -n "$repo_root" ] || exit 0

# There is deliberately no skip here, and that is the whole point.
#
# This used to stand down when `installed_plugins.json` mentioned `lisa@lisa`,
# to avoid running every guard twice on a developer machine. The question that
# has to be answered is "are the plugin's guards running in this session?" and
# the file being consulted answers "has this plugin ever been installed, for any
# project, on this machine?". Those come apart three ways, and in each one both
# layers were off:
#
#   - Project-blind. The registry is keyed by plugin with an array of per-project
#     entries, so the grep matched the key. One project installing Lisa disabled
#     the fallback for every other project on the machine.
#   - Enablement-blind. `enabledPlugins` can set a plugin to false without
#     removing its registry entry, so the plugin guards were off while this file
#     believed they were on.
#   - Session-blind. Hooks load at session start; the registry is written on any
#     install or update. A plugin updated four minutes into a session leaves the
#     registry saying "installed" for the rest of it, with no plugin hooks
#     loaded. That is the one that was caught in the wild: a write to AGENTS.md
#     went through in a session where both guard copies exit 2 for that exact
#     payload.
#
# The first two are fixable with a better lookup. The third is not: plugin-hook
# liveness is not observable from a repository hook. CLAUDE_PLUGIN_ROOT is set
# only for plugin hooks, and nothing on disk distinguishes "registered" from
# "loaded into this session". Any check against a file answers a different
# question and will drift from the real one again.
#
# So the guards run unconditionally. On a machine where the plugin hooks are also
# live that costs a duplicated sweep (~170ms) and a refusal printed twice, and
# that is the correct trade against enforcement silently switching itself off.
# Recovering it belongs in the guards — a marker keyed on session and payload, so
# whichever layer fires first does the work — not in a liveness guess here.


# Where the guards live depends on which repository this is.
#
# `plugins/lisa/hooks/` exists only in the Lisa monorepo. A host project gets
# the same scripts written into its checkout by `lisa apply`, because a host
# project whose plugin install fails has exactly the same hole and no
# `plugins/` directory to fall back on.
#
# Resolution is first-wins PER GUARD: `scripts/lisa-hooks/` shadows
# `plugins/lisa/hooks/` outright, and the shadowed copy never runs at all. So
# the aggregate below spans the six guards, not two copies of one guard. The
# distinction is worth stating because it decides what "the oldest copy
# governs" means here: a guard is governed by whichever tree is FIRST, never by
# whichever tree is newest, and the loser is silent by construction.
host_tree="$repo_root/scripts/lisa-hooks"
plugin_tree="$repo_root/plugins/lisa/hooks"

# ---------------------------------------------------------------------------
# Vintage
#
# Enforcement resolves from THE CHECKOUT, never from npm. Publishing a guard
# fix and refreshing the marketplace does not reach the copy governing an agent
# working in a branch cut before that fix — and because the aggregate takes the
# strongest refusal, the oldest resolved copy governs (CodySwannGT/lisa#3205).
# One guard measured 22/22 on `main`, 22/22 in the installed clone, and 19/22
# on the copy actually in force on the machine the fix had been written on.
#
# None of that was observable from inside a refusal, which is the defect. A
# stale copy's block reads as the guard being WRONG rather than OLD, so the
# operator's available move is to route around it — and a guard routed around
# protects nothing. Dating every copy, and naming the producing copy in every
# refusal, turns that into a one-line diagnosis.
#
# Three constraints shape how the dating is done, and each rules something out:
#
#   - It runs on EVERY tool call, so nothing here may fork. Versions are read
#     with the `read` builtin, matched with bash's own regex, and returned
#     through globals rather than `$(...)`, which would fork a subshell per
#     lookup.
#   - It must work offline, and there is no network lookup anywhere below. A
#     guard that stalls or fails when the network does is a guard whoever it
#     slows down switches off.
#   - It compares only against evidence on the same disk. Staleness is claimed
#     only when a demonstrably newer Lisa can be pointed at, so the worst case
#     is silence rather than a fleet-wide false alarm.
#
# Bash 3.2 is the floor — macOS ships it as /bin/bash, and that is what the
# `.claude/settings.json` entry invokes — so there are no associative arrays
# here. There are exactly two possible trees, which is what makes plain
# variables enough.

# Result of the last read_json_version call. A global because command
# substitution forks and this runs on every tool call.
json_version=""

# The version a JSON file states, without forking or requiring jq.
#
# Deliberately the FIRST occurrence of the key: in all three files read here —
# a package manifest, a plugin manifest, the apply receipt — that occurrence is
# the top-level one. A file that does not state the key leaves the result
# empty, which is reported as an unknown vintage rather than guessed at.
read_json_version() {
  json_version=""
  [ -f "$1" ] || return 1
  # Built as a variable and matched unquoted: in bash 3.2 a quoted portion of
  # an `=~` pattern is literal text, so an inline pattern would stop being a
  # regex on exactly the interpreter this has to work under.
  local pattern="\"$2\"[[:space:]]*:[[:space:]]*\"([^\"]+)\""
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ $pattern ]]; then
      json_version="${BASH_REMATCH[1]}"
      return 0
    fi
  done <"$1"
  return 1
}

# Numeric release fields of the last split_version call.
v1=0
v2=0
v3=0

# Split a dotted version into its three numeric fields.
#
# A field that is not a plain number becomes 0 rather than erroring the
# comparison, so a version string this does not understand is never treated as
# newer than one it does — the direction that produces silence instead of a
# false staleness claim.
split_version() {
  local rest="${1%%-*}"
  rest="${rest%%+*}"
  v1="${rest%%.*}"
  case "$rest" in *.*) rest="${rest#*.}" ;; *) rest="" ;; esac
  v2="${rest%%.*}"
  case "$rest" in *.*) rest="${rest#*.}" ;; *) rest="" ;; esac
  v3="${rest%%.*}"
  case "$v1" in '' | *[!0-9]*) v1=0 ;; esac
  case "$v2" in '' | *[!0-9]*) v2=0 ;; esac
  case "$v3" in '' | *[!0-9]*) v3=0 ;; esac
}

# Whether the first version names an older Lisa than the second. Any
# prerelease or build suffix is ignored; only the release fields are compared.
version_older() {
  local a1 a2 a3
  split_version "$1"
  a1="$v1"
  a2="$v2"
  a3="$v3"
  split_version "$2"
  if [ "$a1" -ne "$v1" ]; then
    [ "$a1" -lt "$v1" ]
    return
  fi
  if [ "$a2" -ne "$v2" ]; then
    [ "$a2" -lt "$v2" ]
    return
  fi
  [ "$a3" -lt "$v3" ]
}

# The newest Lisa this machine can be SHOWN to have, and the file proving it.
#
# A maximum over every local source, rather than one nominated reference, and
# that choice is load-bearing in both directions. In the Lisa monorepo
# `node_modules/@codyswann/lisa` is a fixture pinned majors behind the repo
# itself, so treating it as "the installed release" would report every current
# checkout as ahead and never report a stale one. In a host project it is the
# most meaningful reference available. A maximum needs no ranking between them,
# and it cannot invent staleness: a copy is behind only when something newer is
# sitting on the same disk.
newest_version=""
newest_source=""

# Fold one candidate version into the maximum, ignoring an empty one.
note_version() {
  [ -n "$1" ] || return 0
  if [ -z "$newest_version" ] || version_older "$newest_version" "$1"; then
    newest_version="$1"
    newest_source="$2"
  fi
}

# The marketplace clone is the installed release in the literal sense — it is
# the copy `claude plugin` put on this machine, and it is a full checkout of
# Lisa, so it dates itself.
config_dir="${CLAUDE_CONFIG_DIR-}"
[ -n "$config_dir" ] || config_dir="${HOME-}/.claude"
marketplace_manifest="$config_dir/plugins/marketplaces/lisa/plugins/lisa/.claude-plugin/plugin.json"
if read_json_version "$marketplace_manifest" version; then
  note_version "$json_version" "$marketplace_manifest"
fi

installed_manifest="$repo_root/node_modules/@codyswann/lisa/package.json"
if read_json_version "$installed_manifest" version; then
  note_version "$json_version" "$installed_manifest"
fi

# `scripts/lisa-hooks/` is written into a host by `lisa apply`, and the apply
# receipt records which Lisa version performed that write. The receipt IS that
# tree's vintage: the same run produced both, so they cannot disagree.
host_tree_version=""
if read_json_version "$repo_root/.lisa/apply-receipt.json" lisa_version; then
  host_tree_version="$json_version"
fi
note_version "$host_tree_version" "$host_tree"

# `plugins/lisa/hooks/` is the Lisa monorepo's own copy, dated by the plugin
# manifest beside it, which the release bumps in lockstep with the package.
plugin_tree_version=""
if read_json_version "$repo_root/plugins/lisa/.claude-plugin/plugin.json" version; then
  plugin_tree_version="$json_version"
fi
note_version "$plugin_tree_version" "$plugin_tree"

# Description of the last describe_vintage call.
vintage_label=""

# A one-line description of a copy's age, used by both the notice and the
# attribution line.
#
# An absent version is reported, not skipped. A copy with no dateable manifest
# beside it cannot be shown to be current, and reading it as current is exactly
# how a stale copy stays invisible — the failure mode this whole section is
# here to end.
describe_vintage() {
  if [ -z "$1" ]; then
    vintage_label="vintage unknown"
  elif [ -n "$newest_version" ] && version_older "$1" "$newest_version"; then
    vintage_label="lisa $1, STALE — $newest_version is on this machine"
  else
    vintage_label="lisa $1"
  fi
}

# ---------------------------------------------------------------------------
# Resolution
#
# Resolving every guard before running any of them is what lets the staleness
# notice be printed BEFORE the first refusal rather than after it. An operator
# who learns a copy is old only once it has already blocked something has been
# told too late to act on it.
guard_count=0
guard_names=()
guard_scripts=()
guard_versions=()
missing=""
shadowed=""
host_tree_used=0
plugin_tree_used=0

for guard in block-no-verify parity-safety-net block-shell-json-parsing \
  block-instruction-file-edits block-direct-issue-create \
  block-managed-file-edits; do
  if [ -f "$host_tree/$guard.sh" ]; then
    guard_names+=("$guard")
    guard_scripts+=("$host_tree/$guard.sh")
    guard_versions+=("$host_tree_version")
    guard_count=$((guard_count + 1))
    host_tree_used=1
    # The shadowed copy never runs, and nothing used to say so. Two copies of
    # one guard on a disk are two vintages of it more often than not, and the
    # one in force is the one that is first in this list — which is not a
    # statement about which is newer.
    if [ -f "$plugin_tree/$guard.sh" ]; then
      shadowed="${shadowed:+$shadowed, }$guard"
    fi
  elif [ -f "$plugin_tree/$guard.sh" ]; then
    guard_names+=("$guard")
    guard_scripts+=("$plugin_tree/$guard.sh")
    guard_versions+=("$plugin_tree_version")
    guard_count=$((guard_count + 1))
    plugin_tree_used=1
  else
    missing="${missing:+$missing, }$guard"
  fi
done

# Zero guards resolved is a refusal, not a pass.
#
# Six misses used to leave the status at 0, so nothing distinguished "every
# guard ran and none objected" from "no guard was found". That is the silent
# fail-open this file was written to close, reproduced one layer down: a host
# whose `scripts/lisa-hooks/` was never written by `lisa apply`, or was
# deleted, or drifted — precisely the state this file exists for — got the same
# green as a clean session.
#
# Refusing rather than warning is a deliberate choice between two imperfect
# options, and the reasons are these.
#
#   - The hook entry and the guards ship from the SAME `lisa apply`:
#     `all/merge/.claude/settings.json` registers this dispatcher and
#     `all/copy-overwrite/scripts/lisa-hooks/` writes the guards. "Registered
#     but no guards" is therefore never a configuration anyone chose; it is
#     always drift, deletion, or a partial apply.
#   - Warning on exit 0 is barely louder than silence. Claude Code shows a
#     zero-status hook's output to the user in transcript mode only and never
#     to the agent, so "fail loud, exit unchanged" would have left the failure
#     very nearly as invisible as it already was while claiming to have fixed
#     it.
#   - The blocking cost is bounded and recoverable without the agent. The
#     refusal below names the guards, both searched paths, and the one command
#     that repairs it, which a human runs in a terminal — no tool call needed.
#
# The scope is deliberately "zero", not "fewer than six". A partial resolution
# means some enforcement ran, and version skew across an interrupted apply is a
# real enough way to reach it that refusing there would trade a silent hole for
# a noisy outage. What a partial resolution DOES get is the notice below, which
# names the vintage of each tree that did resolve.
if [ "$guard_count" -eq 0 ]; then
  cat >&2 <<EOF
Blocked: Lisa's enforcement guards are missing from this repository, so this
tool call was checked by nothing at all.

This hook is registered in .claude/settings.json but resolved none of the
guards it dispatches: $missing

Searched:
  $host_tree/<guard>.sh
  $plugin_tree/<guard>.sh

Refused rather than allowed on purpose. A dispatcher that resolves nothing is
indistinguishable from one that was never installed, and letting the call
through would be the silent fail-open this hook exists to close.

To repair, run this in a terminal outside the agent session:
  npx @codyswann/lisa apply
EOF
  exit 2
fi

# ---------------------------------------------------------------------------
# The staleness notice, printed before any guard can refuse anything.
#
# It fires only on a tree that is behind or undateable, so a current checkout
# stays silent and this never becomes noise anyone learns to skip past.
stale_notice=""

# The repair differs by tree, and getting that wrong makes the notice useless.
#
# `lisa apply` refreshes `scripts/lisa-hooks/` because it wrote it. It does not
# touch `plugins/lisa/hooks/`, which IS the Lisa monorepo's own source: a
# checkout behind the release is behind because of its branch, and the only
# thing that moves it is moving the branch. Printing one repair for both would
# hand half the fleet an instruction that changes nothing — a refusal whose
# remedy cannot be followed (CodySwannGT/lisa#3191).
HOST_REPAIR="run \`npx @codyswann/lisa apply\` to rewrite these guards"
PLUGIN_REPAIR="update this checkout — these guards are its own source, so \`lisa apply\` does not refresh them"

# Add one tree to the notice, if there is anything to say about it.
note_tree_staleness() {
  if [ -z "$2" ]; then
    stale_notice="$stale_notice  $1 — vintage unknown (no Lisa manifest beside it), so it cannot be shown current
      repair: $3
"
  elif [ -n "$newest_version" ] && version_older "$2" "$newest_version"; then
    stale_notice="$stale_notice  $1 — lisa $2, behind $newest_version at $newest_source
      repair: $3
"
  fi
}

if [ "$host_tree_used" -eq 1 ]; then
  note_tree_staleness "$host_tree" "$host_tree_version" "$HOST_REPAIR"
fi
if [ "$plugin_tree_used" -eq 1 ]; then
  note_tree_staleness "$plugin_tree" "$plugin_tree_version" "$PLUGIN_REPAIR"
fi

if [ -n "$stale_notice" ] || [ -n "$shadowed" ]; then
  {
    printf 'Lisa enforcement is running guards from this checkout, not from npm,\n'
    printf 'so publishing a guard fix does not reach the copies below.\n'
    if [ -n "$stale_notice" ]; then
      printf '%s' "$stale_notice"
    fi
    if [ -n "$shadowed" ]; then
      printf '  %s shadows %s for: %s (the shadowed copy never runs)\n' \
        "$host_tree" "$plugin_tree" "$shadowed"
    fi
  } >&2
fi

# ---------------------------------------------------------------------------
# Dispatch
status=0
index=0
while [ "$index" -lt "$guard_count" ]; do
  script="${guard_scripts[$index]}"
  # Each guard reads the tool payload on stdin and signals a refusal with exit
  # 2. The payload is replayed to every one of them, and the strongest refusal
  # is returned — a guard that declines must not be able to clear one that did
  # not.
  #
  # The status is captured from the pipeline directly rather than through `if !`,
  # where `$?` is the negation and every refusal read as success: the guard
  # printed its objection and the command ran anyway, which is the same
  # fail-open this file exists to close.
  printf '%s' "$payload" | bash "$script"
  guard_status=$?
  # Attribution, printed immediately after the guard's own objection so the two
  # arrive together.
  #
  # Without it a refusal is anonymous: six guards resolved from up to two trees
  # of different ages produce one exit code between them, and an operator
  # cannot tell which copy objected, how old that copy is, or that the copies
  # disagreed at all. Naming the file and its vintage is the difference between
  # "the guard is wrong" and "this copy is three releases behind", and only the
  # second has an action attached to it.
  if [ "$guard_status" -ne 0 ]; then
    describe_vintage "${guard_versions[$index]}"
    if [ "$guard_status" -eq 2 ]; then
      printf 'Refused by %s (%s)\n' "$script" "$vintage_label" >&2
    else
      printf 'Guard %s exited %s — non-blocking error from %s (%s)\n' \
        "${guard_names[$index]}" "$guard_status" "$script" "$vintage_label" >&2
    fi
  fi
  # 2 is the ONLY status Claude Code treats as a refusal. Every other non-zero
  # is a non-blocking error: it is surfaced, and the tool call proceeds anyway.
  # So the aggregate cannot be the numerically largest status — under `-gt`, a
  # guard erroring with 3, or dying on a missing interpreter with 127,
  # outranks another guard's 2 and silently downgrades a refusal into a
  # warning. That is the precise fail-open this file exists to close,
  # reintroduced one layer up.
  #
  # 2 therefore dominates and is sticky; a lesser non-zero is only carried when
  # no guard has refused, so a genuine error is still reported when nothing
  # blocked.
  if [ "$guard_status" -eq 2 ]; then
    status=2
  elif [ "$guard_status" -ne 0 ] && [ "$status" -ne 2 ]; then
    status="$guard_status"
  fi
  index=$((index + 1))
done

exit "$status"

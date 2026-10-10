#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

#
# Run Lisa's Bash enforcement guards when the plugin that normally provides them
# is not installed.
#
# Every PreToolUse guard — block-no-verify, parity-safety-net,
# block-shell-json-parsing, block-instruction-file-edits,
# block-direct-issue-create, block-blind-automerge, worktree-binding-guard —
# is declared in the Lisa plugin. A cloud session
# installs plugins at session start from the marketplace the repository
# declares, and when that does not happen the container runs with
# `installed_plugins.json` empty and no enforcement whatsoever.
#
# That is how a dispatched session committed with `--no-verify`: not by evading
# a guard, but in an environment where none existed. The guards failed open, and
# silently, which is the worst of the three ways they could fail.
#
# A repository hook removes that plugin-delivery dependency. The project hook
# configuration is part of the clone, so the dispatcher is available whether or
# not a plugin ever installs. Each harness still applies its own project-hook
# trust policy before firing it.
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
# working in a branch cut before that fix. First-wins resolution chooses each
# guard; the strongest refusal aggregates DIFFERENT guards (#3205).
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
#   - Already-noticed permitted calls perform no diagnostic reads or forks.
#     Notices/refusals use one bounded optional helper per process, off that
#     hot path, to validate JSON and compare selected entry-file bytes.
#   - It must work offline, and there is no network lookup anywhere below. A
#     guard that stalls or fails when the network does is a guard whoever it
#     slows down switches off.
#   - Host content differences are not a claim of older/newer code. Historical
#     receipt versions never date current bytes. Plugin-channel age remains a
#     distinct version-backed diagnostic; missing evidence is explicit unknown.
#
# Bash 3.2 is the floor — macOS ships it as /bin/bash, and that is what the
# repository hook entry invokes — so there are no associative arrays
# here. There are exactly two possible trees, which is what makes plain
# variables enough.

# The receipt records history, not the current contents of a selected guard.
# Read strict bounded JSON and actual selected host/template pairs only when a
# notice or refusal needs evidence. The optional Node helper is shipped beside
# this dispatcher; its absence cannot alter enforcement, only make evidence
# unknown. There is no network, directory scan or persistent content cache.
installed_version=""
last_applied_version=""
host_guard_states=()

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

# Whether resolve_vintages has already run.
vintages_resolved=0

# Fold one candidate version into the maximum, ignoring an empty one.
note_version() {
  [ -n "$1" ] || return 0
  if [ -z "$newest_version" ] || version_older "$newest_version" "$1"; then
    newest_version="$1"
    newest_source="$2"
  fi
}

plugin_tree_version=""

# Node cannot supervise its own stalled startup. A directly forked Bash job owns
# a live group anchor and an independent builtin-read timer. No second Bash is
# exec'd, so its BASH_ENV and native ps startup cannot precede that timer. The
# parent passes only its fresh live job identity through a private FIFO; the
# child qualifies that group before Node starts and drains its OWN group while
# its anchor still pins the identity. No later external numeric signal is used.
# Only this optional subprocess is bounded; enforcement below is unchanged.
run_optional_freshness() (
  command -v mkfifo >/dev/null 2>&1 || exit 1
  # Bash 3.2 unwinds function locals before EXIT on an explicit exit inside
  # command substitution. This function already isolates all state in a subshell.
  scratch="" anchor="" scratch_identity="" current_identity="" helper_status=1
  [ -n "$notice_temp_base" ] && notice_parent_chain_trusted "$notice_temp_base" || exit 1
  scratch="$(umask 077 && mktemp -d "$notice_temp_base/lisa-freshness.XXXXXX")" || exit 1
  case "$scratch" in "$notice_temp_base"/lisa-freshness.*) ;; *) exit 1 ;; esac
  [ -d "$scratch" ] && [ ! -L "$scratch" ] && [ -O "$scratch" ] || exit 1
  scratch_identity="$(stat -f '%d:%i:%Lp' "$scratch" 2>/dev/null)" ||
    scratch_identity="$(stat -c '%d:%i:%a' "$scratch" 2>/dev/null)" || exit 1
  [ "${scratch_identity##*:}" = 700 ] || exit 1
  cleanup_diagnostic() {
    if [ -n "$anchor" ]; then
      printf 'stop\n' >&8
      wait "$anchor" 2>/dev/null || true
    fi
    exec 8>&- 9>&-
    current_identity="$(stat -f '%d:%i:%Lp' "$scratch" 2>/dev/null)" ||
      current_identity="$(stat -c '%d:%i:%a' "$scratch" 2>/dev/null)" || current_identity=""
    if [ "$current_identity" = "$scratch_identity" ] &&
      [ -d "$scratch" ] && [ ! -L "$scratch" ] && [ -O "$scratch" ] &&
      notice_parent_chain_trusted "$notice_temp_base"; then
      rm -rf "$scratch"
    fi
  }
  trap cleanup_diagnostic EXIT
  trap 'exit 1' HUP INT TERM
  mkfifo "$scratch/start" "$scratch/done" || exit 1
  exec 8<>"$scratch/start" 9<>"$scratch/done" || exit 1
  builtin set -m
  (
    # A fork inherits the parent's traps and $$ on Bash 3.2. Reset the traps,
    # and never mistake inherited $$ for this fresh job's process-group identity.
    builtin trap - EXIT HUP INT TERM
    builtin set +m
    builtin read -r -t 1 -u 8 admission || exit 1
    case "$admission" in anchor:*) group="${admission#anchor:}" ;; *) exit 1 ;; esac
    case "$group" in ''|*[!0-9]*|0*) exit 1 ;; esac
    # Bash can continue after a setpgid failure. Job-table admission alone is
    # insufficient: require the fresh group to exist before work or signaling.
    builtin kill -0 -- -"$group" 2>/dev/null || exit 1
    (
      node "$@" </dev/null >"$scratch/output" 2>/dev/null
      builtin printf "%s\n" "$?" >"$scratch/status"
      builtin printf "done\n" >&9
    ) &
    # Bash 3.2 accepts integer timeouts. One second leaves headroom beneath
    # the two-second diagnostic ceiling without delaying real enforcement.
    if builtin read -r -t 1 -u 9 done && [ "$done" = done ]; then
      builtin printf "complete\n" >"$scratch/complete"
      builtin read -r -t 1 -u 8 stop || true
    fi
    builtin kill -KILL -- -"$group"
  ) &
  anchor=$!
  if [ "$(builtin jobs -pr)" = "$anchor" ]; then
    # Preauthorize termination only after the helper finishes. This removes
    # parent polling and external sleep startup without accepting partial facts.
    builtin printf 'anchor:%s\nstop\n' "$anchor" >&8
  fi
  builtin wait "$anchor" 2>/dev/null || true
  anchor=""
  [ -f "$scratch/complete" ] && [ -f "$scratch/status" ] || exit 1
  read -r helper_status <"$scratch/status"
  [ "$helper_status" = 0 ] || exit 1
  cat "$scratch/output"
)

# Do not promote even one partial fact. Successful exit plus a terminal protocol
# row and every requested guard result are required before globals are changed.
valid_freshness_result() {
  local line key value seen="|" complete=0 count=0
  while IFS= read -r line; do
    [ "$complete" -eq 0 ] || return 1
    case "$line" in *$'\t'*) ;; *) return 1 ;; esac
    key="${line%%$'\t'*}"
    value="${line#*$'\t'}"
    case "$value" in ''|*$'\t'*|*$'\r'*) return 1 ;; esac
    case "$seen" in *"|$key|"*) return 1 ;; esac
    seen="$seen$key|"
    case "$key" in
      installed|applied|plugin|marketplace|channel)
        [[ "$value" =~ ^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}([-+][A-Za-z0-9.-]{1,48})?$ ]] || return 1 ;;
      channel_path) ;;
      guard[0-7])
        [ "${key#guard}" -lt "$guard_count" ] || return 1
        case "$value" in matching|different|unknown) ;; *) return 1 ;; esac
        count=$((count + 1)) ;;
      complete) [ "$value" = 1 ] || return 1; complete=1 ;;
      *) return 1 ;;
    esac
  done <<< "$1"
  [ "$complete" -eq 1 ] && [ "$count" -eq "$guard_count" ]
}

# Resolve once PER PROCESS at the existing lazy diagnostic boundary. A later
# refusal in the same session gets fresh content evidence in its new process;
# an already-noticed permitted call invokes neither Node nor a comparison.
resolve_vintages() {
  [ "$vintages_resolved" -eq 0 ] || return 0
  vintages_resolved=1
  local config_dir="${CLAUDE_CONFIG_DIR-}"
  [ -n "$config_dir" ] || config_dir="${HOME-}/.claude"
  local helper="${BASH_SOURCE[0]%/*}/lisa-enforcement-freshness.mjs"
  local key value state_index result
  local state_count=0
  while [ "$state_count" -lt "$guard_count" ]; do
    host_guard_states+=("unknown")
    state_count=$((state_count + 1))
  done
  if [ -f "$helper" ] && [ -r "$helper" ] && command -v node >/dev/null 2>&1 &&
    result="$(run_optional_freshness "$helper" "$repo_root" "$config_dir" "${guard_evidence_names[@]}" 2>/dev/null)" &&
    valid_freshness_result "$result"; then
    while IFS=$'\t' read -r key value; do
      case "$key" in
        installed) installed_version="$value" ;;
        applied) last_applied_version="$value" ;;
        plugin) plugin_tree_version="$value" ;;
        marketplace) note_version "$value" "$config_dir/plugins/marketplaces/lisa/plugins/lisa/.claude-plugin/plugin.json" ;;
        channel) plugin_channel_version="$value" ;;
        channel_path) plugin_channel_path="$value" ;;
        guard[0-7])
          state_index="${key#guard}"
          case "$value" in matching|different|unknown) host_guard_states[$state_index]="$value" ;; esac
          ;;
      esac
    done <<< "$result"
  fi
  note_version "$installed_version" "$repo_root/node_modules/@codyswann/lisa/package.json"
  note_version "$plugin_tree_version" "$plugin_tree"
}

# ---------------------------------------------------------------------------
# The other channel
#
# YOU CANNOT RETIRE A REFUSAL BY SHIPPING A FIX.
#
# These guards reach an agent by two independent channels: this dispatcher,
# registered in `.claude/settings.json`, and the plugin manifest, which
# registers the same guards individually. An agent sees the UNION of the two
# verdicts, so a TIGHTENING on either channel takes effect at once while a
# RELAXATION is inert until the slower channel catches up — the stale copy goes
# on refusing, and its refusal wins. What the operator sees is a guard blocking
# something `main` already permits, which reads as the guard being WRONG rather
# than OLD, and the move that reading suggests is to route around it.
#
# The two channels are two different files refreshed by two different
# mechanisms: `scripts/lisa-hooks/` when `lisa apply` runs, the plugin's own
# `hooks/` when the plugin updates. They drift. Measured on one machine on one
# day, two checkouts of the SAME repository resolved plugin 4.32.2 and 4.47.0.
#
# `plugin_tree` above cannot see any of that: it is repo-relative, so it exists
# only inside the Lisa monorepo, and in a host project the plugin actually in
# force is somewhere else entirely. The vintage machinery written for #3205
# was therefore blind to the channel it races. This resolves it properly, from
# the record the runtime itself keeps.
#
# WHAT THIS RECORD CAN AND CANNOT ANSWER. The header above explains why a
# previous stand-down keyed on `installed_plugins.json` was removed: the record
# is project-blind as it was read then, enablement-blind (`enabledPlugins` can
# switch a plugin off without removing its entry), and session-blind (hooks load
# at session start; the record is rewritten on any install). Those defeat a
# LIVENESS question — "are the plugin's guards running in this session?" — and
# nothing on disk answers that one.
#
# This asks a different question: "what VINTAGE is the plugin installed for this
# project?" The record answers that directly, and the project-blindness is
# resolved by keying the lookup on this repo root rather than on the plugin name.
# The remaining two blindnesses bound the claim rather than break it: a skew
# reported here is a real difference between two copies on disk, but a disabled
# or not-yet-loaded plugin may mean those copies are not both firing right now.
# So the wording below reports what is INSTALLED and what the union WOULD mean,
# and never asserts that both channels are live. Reporting is also why this may
# use the record at all where a stand-down may not: an over-reported skew costs
# a line of notice, while an over-confident stand-down costs enforcement.
plugin_channel_version=""
plugin_channel_path=""

# The bounded helper reads the runtime record for exactly lisa@lisa and this
# project. It reports installed version/path, never whether hooks are live.

# Verdict of the last classify_channel_skew call: agree | skew | undetermined.
#
# Three answers, never two. "The channels agree" and "I could not read one of
# them" are DIFFERENT facts, and collapsing them is how a probe reports success
# while measuring nothing.
#
# THIS PROBE REPORTS. IT NEVER BLOCKS. A permitted command stays permitted
# whatever the verdict, and the finding goes into the once-per-session notice.
# That is a decision, not an oversight, so here is the reasoning for whoever
# comes to change it:
#
#   - The two error directions have asymmetric costs. An over-reported skew
#     costs a line of notice; an over-confident stand-down costs enforcement.
#     When the costs are that lopsided the direction is settled without needing
#     to argue about likelihood.
#   - Failing closed on `undetermined` would refuse work on every host with no
#     `installed_plugins.json` — containers, fresh clones, non-Claude runtimes.
#     That is a large population with nothing wrong with it, and refusing them
#     is a bigger fault than the one being detected.
#   - What is detected is two copies at different AGES, not a compromised
#     guard. Blocking on it turns a diagnostic into an outage.
#   - And the practical argument, which beats the principled one: skew is the
#     common case on a developer machine right now, so as a blocker this would
#     be a permanent stop-work and the first response would be to switch it
#     off. A blocker everyone turns off protects nothing.
#
# Pinned by the test named "lets a permitted command through whatever the
# verdict is", which asserts exit 0 on both the skew and undetermined arms.
channel_skew_verdict="undetermined"
channel_skew_line=""

# Compare the vintage of the channel this dispatcher runs against the vintage
# of the channel the plugin manifest runs.
classify_channel_skew() {
  local mine=""
  local source=""
  local tree
  local channel_repair=""
  local compared=0
  channel_skew_line=""
  channel_skew_verdict="undetermined"
  for tree in host plugin; do
    if [ "$tree" = host ] && [ "$host_tree_used" -eq 1 ]; then
      mine="$installed_version"
      source="installed Lisa package"
    elif [ "$tree" = plugin ] && [ "$plugin_tree_used" -eq 1 ]; then
      mine="$plugin_tree_version"
      source="this checkout's plugin manifest"
    else
      continue
    fi
    if [ -z "$mine" ] || [ -z "$plugin_channel_version" ]; then
      channel_skew_line="$channel_skew_line  cross-channel vintage UNDETERMINED — $source could not be
    compared with the plugin manifest's installed copies. Not agreement:
    missing version evidence does not establish either channel's age or liveness.
"
    elif [ "$mine" != "$plugin_channel_version" ]; then
      channel_skew_verdict="skew"
      if version_older "$plugin_channel_version" "$mine"; then
        channel_repair="update the installed plugin for this project"
      elif version_older "$mine" "$plugin_channel_version"; then
        if [ "$tree" = host ]; then
          channel_repair="update the installed Lisa package, then inspect guard/template content differences before choosing a template refresh"
        else
          channel_repair="$PLUGIN_REPAIR"
        fi
      else
        channel_repair="inspect the differing installed channel versions; their release fields do not establish an older channel"
      fi
      channel_skew_line="$channel_skew_line  cross-channel vintage SKEW — $source is lisa $mine; the plugin
    installed for this project is lisa $plugin_channel_version at $plugin_channel_path.
    These are installed channel versions, not a date for current host guard bytes.
    When both fire on one tool call the agent sees the UNION of their verdicts:
      YOU CANNOT RETIRE A REFUSAL BY SHIPPING A FIX.
    A relaxation on one channel stays inert until the other catches up.
      repair: $channel_repair;
      host content differences, if any, are reported separately below.
"
      compared=1
    else
      compared=1
    fi
  done
  if [ "$compared" -eq 1 ] && [ -z "$channel_skew_line" ]; then
    channel_skew_verdict="agree"
  fi
}

# Description of the last describe_vintage call.
vintage_label=""

# Whether that copy could NOT be shown current — stale, or undateable. Kept as a
# flag rather than re-read out of the label, because a refusal has to branch on
# it and matching on the word "STALE" inside prose is the kind of coupling that
# breaks the first time the wording is improved.
vintage_is_stale=0

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
    vintage_is_stale=1
  elif [ -n "$newest_version" ] && version_older "$1" "$newest_version"; then
    vintage_label="lisa $1, STALE — $newest_version is on this machine"
    vintage_is_stale=1
  else
    vintage_label="lisa $1"
    vintage_is_stale=0
  fi
}

# Content state is per selected guard. Neither an equal package/receipt
# version nor some OTHER matching guard can prove this refusing copy current.
# Unknown evidence suggests inspection, not applying over already-matching code.
describe_host_guard() {
  vintage_is_stale=1
  local facts="installed lisa ${installed_version:-unknown}; last applied lisa ${last_applied_version:-unknown}"
  case "${host_guard_states[$1]-unknown}" in
    matching)
      vintage_label="matches installed template; $facts"
      vintage_is_stale=0
      ;;
    different) vintage_label="DIFFERENT from installed template; $facts" ;;
    *) vintage_label="host content unknown; $facts" ;;
  esac
}

host_guard_repair() {
  if [ "${host_guard_states[$1]-unknown}" = different ]; then
    printf '%s' "$HOST_REPAIR"
  else
    printf 'inspect the selected guard and installed Lisa template evidence (missing, unreadable, invalid or beyond bounds); content freshness is unknown'
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
guard_trees=()
guard_evidence_names=()
missing=""
shadowed=""
host_tree_used=0
plugin_tree_used=0

for guard in block-no-verify parity-safety-net block-shell-json-parsing \
  block-instruction-file-edits block-direct-issue-create \
  block-managed-file-edits block-blind-automerge worktree-binding-guard; do
  if [ -f "$host_tree/$guard.sh" ]; then
    guard_names+=("$guard")
    guard_scripts+=("$host_tree/$guard.sh")
    # The TREE, not its version: vintages are resolved lazily, so what a guard
    # records here is which tree to ask about it later.
    guard_trees+=("host")
    guard_evidence_names+=("$guard")
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
    guard_trees+=("plugin")
    guard_evidence_names+=("")
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
#     `.claude/settings.json` or `.codex/hooks.json` registers this dispatcher and
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
# names both the vintage of each tree that resolved and every guard that did
# not.
if [ "$guard_count" -eq 0 ]; then
  cat >&2 <<EOF
Blocked: Lisa's enforcement guards are missing from this repository, so this
tool call was checked by nothing at all.

This hook is registered in the repository hook configuration but resolved none
of the guards it dispatches: $missing

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
# The staleness notice, printed before any guard can refuse anything — ONCE
# PER SESSION, not once per tool call.
#
# The first draft of this fired whenever a resolved tree was behind, on the
# reasoning that a current checkout would stay silent. Measured on this
# repository and this fleet, that reasoning is wrong twice over:
#
#   - `main` cut 80 releases in 24 hours, median gap 10 minutes. "Behind the
#     newest Lisa on this disk" is the DEFAULT state of a checkout within
#     minutes of being cut, through nothing anyone did wrong.
#   - Measured once across the host checkouts on one fleet: of those that
#     resolved guards at all, every one was behind or undateable and none was
#     current, several by a whole MAJOR — while a larger number resolved NO
#     guard at all.
#
# That second reading used to be written here as a set of counts, and that was
# the wrong place for it. A number in a comment is a measurement, not a monitor:
# it was true on the day it was taken and nothing re-took it, so the drift after
# that date was unobserved — which is the same defect the number documents. The
# counts are therefore not restated here. Re-derive them:
#
# Run these FROM A LISA MONOREPO CHECKOUT — the census and the fleet roster are
# Lisa-monorepo artifacts, and this comment travels into host projects where
# neither exists. The script wrapper builds `dist/` first, which a fresh clone
# does not have:
#
#   bun run lisa:enforcement-census              # roster on this machine
#   bun run lisa:enforcement-census -- --redact  # safe to quote publicly
#
# In a host project the local half of the same question is `lisa doctor`, which
# reports what THIS checkout resolves and needs no roster.
#
# The census reports and never gates, and it keeps "resolves NO guard" apart
# from "resolves something old" — different failures, different remedies, and
# folding them is what made the unenforced checkouts easy to miss
# (CodySwannGT/lisa#3490). `lisa doctor` carries the same finding for the single
# checkout it is run in.
#
# So no distance threshold rescues it — even the strictest version predicate is
# permanently true across the fleet. The noise is the REPETITION, not the
# distance: a banner on every tool call for a whole session is a banner people
# learn to skip past, and the guard whose output gets skipped past is the guard
# that stops being read.
#
# The rate limit therefore goes on repetition and the distance threshold stays
# at zero. Once per session an operator is told; every refusal after that still
# carries the full vintage in its attribution line, which costs nothing because
# it only prints when something has already been blocked.
#
# Failure is noisy, never silent: no session id, or a state directory that
# cannot be written, degrades to printing every time rather than to printing
# never.
session_id=""
# NOT anchored, unlike the file reads above: the hook payload arrives as a
# single line of JSON, so a line-start anchor would never match it. Measured —
# the first draft anchored this and silently found no session id at all, which
# degraded to printing the notice on every call: the exact behaviour the rate
# limit exists to remove, reintroduced by the rate limit itself.
session_pattern="\"session_id\"[[:space:]]*:[[:space:]]*\"([^\"]+)\""
if [[ "$payload" =~ $session_pattern ]]; then
  session_id="${BASH_REMATCH[1]}"
fi
# Anything that is not a plain identifier is dropped rather than escaped, so a
# hostile id cannot reach outside the state directory.
case "$session_id" in *[!A-Za-z0-9._-]* | .* ) session_id="" ;; esac

notice_uid="$(id -u 2>/dev/null || printf 'unknown')"
notice_state_dir=""
notice_marker=""

# A shared temp directory is not a trust boundary. Give each user a directory,
# create it privately, and use it only when every parent is protected from
# replacement by another uid. A private leaf is not enough below an arbitrary
# non-sticky shared TMPDIR: another user could replace that parent between the
# checks below. Root- or caller-owned parents are acceptable; any parent that
# grants group or other write access must also carry the sticky bit.
#
# The two `stat` spellings must be asked for the SAME twelve bits, and getting
# that wrong is invisible because each platform only ever runs its own branch.
# BSD `%Lp` renders the low NINE bits and drops setuid/setgid/sticky entirely:
#
#   stat -f '%Lp' <a 1777 dir>  ->  777    <- sticky gone
#   stat -f '%p'  <a 1777 dir>  ->  41777  <- sticky present, plus file type
#   stat -c '%a'  <a 1777 dir>  ->  1777   <- sticky present (GNU includes it)
#
# So under `%Lp` the sticky test below is `777 & 1000`, which is zero for every
# directory on the machine — the exemption was unreachable on macOS and the
# whole `&& [ ... 8#1000 ] -eq 0` clause was dead code there. The same logical
# root was therefore trusted on Linux and rejected on macOS, and since CI is
# Linux the stricter platform was the one nobody specified and nobody tests on
# (CodySwannGT/lisa#3691).
#
# `%p` restores the bit and adds the file type above it, so the mask normalizes
# both spellings to one value and the arithmetic below has a single meaning:
# `41777 & 7777` and `1777 & 7777` are both 1777.
notice_directory_trusted() {
  local directory="$1"
  local directory_stat=""
  local directory_owner=""
  local directory_mode=""
  local directory_mode_value=0

  directory_stat="$(stat -f '%u %p' "$directory" 2>/dev/null)" || \
    directory_stat="$(stat -c '%u %a' "$directory" 2>/dev/null)" || return 1
  directory_owner="${directory_stat%% *}"
  directory_mode="${directory_stat#* }"
  case "$directory_owner:$directory_mode" in
    *[!0-9:]* | :* | *: ) return 1 ;;
  esac
  [ "$directory_owner" = "0" ] || [ "$directory_owner" = "$notice_uid" ] || return 1
  directory_mode_value=$((8#$directory_mode & 8#7777))
  if [ $((directory_mode_value & 8#0022)) -ne 0 ] && \
    [ $((directory_mode_value & 8#1000)) -eq 0 ]; then
    return 1
  fi
}

notice_parent_chain_trusted() {
  local directory="$1"
  local current="/"
  local remainder=""
  local component=""

  case "$directory" in /* ) ;; * ) return 1 ;; esac
  notice_directory_trusted "$current" || return 1
  remainder="${directory#/}"
  while [ -n "$remainder" ]; do
    component="${remainder%%/*}"
    current="${current%/}/$component"
    notice_directory_trusted "$current" || return 1
    [ "$remainder" = "$component" ] && break
    remainder="${remainder#*/}"
  done
}

# Resolve symlinks before validating the full chain, then keep using that
# physical path. If resolution or any ownership/mode check fails, the rate
# limit stands down and the notice keeps speaking.
notice_state_trusted=0
notice_temp_base=""
if notice_temp_base="$(cd -P -- "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)" && \
  notice_parent_chain_trusted "$notice_temp_base"; then
  notice_state_dir="$notice_temp_base/lisa-enforcement-notice-$notice_uid"
  [ -n "$session_id" ] && notice_marker="$notice_state_dir/$session_id"
  if [ ! -e "$notice_state_dir" ] && [ ! -L "$notice_state_dir" ]; then
    (umask 077 && mkdir "$notice_state_dir") 2>/dev/null || true
  fi
  if [ -d "$notice_state_dir" ] && [ ! -L "$notice_state_dir" ] && \
    [ -O "$notice_state_dir" ] && chmod 700 "$notice_state_dir" 2>/dev/null; then
    notice_state_trusted=1
  fi
fi

# Whether this session has already been told. A marker that cannot be read —
# no session id, an unwritable state directory — leaves this at 1, so the
# failure mode is speaking every time rather than never.
#
# The marker is a directory because `mkdir` is an atomic test-and-claim: only
# one of several processes racing on an absent path can create it. A plain file
# plus a separate existence check leaves a window where every process decides
# the notice is due before any of them creates the marker.
notice_due=1
if [ "$notice_state_trusted" -eq 1 ] && [ -n "$notice_marker" ] && \
  [ -d "$notice_marker" ] && [ ! -L "$notice_marker" ]; then
  notice_due=0
fi

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

# EVERYTHING the notice says is gated on the session, including the shadowing
# line. That line was the bug the rate-limit test caught: `shadowed` is computed
# in the resolution loop and depends on no vintage, so it printed on every call
# of a session while the staleness lines correctly stayed quiet — the rate limit
# bypassed by its one branch that needs nothing resolved.
if [ "$notice_due" -eq 1 ]; then
  resolve_vintages
  if [ "$host_tree_used" -eq 1 ]; then
    host_notice_index=0
    while [ "$host_notice_index" -lt "$guard_count" ]; do
      if [ "${guard_trees[$host_notice_index]}" = host ]; then
        describe_host_guard "$host_notice_index"
        stale_notice="$stale_notice  ${guard_scripts[$host_notice_index]} — $vintage_label
"
        if [ "$vintage_is_stale" -eq 1 ]; then
          stale_notice="$stale_notice      repair: $(host_guard_repair "$host_notice_index")
"
        fi
      fi
      host_notice_index=$((host_notice_index + 1))
    done
  fi
  if [ "$plugin_tree_used" -eq 1 ]; then
    note_tree_staleness "$plugin_tree" "$plugin_tree_version" "$PLUGIN_REPAIR"
  fi
  classify_channel_skew

  if [ -n "$stale_notice" ] || [ -n "$shadowed" ] || [ -n "$missing" ] || \
    [ -n "$channel_skew_line" ]; then
    # Claim the session BEFORE printing. A failed `mkdir` suppresses this copy
    # only when another process left the expected real directory behind. Every
    # other failure leaves the claim unproven and prints, so an unwritable state
    # path or hostile symlink can never turn the safety notice silent.
    notice_should_print=1
    notice_claim_won=0
    if [ "$notice_state_trusted" -eq 1 ] && [ -n "$notice_marker" ] && \
      [ ! -L "$notice_marker" ]; then
      if (umask 077; mkdir "$notice_marker") 2>/dev/null; then
        notice_claim_won=1
      else
        if [ -d "$notice_marker" ] && [ ! -L "$notice_marker" ]; then
          notice_should_print=0
        fi
      fi
      # Stale markers are swept only here — once per session, off the hot path.
      if [ "$notice_claim_won" -eq 1 ]; then
        find "$notice_state_dir" -mindepth 1 -maxdepth 1 -type d -mmin +1440 \
          -delete 2>/dev/null || true
      fi
    fi
    if [ "$notice_should_print" -eq 1 ]; then
      {
        printf 'Lisa enforcement is running guards from this checkout, not from npm,\n'
        printf 'selected host contents are compared with installed templates only for diagnostics.\n'
        if [ -n "$stale_notice" ]; then
          printf '%s' "$stale_notice"
        fi
        if [ -n "$shadowed" ]; then
          printf '  %s shadows %s for: %s (the shadowed copy never runs)\n' \
            "$host_tree" "$plugin_tree" "$shadowed"
        fi
        if [ -n "$missing" ]; then
          printf '  unresolved guards: %s (no copy was dispatched)\n' "$missing"
        fi
        if [ -n "$channel_skew_line" ]; then
          printf '%s' "$channel_skew_line"
        fi
      } >&2
    fi
  fi
fi

# ---------------------------------------------------------------------------
# One evaluation per guard per tool call
#
# The guards below are also registered individually by the plugin manifest, so
# on a machine where both channels are live each one runs twice for a single
# tool call. `guard-dedupe.bash`, sourced by each guard, lets the second copy
# replay the first copy's ALLOW instead of recomputing it — and only when the
# two copies are byte-identical, on the identical payload, within the identical
# tool call. Nothing above is de-registered for it, because plugin-hook liveness
# is not observable from disk and standing down on a disk guess is how this
# dispatcher once switched enforcement off silently (CodySwannGT/lisa#3814).
#
# What is handed down here is only the state directory. `$notice_temp_base` has
# already been resolved physically and had every parent checked for ownership
# and mode, so the eight guards this loop spawns inherit that work instead of
# repeating it eight times. A guard reached by the plugin channel has no such
# parent and resolves its own; a guard that finds this variable unusable does
# the same. Exported only when the chain was trusted, so an untrusted TMPDIR
# hands down nothing rather than handing down a bad path.
if [ -n "$notice_temp_base" ] && [ "$notice_state_trusted" -eq 1 ]; then
  guard_memo_dir="$notice_temp_base/lisa-guard-memo-$notice_uid"
  if [ ! -e "$guard_memo_dir" ] && [ ! -L "$guard_memo_dir" ]; then
    (umask 077 && mkdir "$guard_memo_dir") 2>/dev/null || true
  fi
  # Unlike shared temp ancestors, memo leaves may not be writable by another
  # account even with the sticky bit: it could pre-create the session child.
  guard_memo_mode=""
  guard_memo_mode="$(stat -c '%a' "$guard_memo_dir" 2>/dev/null)" ||
    guard_memo_mode="$(stat -f '%p' "$guard_memo_dir" 2>/dev/null)" ||
    guard_memo_mode=""
  case "$guard_memo_mode" in "" | *[!0-7]*) guard_memo_mode=777 ;; esac
  if [ -d "$guard_memo_dir" ] && [ ! -L "$guard_memo_dir" ] && \
    [ -O "$guard_memo_dir" ] &&
    [ $((8#$guard_memo_mode & 8#0022)) -eq 0 ]; then
    export LISA_GUARD_MEMO_DIR="$guard_memo_dir"
    export LISA_GUARD_MEMO_UID="$notice_uid"
  fi
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
    # Resolved here rather than up front: a refusal is the one moment the
    # vintage is certainly worth its three file reads.
    resolve_vintages
    if [ "${guard_trees[$index]}" = "host" ]; then
      describe_host_guard "$index"
    else
      describe_vintage "$plugin_tree_version"
    fi
    if [ "$guard_status" -eq 2 ]; then
      printf 'Refused by %s (%s)\n' "$script" "$vintage_label" >&2
    else
      printf 'Guard %s exited %s — non-blocking error from %s (%s)\n' \
        "${guard_names[$index]}" "$guard_status" "$script" "$vintage_label" >&2
    fi
    # A verdict from a copy that cannot be shown current states its own limit,
    # here, attached to the verdict rather than to the session.
    #
    # WHY THIS IS NOT THE VINTAGE SUFFIX AGAIN. The suffix names a version; it
    # does not say what follows from it, and a version number is not an
    # instruction. The session-start notice DOES say what follows — and it is
    # rate-limited per session, so a long-running session receives it once, at
    # the beginning. One session measured 2026-09-04 had its notice written
    # 34 hours before the refusals it existed to explain, and its vintage was
    # computed at start, when there was nothing yet to report: a session that
    # begins current and goes stale while running is told nothing, ever
    # (CodySwannGT/lisa#3942).
    #
    # So the failure was never that the warning was ignored. It was delivered
    # to a session, once, and the thing it warns about happens to a COMMAND.
    # This block is keyed to the event instead: every refusal a
    # not-provably-current copy emits carries what the reader has to know to
    # avoid acting on it.
    #
    # The last line is the load-bearing one and is the reason this is not
    # advisory prose. A refusal from a stale copy is indistinguishable from a
    # refusal from current source, so an agent that re-runs it to check gets a
    # SECOND confirmation of the same wrong thing — the observation is fresh
    # and its subject is not. Two tickets were filed on 2026-09-04 against
    # behaviour fixed the previous day, one of them re-verified live
    # specifically to avoid citing a stale observation.
    if [ "$vintage_is_stale" -eq 1 ]; then
      {
        printf '\nTHIS VERDICT MAY NOT REFLECT CURRENT SOURCE — the copy that produced it\n'
        printf 'is not provably current (%s).\n' "$vintage_label"
        if [ "${guard_trees[$index]}" = "host" ]; then
          printf '  repair: '
          host_guard_repair "$index"
          printf '\n'
        else
          printf '  repair: %s\n' "$PLUGIN_REPAIR"
        fi
        printf 'Before filing a defect on this behaviour, read the guard on your\n'
        printf 'integration branch. Re-running the command confirms nothing: it asks\n'
        printf 'the same selected copy again.\n'
      } >&2
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

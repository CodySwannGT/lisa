#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

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
# the same three scripts written into its checkout by `lisa apply`, because a
# host project whose plugin install fails has exactly the same hole and no
# `plugins/` directory to fall back on.
status=0
resolved=0
missing=""
for guard in block-no-verify parity-safety-net block-shell-json-parsing \
  block-instruction-file-edits block-direct-issue-create \
  block-managed-file-edits; do
  script=""
  for candidate in \
    "$repo_root/scripts/lisa-hooks/$guard.sh" \
    "$repo_root/plugins/lisa/hooks/$guard.sh"; do
    if [ -f "$candidate" ]; then
      script="$candidate"
      break
    fi
  done
  if [ -z "$script" ]; then
    missing="${missing:+$missing, }$guard"
    continue
  fi
  resolved=$((resolved + 1))
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
done

# Zero guards resolved is a refusal, not a pass.
#
# Six `continue`s used to leave `status` at 0, so nothing distinguished "every
# guard ran and none objected" from "no guard was found". That is the same
# silent fail-open this file was written to close, reproduced one layer down: a
# host whose `scripts/lisa-hooks/` was never written by `lisa apply`, or was
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
# a noisy outage.
if [ "$resolved" -eq 0 ]; then
  cat >&2 <<EOF
Blocked: Lisa's enforcement guards are missing from this repository, so this
tool call was checked by nothing at all.

This hook is registered in .claude/settings.json but resolved none of the
guards it dispatches: $missing

Searched:
  $repo_root/scripts/lisa-hooks/<guard>.sh
  $repo_root/plugins/lisa/hooks/<guard>.sh

Refused rather than allowed on purpose. A dispatcher that resolves nothing is
indistinguishable from one that was never installed, and letting the call
through would be the silent fail-open this hook exists to close.

To repair, run this in a terminal outside the agent session:
  npx @codyswann/lisa apply
EOF
  exit 2
fi

exit "$status"

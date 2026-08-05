#!/usr/bin/env bash
#
# Run Lisa's Bash enforcement guards when the plugin that normally provides them
# is not installed.
#
# Every PreToolUse guard — block-no-verify, parity-safety-net,
# block-shell-json-parsing, block-instruction-file-edits — is declared in the
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

repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
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
for guard in block-no-verify parity-safety-net block-shell-json-parsing \
  block-instruction-file-edits; do
  script=""
  for candidate in \
    "$repo_root/scripts/lisa-hooks/$guard.sh" \
    "$repo_root/plugins/lisa/hooks/$guard.sh"; do
    if [ -f "$candidate" ]; then
      script="$candidate"
      break
    fi
  done
  [ -n "$script" ] || continue
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
  if [ "$guard_status" -gt "$status" ]; then
    status="$guard_status"
  fi
done

exit "$status"

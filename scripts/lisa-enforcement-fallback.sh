#!/usr/bin/env bash
#
# Run Lisa's Bash enforcement guards when the plugin that normally provides them
# is not installed.
#
# Every PreToolUse guard — block-no-verify, parity-safety-net,
# block-shell-json-parsing — is declared in the Lisa plugin. A cloud session
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

# Skip when the plugin is installed, so a developer machine does not run every
# guard twice and print every refusal twice. Absence is the interesting case and
# the only one this exists for.
#
# Read from the plugin registry rather than from CLAUDE_PLUGIN_ROOT: that
# variable is set for plugin hooks, and this hook is by definition not one.
installed="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
if [ -f "$installed" ] && grep -q '"lisa@lisa"' "$installed" 2>/dev/null; then
  exit 0
fi

status=0
for guard in block-no-verify parity-safety-net block-shell-json-parsing; do
  script="$repo_root/plugins/lisa/hooks/$guard.sh"
  [ -f "$script" ] || continue
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

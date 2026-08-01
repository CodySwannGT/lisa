#!/usr/bin/env bash
#
# Remote environment entrypoint. Installed by /lisa:setup:remote-env; the remote
# environment's setup AND maintenance fields both call this exact path.
#
# They are the same script on purpose. A container may be built fresh or resumed
# from cache, and everything below is idempotent and version-aware — so running
# it twice is correct, and running it on resume is what picks up a rotated
# value, an edited note, or a changed version pin.
#
# This file is deliberately thin. It resolves an interpreter and hands off; the
# reviewed, tested, versioned logic lives in the Lisa skill rather than here,
# and emphatically not in a vendor settings field.
set -euo pipefail

# Node is the one thing that cannot be installed by the installer, since the
# installer is written in it. Fail with an actionable message rather than a
# "command not found" forty lines deep.
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to prepare this environment but is not present." >&2
  echo "It cannot be installed by the toolchain step, because that step runs" >&2
  echo "on node. Pin a base image that provides it." >&2
  exit 1
fi

# The skill ships under whichever agent directory this project uses. Search
# rather than hardcode, so one entrypoint serves every supported harness.
runner=""
for candidate in \
  ".claude/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".agents/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".codex/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs"; do
  if [ -f "$candidate" ]; then
    runner="$candidate"
    break
  fi
done

if [ -z "$runner" ]; then
  echo "Cannot find the lisa-setup-remote-env skill in this checkout." >&2
  echo "Run 'lisa apply' so the skills are present, then re-run setup." >&2
  exit 1
fi

exec node "$runner" "$@"

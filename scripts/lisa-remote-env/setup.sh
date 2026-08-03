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

# Where the skill lives depends on how this project's harness receives it, and
# the two delivery models differ in a way that matters here.
#
# OpenCode and Antigravity get skills written INTO the checkout by `lisa apply`,
# so a clone already carries them. Claude and Codex receive them as an installed
# plugin, which lives in the user's home directory and is emphatically NOT part
# of a clone. A fresh remote container is the second case every time: it clones
# the repository and has never run a plugin install.
#
# So the agent directories are searched first — they are the cheapest hit and
# need nothing installed — and the npm package is the fallback that makes the
# plugin-delivered harnesses work at all. Lisa is a dependency of every project
# it is applied to, so `node_modules` carries the same skill at the version that
# project pins, which is the version its setup should run.
runner=""
for candidate in \
  ".claude/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".agents/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".codex/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs"; do
  if [ -f "$candidate" ]; then
    runner="$candidate"
    break
  fi
done

if [ -z "$runner" ]; then
  echo "Cannot find the lisa-setup-remote-env skill." >&2
  echo >&2
  echo "Searched the agent skill directories and node_modules. On a remote" >&2
  echo "container the usual cause is that dependencies have not been installed" >&2
  echo "yet: Claude and Codex receive Lisa skills as an installed plugin, which" >&2
  echo "is not part of a clone, so node_modules is the only copy present." >&2
  echo >&2
  echo "Install dependencies before this script runs. The environment's setup" >&2
  echo "command should be the install and this script together, for example:" >&2
  echo "  bun install && bash scripts/lisa-remote-env/setup.sh" >&2
  echo >&2
  echo "If dependencies are installed, run 'lisa apply' so the skills are" >&2
  echo "present, then re-run setup." >&2
  exit 1
fi

exec node "$runner" "$@"

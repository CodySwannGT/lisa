#!/usr/bin/env bash
#
# Session-start entrypoint for surfaces that materialize secrets per session
# rather than during environment setup.
#
# Wired into the repository's `.claude/settings.json` as a SessionStart hook,
# so it is part of the clone and runs on every session — including a session
# resumed onto a cached environment, which is the case that matters.
#
# Why this exists at all: a cloud environment's setup script is skipped whenever
# a filesystem cache exists. Materializing there would write the values once and
# never refresh them, so a rotated credential would stay stale until the cache
# expired days later. This hook runs every session, so the copy on disk is
# always the provider's current view.
#
# It is deliberately a guard and a delegation, not a second implementation. The
# skill-resolution ladder is subtle enough that two copies would drift, so the
# real work stays in setup.sh and this file only decides whether to call it.
set -euo pipefail

# Exit before doing anything on a machine that is not a remote session. The hook
# is committed to the repository, so it also fires on every local session; the
# materialize step would correctly refuse there, but failing on a developer's
# laptop every time they start a session is noise, not a signal.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

here="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
exec bash "${here}/setup.sh" --phase=secrets "$@"

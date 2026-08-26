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

# The toolchain first, for the same reason the secrets are here at all.
#
# It used to run only from the environment setup script, which a cached
# environment skips — so a tool added to remoteEnv.tools was invisible until the
# cache expired about a week later, or until someone edited the vendor's setup
# field to force a rebuild. Neither is a thing a project can rely on, and the
# symptom is a container missing a tool its own committed config pins.
#
# It is cheap to repeat: the plan probes each tool and installs only what is
# absent or below its pinned version, so on a warm container this is a handful
# of --version calls and nothing else.
#
# Before secrets, because materializing needs the provider CLI that this step
# installs. A failure here is fatal for the same reason: continuing would report
# a missing credential when the real fault was a missing binary.
bash "${here}/setup.sh" --phase=toolchain "$@"
bash "${here}/setup.sh" --phase=secrets "$@"

# A project hook is part of the remote toolchain contract too. It covers tools
# that cannot be expressed by the pinned manifest, so skipping it on a cached
# session can leave fresh credentials with no client capable of using them.
# Run it last, matching the full setup order, and exec so its failure is the
# SessionStart result rather than a warning a headless agent never sees.
exec bash "${here}/setup.sh" --phase=hook "$@"

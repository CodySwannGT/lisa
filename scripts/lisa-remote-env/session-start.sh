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
# installs. A failure here terminates this hook for the same reason: continuing
# would report a missing credential when the real fault was a missing binary.
# SessionStart hosts are fail-open, so they surface that result and still allow
# the agent session to continue.
bash "${here}/setup.sh" --phase=toolchain "$@"

# The toolchain child cannot export into this parent shell. Its durable output
# is linked into ~/.local/bin, so make that directory visible before the next
# child tries to execute the provider CLI it just installed.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$PATH"; export PATH ;;
esac

bash "${here}/setup.sh" --phase=secrets "$@"

# Validate the exact Lisa-owned secrets.env before sourcing any bytes. The
# profile is unrelated host startup code and may return before Lisa's managed
# block, mutate the environment, or run arbitrary user commands. The authority
# process resolves the same configured namespace as the materializer and emits
# only the fully validated absolute artifact path.
project_root="$(CDPATH='' cd -- "${here}/../.." && pwd)"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
values_file="$(
  node "${here}/materialized-env-authority.mjs" \
    --resolve "${project_root}/.lisa.config.json" "${config_root}"
)"

# Match the managed block's AWS poison removal, then export the artifact's
# values only for this session-start process and its project-hook child.
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
set -a
# The authority process proved this exact path and its complete writer format.
# shellcheck disable=SC1090
. "${values_file}"
set +a

# A project hook is part of the remote toolchain contract too. It covers tools
# that cannot be expressed by the pinned manifest, so skipping it on a cached
# session can leave fresh credentials with no client capable of using them.
# Run it last, matching the full setup order, and exec so its failure becomes
# the SessionStart result the host can surface. SessionStart remains fail-open;
# this reports an incomplete bootstrap but does not block the agent session.
exec /bin/bash "${here}/setup.sh" --phase=hook "$@"

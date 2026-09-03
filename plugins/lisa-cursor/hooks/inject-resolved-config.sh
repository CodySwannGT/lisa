#!/usr/bin/env bash
# SessionStart / SubagentStart: put the RESOLVED Lisa configuration in front of
# the agent, so reading it is not a decision anyone can decline to make.
#
# `inject-rules.sh` beside this file injects RULE TEXT. Nothing injected the
# resolved VALUES, so an agent received a paragraph saying that configuration
# lives in a file and then had to decide, unprompted, to go read it. That
# decision is the step that gets skipped, and it is why projects keep "missing"
# a `.lisa.config.json` that is present and correct. An agent cannot skip
# reading what is already in its context.
#
# All the work — resolving `.lisa.config.local.json` over `.lisa.config.json`,
# marking built-in defaults, redacting identity, bounding the output — lives in
# the sibling `.mjs`, which is unit-tested. This wrapper only resolves the
# project root and hands stdin through.
#
# FAIL SOFT, ALWAYS. Every exit is 0 and every failure is silent. The right
# response to "node is missing" or "the renderer crashed" is a session that
# starts without this block, never a session that does not start. The hard
# reading of the same config lives where it can afford to be hard: the gate
# runner refuses a config it cannot read, and `lisa doctor` exits non-zero.
#
# Note the ONE case that is emphatically not silent: a config that exists and
# is malformed emits a block saying so. Staying quiet there would report a
# broken project as an unconfigured one, which is the invisible-gap failure
# this hook exists to remove.
set -uo pipefail

INPUT=$(cat 2>/dev/null || true)

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RENDERER="$ROOT/hooks/inject-resolved-config.mjs"

[ -f "$RENDERER" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# CLAUDE_PROJECT_DIR is the harness's own declaration of the root and is the
# only source that stays correct when the session's cwd has moved. Falling back
# to the git toplevel before $PWD matters for the same reason: config lives at
# the repo root, and a hook that reads the cwd reports "unconfigured" from any
# subdirectory (the defect fixed for setup-jira-cli in CodySwannGT/lisa#2768).
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "${PROJECT_DIR}" ] || [ ! -d "${PROJECT_DIR}" ]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# ...but the harness sets CLAUDE_PROJECT_DIR to wherever the session STARTED,
# which in a monorepo is routinely a subdirectory. Validating only that the
# directory exists left the git fallback above unreachable in exactly that case,
# so a fully configured repository reported "No Lisa configuration found" — the
# loudest possible wrong answer, in the one state this hook exists to make loud.
#
# So walk up for the config instead of assuming the declared directory holds it.
# The repository root bounds the walk: a config file ABOVE it belongs to some
# other project, and adopting it would be the same wrong answer wearing a
# different hat.
#
# `git rev-parse --show-toplevel` — the same command the PROJECT_DIR fallback
# above already runs — is the authoritative answer to "where does this work tree
# end". `.git`-presence is only a proxy for it, and the two part company on any
# layout that relocates the git directory (GIT_DIR/GIT_WORK_TREE set
# explicitly): the proxy never fires, the walk leaves the repository, and the
# block renders a neighbouring project's config as though it were this one
# (CodySwannGT/lisa#3623). So bound on the toplevel, and keep the `.git`-presence
# proxy for the case the toplevel cannot answer — no repository, or no git.
# `.git` is a file in a worktree and a directory otherwise, hence `-e`.
#
# Both paths are compared in PHYSICAL form, because `--show-toplevel` resolves
# symlinks and the harness-declared directory does not. On any box whose
# temporary or home directory is a symlink (macOS `/var` -> `/private/var`) a
# textual comparison of the two never matches, and a bound that never matches is
# the unbounded walk again.
#
# There is no depth cap. The one that was here claimed to be a symlink-loop
# guard and could not be: `dirname` is string manipulation, resolves no symlinks,
# and strictly shortens. What it could do was stop a legitimate walk at 32 levels
# and report "No Lisa configuration found" for a repository that has one — the
# loudest possible wrong answer, in the one state this hook exists to make loud.
# Termination is guarded by the thing that actually threatens it: `dirname`
# reaching a fixed point (`/` -> `/`, and `.` -> `.` for a relative input).
config_root() {
  local dir parent repo_root
  # Physical form, so the comparison against the toplevel below is like-for-like.
  dir="$(cd "$1" 2>/dev/null && pwd -P)" || dir="$1"
  [ -n "${dir}" ] || dir="$1"
  repo_root="$(git -C "${dir}" rev-parse --show-toplevel 2>/dev/null || true)"
  while [ -n "${dir}" ] && [ "${dir}" != "/" ]; do
    if [ -f "${dir}/.lisa.config.json" ] || [ -f "${dir}/.lisa.config.local.json" ]; then
      printf '%s' "${dir}"
      return 0
    fi
    if [ -n "${repo_root}" ]; then
      [ "${dir}" = "${repo_root}" ] && return 1
    elif [ -e "${dir}/.git" ]; then
      return 1
    fi
    parent="$(dirname "${dir}")"
    [ "${parent}" = "${dir}" ] && return 1
    dir="${parent}"
  done
  return 1
}

CONFIG_DIR="$(config_root "${PROJECT_DIR}")" && PROJECT_DIR="${CONFIG_DIR}"

printf '%s' "$INPUT" | node "$RENDERER" --project-dir "$PROJECT_DIR" || true
exit 0

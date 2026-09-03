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
# different hat. `.git` is a file in a worktree and a directory otherwise, hence
# `-e`. The depth cap is a symlink-loop guard, not a policy.
config_root() {
  dir="$1"
  depth=0
  while [ -n "${dir}" ] && [ "${dir}" != "/" ] && [ "${depth}" -lt 32 ]; do
    if [ -f "${dir}/.lisa.config.json" ] || [ -f "${dir}/.lisa.config.local.json" ]; then
      printf '%s' "${dir}"
      return 0
    fi
    [ -e "${dir}/.git" ] && return 1
    dir="$(dirname "${dir}")"
    depth=$((depth + 1))
  done
  return 1
}

CONFIG_DIR="$(config_root "${PROJECT_DIR}")" && PROJECT_DIR="${CONFIG_DIR}"

printf '%s' "$INPUT" | node "$RENDERER" --project-dir "$PROJECT_DIR" || true
exit 0

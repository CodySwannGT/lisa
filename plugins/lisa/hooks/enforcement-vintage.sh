#!/usr/bin/env bash
# SessionStart / SubagentStart: put the VINTAGE of the executing Lisa copy in
# front of the agent (CodySwannGT/lisa#3714).
#
# A session resolves its Lisa copy once, at session start, and runs that copy
# until it ends. Nothing that happens afterwards — a merge to `main`, a publish,
# a marketplace update, a `lisa apply` — reaches it. So "the fix is on `main`"
# is a fact about the repository and never a fact about this session, and until
# now nothing in the session said which of the two it was looking at.
#
# All the work lives in the sibling `.mjs`, which is unit-tested. This wrapper
# only resolves the project root and hands stdin through — the same division
# `inject-resolved-config.sh` beside it makes.
#
# `--hooks-dir` is deliberately NOT passed. The renderer dates the copy from its
# own `import.meta.url`, which is where the file was actually loaded from; a
# path this wrapper computed from an environment variable would be a claim about
# which copy is running rather than an observation of it, and this whole file
# exists because such a claim was wrong for eleven hours without anyone noticing.
#
# FAIL SOFT, ALWAYS. Every exit is 0 and every failure is silent. The right
# response to "node is missing" is a session that starts without this block,
# never a session that does not start. The hard reading of the same question
# lives where it can afford to be hard: `lisa doctor` reports what a checkout
# resolves and exits non-zero on it.
set -uo pipefail

INPUT=$(cat 2>/dev/null || true)

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RENDERER="$ROOT/hooks/enforcement-vintage.mjs"

[ -f "$RENDERER" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# CLAUDE_PROJECT_DIR is the harness's own declaration of the root and is the
# only source that stays correct when the session's cwd has moved. Falling back
# to the git toplevel before $PWD matters for the same reason it does in
# `inject-resolved-config.sh`: the artifacts this dates live at the repository
# root, and a hook that reads the cwd reports the wrong tree from any
# subdirectory.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "${PROJECT_DIR}" ] || [ ! -d "${PROJECT_DIR}" ]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

printf '%s' "$INPUT" | node "$RENDERER" --project-dir "$PROJECT_DIR" || true
exit 0

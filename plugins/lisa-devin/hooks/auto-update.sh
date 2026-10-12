#!/usr/bin/env bash
# SessionStart: keep the project on the latest Lisa, locally
# (CodySwannGT/lisa#4337). `autoUpdate` in .lisa.config.json defaults to on;
# `false` opts out.
#
# All the work lives in the sibling `.mjs`, which is unit-tested. This wrapper
# only resolves the project root and hands off — the same division
# `enforcement-vintage.sh` beside it makes.
#
# FAIL SOFT, ALWAYS. Every exit is 0: a session must start even when the update
# cannot run, and the `.mjs` reports what it could not do in the context.
set -uo pipefail

cat >/dev/null 2>&1 || true

ROOT="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
RUNNER="$ROOT/hooks/auto-update.mjs"

[ -f "$RUNNER" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# CLAUDE_PROJECT_DIR is the harness's own declaration of the root; the git
# toplevel is the fallback, because the manifest and node_modules this updates
# live at the repository root, not at whatever directory the session opened in.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "${PROJECT_DIR}" ] || [ ! -d "${PROJECT_DIR}" ]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

node "$RUNNER" --project-dir "$PROJECT_DIR" || true
exit 0

#!/usr/bin/env bash
# PostToolUse hook for Edit|Write|NotebookEdit|Bash: the threshold ratchet.
# Quality thresholds (coverage minimums, complexity maximums, mutation break
# score, e2e route floors, k6 bounds, audit-ignore lists) may tighten but never
# weaken. The deterministic comparator lives in threshold-ratchet.mjs and is
# shared with the pre-commit (husky/lefthook --staged) and CI (--base) layers,
# so this hook is fast feedback — not the only line of defense.
#
# Exit 2 on weakening (soft block: the agent gets the report on stderr and can
# fix the code or escalate to a human). Every infrastructure gap — no node, no
# git repo, unreadable stdin — exits 0: the CI layer still guarantees the gate,
# and a broken hook must never wedge an agent session.
set -euo pipefail

input="$(cat)"

command -v node >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf '%s' "$input" | node "$script_dir/threshold-ratchet.mjs" --hook

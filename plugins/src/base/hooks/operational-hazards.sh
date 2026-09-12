#!/usr/bin/env bash
# Hook wrapper for the short-lived operational-hazard ledger
# (CodySwannGT/lisa#3681).
#
# Two events, one script:
#   --session-start   SessionStart / SubagentStart — deliver every hazard that
#                     applies right now, and stamp what this session was born
#                     knowing. This is the half a fan-out cannot reach: a
#                     session that starts after the warning still gets it.
#   --hook            PostToolUse — announce only what was declared or lifted
#                     since this session started, once each. This is the only
#                     thing that reaches a session already running.
#
# Advisory by construction — ALWAYS exit 0. A session that cannot read the
# ledger must keep working; a broken hook that wedges every tool call would be
# a far worse defect than the one this closes. Every infrastructure gap (no
# node, unreadable stdin) is also exit 0, and `bun run check:operational-hazards`
# is what guarantees the ledger itself still parses.
set -uo pipefail

input="$(cat 2>/dev/null || true)"

command -v node >/dev/null 2>&1 || exit 0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf '%s' "$input" | node "$script_dir/operational-hazards.mjs" "$@" || true
exit 0

#!/usr/bin/env bash
# Hook wrapper for the withdrawn-rulings ledger (CodySwannGT/lisa#3752).
#
# Two events, one script:
#   --session-start   SessionStart / SubagentStart — stamp what this session is
#                     born knowing, and replay the recent withdrawals.
#   --hook            PostToolUse — announce ONLY what was withdrawn since this
#                     session started, once each.
#
# Advisory by construction — ALWAYS exit 0. A session that cannot read the
# ledger must keep working; a broken hook that wedges every tool call would be a
# far worse defect than the one this closes. Every infrastructure gap (no node,
# unreadable stdin) is also exit 0, and `bun run check:withdrawn-rulings` is
# what guarantees the ledger itself still parses.
set -uo pipefail

input="$(cat 2>/dev/null || true)"

command -v node >/dev/null 2>&1 || exit 0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf '%s' "$input" | node "$script_dir/withdrawn-rulings.mjs" "$@" || true
exit 0

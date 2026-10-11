#!/usr/bin/env bash
# PostToolUse hook for Bash: the failure-signature index.
#
# A hazard recorded beside its cause is unreachable from its effect — the
# searcher does not yet know which concern owns the cause, so "search harder"
# is a retrieval strategy that requires already knowing the answer
# (CodySwannGT/lisa#3061). This hook closes that gap from the only direction
# that works: it reads the output of the command that just ran and, when that
# output matches a known hazard, names the record that already explains it.
#
# Advisory by construction — ALWAYS exit 0. The hazard has already happened;
# blocking an agent here would punish it for meeting a symptom. Every
# infrastructure gap (no node, no git repo, unreadable stdin, no index) is also
# exit 0: a broken hook must never wedge a session, and `check:failure-signatures`
# is what guarantees the index still routes.
set -uo pipefail

input="$(cat)"

command -v node >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf '%s' "$input" | node "$script_dir/failure-signature-index.mjs" --hook || true
exit 0

#!/usr/bin/env bash
# Antigravity (agy) PreToolUse hook: blocks shell commands that bypass Lisa's
# git quality gates (exact parity with the Claude block-no-verify.sh): the
# `--no-verify` long flag, `HUSKY=0`/`HUSKY_SKIP_HOOKS=` (disables husky hooks),
# and `core.hooksPath` pointed at /dev/null or set empty (disables all git
# hooks). The short `-n` form is intentionally NOT matched, to avoid false
# positives (see the matching block below).
#
# agy protocol (distinct from the Claude block-no-verify.sh exit-code protocol):
#   - stdin  = JSON: { "toolCall": { "name": "run_command",
#                      "args": { "CommandLine": "<shell command>" } }, ... }
#   - stdout = JSON decision: {"decision":"deny","reason":"..."} | {"decision":"allow"}
#
# Shipped as a GLOBAL agy plugin hook (hooks.json at the plugin root, installed
# to ~/.gemini/config/plugins/<variant>/). Matches agy's shell tool `run_command`
# on PreToolUse. jq parses the JSON envelope (per project rule: never grep/sed
# JSON); the command string itself is matched with grep (it is a plain string,
# not JSON). Malformed/empty stdin → allow (fail open, never crash the tool).
set -uo pipefail

allow() {
  printf '%s\n' '{"decision":"allow"}'
  exit 0
}

deny() {
  printf '%s\n' '{"decision":"deny","reason":"This command bypasses Lisa pre-commit/pre-push quality gates (--no-verify, HUSKY=0, or core.hooksPath disabling). Fix the underlying issue (lint, tests, formatting) or ask the user before bypassing."}'
  exit 0
}

input="$(cat 2>/dev/null || true)"
[ -z "$input" ] && allow

command_str="$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // empty' 2>/dev/null || true)"
[ -z "$command_str" ] && allow

# Each pattern is bounded so longer flags (--no-verify-ssl) and legit values
# (core.hooksPath=.husky, HUSKY=1) don't match, while every syntactic position
# is caught (incl. subshells). Exact parity with the Claude block-no-verify.sh.
# The short `-n` form is intentionally NOT matched — `-n` appears in commit
# message prose (`git commit -m "fix -n flag"`) and unrelated piped commands
# (`sort -n x; git commit`), so guarding it false-positives on valid work.
if printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])--no-verify($|[^[:alnum:]_-])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY=0($|[^[:alnum:]])' \
  || printf '%s' "$command_str" | grep -Eq '(^|[^[:alnum:]_-])HUSKY_SKIP_HOOKS=' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath([[:space:]]*=)?[[:space:]]*/dev/null' \
  || printf '%s' "$command_str" | grep -Eq 'core\.hooksPath[[:space:]]*=[[:space:]]*($|[[:space:];&|"'\''])'; then
  deny
fi

allow

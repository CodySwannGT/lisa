#!/usr/bin/env bash
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# PreToolUse guard for Bash/Write/Edit/MultiEdit, and PostToolUse recorder for
# EnterWorktree: refuse to act while the worktree the session was told it is in
# disagrees with the one it is measurably in (CodySwannGT/lisa#3864).
#
# The reconciliation lives in worktree-binding-guard.mjs beside this file. It
# needs per-session state, path resolution and git plumbing, and a bash
# reimplementation of any of that would be a second copy of the thing the guard
# exists to keep honest.
#
# This wrapper does three things and nothing else: probe its interpreter, pass
# the hook envelope through untouched, and return the classifier's exit code so
# a refusal is a refusal.
#
# FAILING OPEN, LOUDLY
#
# Claude Code treats exit 2 as a refusal and every OTHER non-zero exit as a
# non-blocking hook error, so a missing interpreter under `set -e` would exit
# 127 and permit exactly what this exists to stop. Degrading to "allow" is
# correct — a hook that cannot read its input cannot tell a displacement from a
# directory listing — but it must SAY so, because a guard that is silently
# absent reads exactly like a guard that is passing. Same reasoning as
# block-host-name-leak.sh.
#
# AGENT PARITY, AND WHY IT STOPS WHERE IT DOES
#
# `EnterWorktree` is a Claude Code tool, and the process-global session binding
# it rewrites is a Claude Code structure. Codex, Antigravity and OpenCode manage
# their own worktrees and have neither, so there is nothing on those harnesses
# for the reconciler to reconcile — no `.agy.sh` adapter is shipped for this
# guard, and its absence is a statement rather than an omission. The Codex
# variant carries the PreToolUse half because the displacement check is
# harness-agnostic: it only asks whether the directory a session is measurably
# in has changed since it last acted.
set -uo pipefail

input="$(cat)"

if ! command -v node >/dev/null 2>&1; then
  printf 'worktree-binding-guard: node not found; worktree-binding enforcement is NOT active\n' >&2
  exit 0
fi

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
classifier="$hook_dir/worktree-binding-guard.mjs"
if [ ! -r "$classifier" ]; then
  printf 'worktree-binding-guard: classifier missing at %s; worktree-binding enforcement is NOT active\n' \
    "$classifier" >&2
  exit 0
fi

status=0
printf '%s' "$input" | node "$classifier" || status=$?
exit "$status"

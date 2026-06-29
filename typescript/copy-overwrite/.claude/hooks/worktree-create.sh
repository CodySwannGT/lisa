#!/bin/sh
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
#
# WorktreeCreate hook — fast-path setup for `claude -w` / `isolation: worktree`.
#
# Claude Code REPLACES its default git worktree creation with this hook, so it
# MUST: create the worktree, print ONLY its absolute path on stdout, and exit 0.
# Any non-zero exit, or extra text on stdout, aborts/breaks worktree creation —
# so every git command redirects its output off stdout, and progress goes to
# stderr (NOT /dev/tty, which is "not configured" in headless `-p`/CI sessions).
#
# It mirrors Claude's default layout — <cwd>/.claude/worktrees/<name> on a fresh
# `worktree-<name>` branch — so behavior is unchanged; the value is clean,
# pre-TUI output and an explicit, durable creation path. The plugin bootstrap
# itself is done by the `post-checkout` hook that `git worktree add` fires, so
# `claude -w` and standalone `cd && claude` sessions converge on the same state.
#
# Payload (observed, Claude Code stdin):
#   { "name": "<worktree>", "cwd": "<project root>", "hook_event_name": ... }

_log() { echo "$*" >&2; }

_payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
  _name="$(printf '%s' "$_payload" | jq -r '.name // .worktree_name // empty' 2>/dev/null)"
  _cwd="$(printf '%s' "$_payload" | jq -r '.cwd // empty' 2>/dev/null)"
fi

# A new worktree needs a name; without one (or jq) we cannot honor the contract.
if [ -z "${_name:-}" ]; then
  _log "WorktreeCreate: no worktree name in payload; aborting."
  exit 1
fi

# Reject names containing path separators, traversal sequences, or characters
# that are invalid in git ref names.  These would silently escape the managed
# worktrees directory or produce an unusable branch name.
case "$_name" in
  */* | *..*) _log "WorktreeCreate: invalid worktree name (path traversal): $_name"; exit 1 ;;
  *[!A-Za-z0-9._-]*) _log "WorktreeCreate: invalid worktree name (unsafe characters): $_name"; exit 1 ;;
esac

_root="${_cwd:-$(pwd)}"
_base="$_root/.claude/worktrees"
_path="$_base/$_name"
_wt_branch="worktree-$_name"

# Idempotent: an existing worktree just gets its path returned.
if [ -d "$_path" ]; then
  _log "Worktree already exists: $_path"
  printf '%s\n' "$_path"
  exit 0
fi

mkdir -p "$_base" 2>/dev/null || true
_log "Creating worktree $_path (branch: $_wt_branch)…"

# Reuse the worktree branch if it already exists, else create it from HEAD.
# All git output is kept off stdout (its "Preparing worktree…" line would
# corrupt the path contract and hang Claude).
if git -C "$_root" show-ref --verify --quiet "refs/heads/$_wt_branch" 2>/dev/null; then
  git -C "$_root" worktree add "$_path" "$_wt_branch" >/dev/null 2>&1
else
  git -C "$_root" worktree add -b "$_wt_branch" "$_path" HEAD >/dev/null 2>&1
fi

if [ ! -d "$_path" ]; then
  _log "WorktreeCreate: git worktree add failed for $_path."
  exit 1
fi

# THE ONLY thing on stdout: the absolute worktree path.
printf '%s\n' "$_path"
exit 0

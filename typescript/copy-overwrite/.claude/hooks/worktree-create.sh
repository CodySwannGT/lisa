#!/bin/sh
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
#
# WorktreeCreate hook — fast-path setup for `claude -w` / `isolation: worktree`.
#
# Claude Code REPLACES its default git worktree creation with this hook, so it
# MUST: create the worktree, print ONLY its absolute path on stdout, and exit 0.
# Any non-zero exit, or extra text on stdout, aborts/breaks worktree creation —
# so every git command redirects its output off stdout, and progress goes to
# stderr (NOT /dev/tty, which is "not configured" in headless `-p`/CI sessions).
#
# It mirrors Claude's default layout — <cwd>/.claude/worktrees/<name> — but the
# new branch is cut from the repository's INTEGRATION branch, not from whatever
# the invoking checkout happened to be standing on. See "Choosing the base".
# The plugin bootstrap itself is done by the `post-checkout` hook that
# `git worktree add` fires, so `claude -w` and standalone `cd && claude`
# sessions converge on the same state.
#
# Payload (observed, Claude Code stdin):
#   { "name": "<worktree>", "cwd": "<project root>", "hook_event_name": ... }
#
# Agent parity: `WorktreeCreate` is a Claude Code hook event and has no
# counterpart on Codex, Cursor, OpenCode, Copilot or Antigravity — none of them
# delegate worktree creation to the host project. There is deliberately no
# projection of this file for those agents; on them, worktrees are created by
# whatever invokes git directly, and the base-selection rules below do not
# apply. This is a genuine surface gap, not a parity omission.

_log() { echo "$*" >&2; }

# The remote whose default branch defines "the integration branch" here.
_remote="origin"

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

# The name is interpolated into a filesystem path and a git ref, so reject path
# traversal/separators, a leading dash, and any character outside a safe slug.
case "$_name" in
  *..* | /* | -* | *[!A-Za-z0-9._-]*)
    _log "WorktreeCreate: unsafe worktree name '$_name'; aborting."
    exit 1
    ;;
esac

# Which REPOSITORY this hook operates on is decided entirely by the payload's
# `cwd`. This hook cannot validate that choice — it is handed `{ name, cwd }`
# and nothing that names the intended repository, so it has no way to tell a
# correct `cwd` from one that drifted. What it can do is refuse to be silent
# about falling back to ambient process state, which is the one part of the
# repository choice that happens HERE rather than upstream.
if [ -n "${_cwd:-}" ]; then
  _root="$_cwd"
else
  _root="$(pwd)"
  _log "WorktreeCreate: WARNING — payload carried no 'cwd'; falling back to the"
  _log "  process working directory: $_root"
  _log "  If that is not the repository you meant, this worktree is in the wrong one."
fi

_base="$_root/.claude/worktrees"
_path="$_base/$_name"
_wt_branch="worktree-$_name"

# Idempotent: an existing worktree just gets its path returned.
if [ -d "$_path" ]; then
  _log "Worktree already exists: $_path"
  printf '%s\n' "$_path"
  exit 0
fi

# ---------------------------------------------------------------------------
# Choosing the base
#
# This used to be a literal `HEAD`, which made the base of every new worktree a
# property of ambient session state rather than of the work being handed over: a
# checkout parked on an unmerged feature branch silently handed each new
# worktree that other work item's commits, and a PR opened from it presented
# them as its own. Nothing errored, and no identity check catches it — the
# directory, the branch name and the binding are all exactly what was asked for.
# Only the base was wrong, and nothing inspects a base.
#
# Resolution is OFFLINE ONLY. This hook runs before a session starts and must
# never stall on the network, so it reads the LOCAL ref store and nothing else.
# Precedence, most explicit first:
#
#   1. $LISA_WORKTREE_BASE       — operator override; wrong here is fatal
#   2. refs/remotes/<remote>/HEAD — the remote's own declared default branch
#   3. .lisa.config.json          — deploy.branches.production, as a hint
#   4. HEAD                       — fallback, and never a silent one
#
# origin/HEAD outranks the config hint deliberately. `deploy.branches.production`
# names a DEPLOY target, which in a dev/staging/prod repository is not the branch
# work integrates onto; origin/HEAD is that repository's own statement of its
# default branch, which is.

# Fully qualified remote default-branch ref, or nothing when it cannot be
# resolved offline. Mirrors `remoteDefaultRef` in lisa-work-item.mjs: the symref
# must point INSIDE refs/remotes/<remote>/ and the ref it names must exist, so a
# crafted symref cannot redirect the base somewhere arbitrary.
_resolve_remote_head() {
  _sym="$(git -C "$_root" symbolic-ref --quiet "refs/remotes/$_remote/HEAD" 2>/dev/null)" || return 1
  [ -n "$_sym" ] || return 1
  case "$_sym" in
    "refs/remotes/$_remote/"*) ;;
    *) return 1 ;;
  esac
  git -C "$_root" rev-parse -q --verify "$_sym" >/dev/null 2>&1 || return 1
  printf '%s' "$_sym"
}

# Lisa's configured production branch, resolved to a real ref — remote-tracking
# first, then local. A configured NAME that resolves to no ref is not usable.
_resolve_config_base() {
  _cfg="$_root/.lisa.config.json"
  [ -f "$_cfg" ] || return 1
  _cfg_branch="$(jq -r '.deploy.branches.production // empty' <"$_cfg" 2>/dev/null)" || return 1
  [ -n "$_cfg_branch" ] || return 1
  for _cand in "refs/remotes/$_remote/$_cfg_branch" "refs/heads/$_cfg_branch"; do
    if git -C "$_root" rev-parse -q --verify "$_cand" >/dev/null 2>&1; then
      printf '%s' "$_cand"
      return 0
    fi
  done
  return 1
}

_base_ref=""
_base_source=""

if [ -n "${LISA_WORKTREE_BASE:-}" ]; then
  # An explicit override that does not resolve is a configuration error the
  # operator can see and fix. Quietly ignoring it would reintroduce this very
  # bug — a base silently different from the one that was asked for.
  if git -C "$_root" rev-parse -q --verify "$LISA_WORKTREE_BASE" >/dev/null 2>&1; then
    _base_ref="$LISA_WORKTREE_BASE"
    _base_source="LISA_WORKTREE_BASE"
  else
    _log "WorktreeCreate: LISA_WORKTREE_BASE='$LISA_WORKTREE_BASE' does not resolve"
    _log "  to a ref in $_root; refusing rather than silently using a different base."
    exit 1
  fi
fi

if [ -z "$_base_ref" ]; then
  _base_ref="$(_resolve_remote_head)" && _base_source="$_remote/HEAD"
fi

if [ -z "$_base_ref" ] && command -v jq >/dev/null 2>&1; then
  _base_ref="$(_resolve_config_base)" && _base_source="deploy.branches.production"
fi

if [ -z "$_base_ref" ]; then
  _base_ref="HEAD"
  _base_source="fallback"
fi

mkdir -p "$_base" 2>/dev/null || true

# Announce what was resolved, so a wrong repository or a wrong base is visible
# AT CREATION instead of being reconstructed hours later from a confused agent.
# The origin URL can embed a credential (https://user:token@host/...), so strip
# any userinfo before it reaches a log.
_origin_url="$(git -C "$_root" remote get-url "$_remote" 2>/dev/null | sed -e 's#://[^/@]*@#://#')"
_base_sha="$(git -C "$_root" rev-parse --short "$_base_ref" 2>/dev/null)"

_log "Creating worktree $_path"
_log "  repository : $_root"
_log "  origin     : ${_origin_url:-<none>}"
_log "  branch     : $_wt_branch"
_log "  base       : $_base_ref @ ${_base_sha:-<unknown>} ($_base_source)"

if [ "$_base_source" = "fallback" ]; then
  _log "WorktreeCreate: WARNING — no integration branch could be resolved for this"
  _log "  repository, so this worktree is based on whatever branch that checkout was"
  _log "  standing on. It may carry another work item's unmerged commits. Check with:"
  _log "    git -C $_path log --oneline -5"
fi

# Reuse the worktree branch if it already exists, else create it from the
# resolved base. All git output is kept off stdout (its "Preparing worktree…"
# line would corrupt the path contract and hang Claude); stderr is captured so a
# failure can say WHY instead of just that it happened.
#
# --no-track matters: without it, branching from refs/remotes/<remote>/<default>
# sets the integration branch as this branch's upstream, and a later bare
# `git push` from the worktree would target it.
if git -C "$_root" show-ref --verify --quiet "refs/heads/$_wt_branch" 2>/dev/null; then
  _reused=1
  _add_err="$(git -C "$_root" worktree add "$_path" "$_wt_branch" 2>&1 >/dev/null)"
  _add_status=$?
else
  _reused=0
  _add_err="$(git -C "$_root" worktree add --no-track -b "$_wt_branch" "$_path" "$_base_ref" 2>&1 >/dev/null)"
  _add_status=$?
fi

if [ "$_add_status" -ne 0 ] || [ ! -d "$_path" ]; then
  _log "WorktreeCreate: git worktree add failed for $_path."
  [ -n "$_add_err" ] && _log "  git: $_add_err"
  exit 1
fi

if [ "$_reused" = "1" ]; then
  # A reused branch legitimately carries its own prior work, so its commits
  # ahead of the integration branch are expected. Report, do not refuse.
  _log "  reused existing branch $_wt_branch"
elif [ "$_base_source" != "fallback" ]; then
  # Post-condition. A freshly cut branch is AT its base, so this is 0 by
  # construction — which is exactly why it is worth asserting: if base selection
  # ever regresses, this is what catches it, loudly, instead of handing back a
  # plausible-looking tree with someone else's commits in it.
  _ahead="$(git -C "$_path" rev-list --left-right --count "$_base_ref...HEAD" 2>/dev/null | awk '{print $2}')"
  case "${_ahead:-0}" in
    "" | 0) ;;
    *[!0-9]*) ;;
    *)
      _log "WorktreeCreate: REFUSING — the new worktree carries $_ahead commit(s) that"
      _log "  are not on $_base_ref. That means it inherited another work item's"
      _log "  unmerged work. Removing it rather than handing back a wrong tree."
      git -C "$_root" worktree remove --force "$_path" >/dev/null 2>&1
      git -C "$_root" branch -D "$_wt_branch" >/dev/null 2>&1
      exit 1
      ;;
  esac
fi

# THE ONLY thing on stdout: the absolute worktree path.
printf '%s\n' "$_path"
exit 0

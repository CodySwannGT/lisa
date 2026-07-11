#!/bin/bash
#
# cleanup-worktrees.sh — safely remove merged/abandoned linked git worktrees
# for ONE repository (the repo-level counterpart of a workspace-wide
# agent-worktree sweep).
#
# SAFETY MODEL — a worktree is only removed when ALL of these hold:
#   1. It is a LINKED worktree (never the main checkout).
#   2. Its path matches a known agent-worktree location (.claude/worktrees,
#      ~/.codex/worktrees, .lisa-worktrees, /tmp) OR its branch matches an
#      agent naming pattern (claude/*, worktree-*, codex/*) OR its branch is
#      fully merged into an environment branch (main/dev/staging).
#   3. No modified/staged TRACKED files ("real work" is never deleted).
#   4. Its HEAD commit is reachable from some remote ref (nothing unpushed).
#   5. It is older than --min-age-days (default 7) by directory mtime.
#   Untracked-only dirt (node_modules, .env.local, build output) blocks
#   removal by default; pass --force-untracked to treat it as junk.
#
# DRY-RUN BY DEFAULT. Nothing is deleted until you pass --apply.
#
# Usage:
#   cleanup-worktrees.sh [options] [repo-path]
#     --apply              actually remove (default: dry-run report)
#     --force-untracked    also remove worktrees whose only dirt is untracked files
#     --min-age-days N     minimum age (dir mtime) to touch anything (default 7)
#     --delete-branches    after removing a worktree, delete its branch when
#                          its commits are on a remote
#
set -uo pipefail

APPLY=0
FORCE_UNTRACKED=0
MIN_AGE_DAYS=7
DELETE_BRANCHES=0
REPO="."

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --force-untracked) FORCE_UNTRACKED=1 ;;
    --min-age-days) shift; MIN_AGE_DAYS="$1" ;;
    --delete-branches) DELETE_BRANCHES=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) REPO="$1" ;;
  esac
  shift
done

REPO="$(cd "$REPO" && pwd)"
if ! git -C "$REPO" rev-parse --git-dir > /dev/null 2>&1; then
  echo "ERROR: not a git repository: $REPO" >&2
  exit 1
fi

NOW=$(date +%s)
MIN_AGE_SECS=$((MIN_AGE_DAYS * 86400))
REMOVED=0 KEPT_DIRTY=0 KEPT_UNPUSHED=0 KEPT_YOUNG=0 KEPT_UNTRACKED=0 ORPHANS=0 ERRORS=0

log() { printf '%s\n' "$*"; }
act() { if [ "$APPLY" = 1 ]; then log "REMOVE  $*"; else log "WOULD-REMOVE  $*"; fi; }

is_agent_path() {
  case "$1" in
    */.claude/worktrees/*|"$HOME"/.codex/worktrees/*|*/.lisa-worktrees/*|*/.lisa-update-*/*|/tmp/*|/private/tmp/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_agent_branch() {
  case "$1" in
    claude/*|worktree-*|codex/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_env_branch() {
  case "$1" in
    main|dev|staging) return 0 ;;
    *) return 1 ;;
  esac
}

# Branch is fully merged into an environment branch on the remote.
branch_is_merged() {
  local branch="$1" env_branch
  [ -z "$branch" ] && return 1
  for env_branch in main dev staging; do
    if git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$env_branch"; then
      if git -C "$REPO" merge-base --is-ancestor "refs/heads/$branch" "refs/remotes/origin/$env_branch" 2>/dev/null; then
        return 0
      fi
    fi
  done
  return 1
}

head_is_pushed() {
  local wt="$1" sha
  sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null) || return 1
  [ -n "$(git -C "$wt" branch -r --contains "$sha" 2>/dev/null | head -1)" ]
}

dir_age_ok() {
  local mtime
  mtime=$(stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null) || return 1
  [ $((NOW - mtime)) -ge "$MIN_AGE_SECS" ]
}

process_worktree() {
  local wt="$1" branch="$2"

  # Never remove a worktree sitting on an environment branch.
  if [ -n "$branch" ] && is_env_branch "$branch"; then
    return
  fi

  # Eligibility gate: agent location, agent branch, or a merged branch.
  if ! is_agent_path "$wt" && ! is_agent_branch "$branch" && ! branch_is_merged "$branch"; then
    return
  fi

  if ! dir_age_ok "$wt"; then
    KEPT_YOUNG=$((KEPT_YOUNG + 1))
    log "KEEP (younger than ${MIN_AGE_DAYS}d)  $wt"
    return
  fi

  if [ -n "$(git -C "$wt" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    KEPT_DIRTY=$((KEPT_DIRTY + 1))
    log "KEEP (modified tracked files)  $wt"
    return
  fi

  if ! head_is_pushed "$wt"; then
    KEPT_UNPUSHED=$((KEPT_UNPUSHED + 1))
    log "KEEP (HEAD not on any remote — possible unpushed work)  $wt"
    return
  fi

  local force_flag=()
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    if [ "$FORCE_UNTRACKED" = 1 ]; then
      force_flag=(--force)
    else
      KEPT_UNTRACKED=$((KEPT_UNTRACKED + 1))
      log "KEEP (untracked files only — rerun with --force-untracked)  $wt"
      return
    fi
  fi

  act "$wt  [branch: ${branch:-detached}]"
  if [ "$APPLY" = 1 ]; then
    if git -C "$REPO" worktree remove "${force_flag[@]}" "$wt" 2>/dev/null; then
      REMOVED=$((REMOVED + 1))
      if [ "$DELETE_BRANCHES" = 1 ] && [ -n "$branch" ] && ! is_env_branch "$branch"; then
        git -C "$REPO" branch -D "$branch" >/dev/null 2>&1 || true
      fi
    else
      ERRORS=$((ERRORS + 1))
      log "ERROR removing  $wt"
    fi
  else
    REMOVED=$((REMOVED + 1))
  fi
}

log "=== cleanup-worktrees: $([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN) (repo: $REPO, min age ${MIN_AGE_DAYS}d) ==="

git -C "$REPO" fetch --prune --quiet 2>/dev/null || true
git -C "$REPO" worktree prune 2>/dev/null

MAIN_WT=$(git -C "$REPO" worktree list --porcelain | head -1 | sed 's/^worktree //')

wt="" branch="" first=1
while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      wt="${line#worktree }" branch="" ;;
    branch\ *)
      branch="${line#branch refs/heads/}" ;;
    "")
      if [ "$first" = 1 ]; then first=0; else
        [ -d "$wt" ] && [ "$wt" != "$MAIN_WT" ] && process_worktree "$wt" "$branch"
      fi
      wt="" ;;
  esac
done < <(git -C "$REPO" worktree list --porcelain; echo)

# Orphan directories under .claude/worktrees that git no longer tracks.
wtroot="$REPO/.claude/worktrees"
if [ -d "$wtroot" ]; then
  for d in "$wtroot"/*/; do
    d=${d%/}
    [ -d "$d" ] || continue
    if ! git -C "$REPO" worktree list --porcelain | grep -qF "worktree $d"; then
      if dir_age_ok "$d"; then
        ORPHANS=$((ORPHANS + 1))
        act "(orphan dir, not a registered worktree)  $d"
        [ "$APPLY" = 1 ] && rm -rf "$d"
      fi
    fi
  done
fi

log ""
log "=== summary ==="
log "removed (or would remove): $REMOVED   orphan dirs: $ORPHANS"
log "kept: $KEPT_DIRTY modified-tracked, $KEPT_UNPUSHED unpushed, $KEPT_UNTRACKED untracked-only, $KEPT_YOUNG too-young   errors: $ERRORS"
[ "$APPLY" = 0 ] && log "(dry run — rerun with --apply to delete)"
exit 0

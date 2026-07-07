#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
#
# SessionEnd sweep of abandoned agent worktrees under <repo>/.claude/worktrees.
#
# Why: Claude Code's built-in cleanup (cleanupPeriodDays) only removes
# PRISTINE subagent worktrees — no changes, no untracked files, no unpushed
# commits. Real agent worktrees almost always carry untracked junk
# (node_modules, build output), so they survive forever and accumulate;
# one long-lived repo reached 415 worktrees / 823GB, which also crashes
# jest-haste-map's find-buffer crawl.
#
# Safety model — a worktree is removed only when ALL hold:
#   * it lives under .claude/worktrees/ (never the primary checkout)
#   * no modified or staged TRACKED files (real work is never deleted)
#   * its HEAD commit is reachable from some remote ref (nothing unpushed)
#   * its directory mtime is older than LISA_WORKTREE_MAX_AGE_DAYS (default 7)
# Untracked-only dirt does NOT block removal — that junk is exactly what
# defeats the built-in sweep. Set LISA_WORKTREE_CLEANUP=off to disable.

set -u

[ "${LISA_WORKTREE_CLEANUP:-on}" = "off" ] && exit 0

MAX_AGE_DAYS="${LISA_WORKTREE_MAX_AGE_DAYS:-7}"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# Never run the sweep from INSIDE an agent worktree — only the primary
# checkout owns cleanup (a worktree deleting its siblings mid-session
# would race other live sessions in the same repo).
case "$repo_root" in
  */.claude/worktrees/*) exit 0 ;;
esac

wt_root="$repo_root/.claude/worktrees"
[ -d "$wt_root" ] || exit 0

now=$(date +%s)
max_age_secs=$((MAX_AGE_DAYS * 86400))
removed=0

git -C "$repo_root" worktree prune 2>/dev/null

for wt in "$wt_root"/*/; do
  wt="${wt%/}"
  [ -d "$wt" ] || continue

  # Age gate: skip anything recently touched (possibly a live session).
  mtime=$(stat -f %m "$wt" 2>/dev/null || stat -c %Y "$wt" 2>/dev/null) || continue
  [ $((now - mtime)) -ge "$max_age_secs" ] || continue

  if [ -e "$wt/.git" ]; then
    # Real work gate: modified/staged tracked files survive.
    [ -z "$(git -C "$wt" status --porcelain --untracked-files=no 2>/dev/null)" ] || continue

    # Unpushed gate: HEAD must be reachable from a remote ref.
    sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null) || continue
    [ -n "$(git -C "$wt" branch -r --contains "$sha" 2>/dev/null | head -1)" ] || continue

    # git worktree lock (held during live agent execution) blocks removal;
    # --force only clears untracked junk, never the gates above.
    git -C "$repo_root" worktree remove --force "$wt" 2>/dev/null && removed=$((removed + 1))
  else
    # Orphan directory git no longer tracks (post-prune leftover).
    rm -rf "$wt" && removed=$((removed + 1))
  fi
done

git -C "$repo_root" worktree prune 2>/dev/null

[ "$removed" -gt 0 ] && echo "Removed $removed stale agent worktree(s) from .claude/worktrees" >&2
exit 0

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
#   * lisa-worktree-guard reports no uncommitted bytes that exist in no commit
# Untracked-only dirt does NOT block removal — that junk is exactly what
# defeats the built-in sweep. But "untracked" and "junk" are not the same word:
# a brand-new source file an agent has written and not yet committed is
# untracked too, and this sweep would delete it (CodySwannGT/lisa#3863). The
# guard draws the line by CONTENT rather than by tracking state — a file whose
# exact bytes are already in some commit is free to delete, one whose bytes
# exist nowhere else is not, and ignored paths (node_modules, build output)
# never reach the question. Set LISA_WORKTREE_CLEANUP=off to disable.

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

# Resolve the content-reachability guard once. Three homes, in the order a host
# project actually has them: the applied copy, the installed package, and Lisa's
# own delivery tree (Lisa does not apply this script to itself).
guard=""
for candidate in \
  "$repo_root/scripts/lisa-worktree-guard.mjs" \
  "$repo_root/node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-worktree-guard.mjs" \
  "$repo_root/all/copy-overwrite/scripts/lisa-worktree-guard.mjs"; do
  if [ -f "$candidate" ]; then
    guard="$candidate"
    break
  fi
done
command -v node > /dev/null 2>&1 || guard=""

# Whether a worktree's uncommitted content is safe to destroy. With the guard
# present the question is answered by content; without it (no node, no delivered
# script) the sweep falls back to the conservative shape — ANY non-ignored
# untracked file keeps the tree. A missing guard must not read as consent.
removal_allowed() {
  if [ -n "$guard" ]; then
    node "$guard" check "$1" > /dev/null 2>&1
    return $?
  fi
  [ -z "$(git -C "$1" ls-files --others --exclude-standard 2> /dev/null | head -1)" ]
}

now=$(date +%s)
max_age_secs=$((MAX_AGE_DAYS * 86400))
removed=0

git -C "$repo_root" worktree prune 2>/dev/null

for wt in "$wt_root"/*/; do
  wt="${wt%/}"
  [ -d "$wt" ] || continue

  # Age gate: skip anything recently touched (possibly a live session).
  # GNU `stat -c` is tried first: GNU's `-f` means "filesystem status" (not
  # BSD's "format"), so `stat -f %m` on Linux silently misparses instead of
  # failing cleanly, defeating the fallback. Try the GNU form first — it
  # fails cleanly with no stdout on BSD/macOS, letting `-f %m` take over.
  mtime=$(stat -c %Y "$wt" 2>/dev/null || stat -f %m "$wt" 2>/dev/null) || continue
  [ $((now - mtime)) -ge "$max_age_secs" ] || continue

  if [ -e "$wt/.git" ]; then
    # Real work gate: modified/staged tracked files survive. A failed
    # `git status` (corrupted index, permission issue, etc.) must NOT be
    # treated as clean — capture its exit status too and skip on failure.
    status_output=$(git -C "$wt" status --porcelain --untracked-files=no 2>/dev/null) || continue
    [ -z "$status_output" ] || continue

    # Unpushed gate: HEAD must be reachable from a remote ref.
    sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null) || continue
    [ -n "$(git -C "$wt" branch -r --contains "$sha" 2>/dev/null | head -1)" ] || continue

    # Content gate: refuse to destroy bytes that live in no commit. The
    # tracked-file check above answers a different question — a file an agent
    # has written but never `git add`ed is untracked, so that check reports the
    # tree clean while the whole deliverable sits in it. Only commits are shared
    # between worktrees; this directory's working files and index are not.
    removal_allowed "$wt" || continue

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

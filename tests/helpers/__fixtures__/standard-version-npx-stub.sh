#!/bin/bash
# A deterministic `npx standard-version@9` for tests/helpers/release-rails-job.ts.
#
# Bumps the patch in VERSION (or writes `--release-as X.Y.Z`), commits
# `chore(release): X.Y.Z`, and — like the real tool — tags only when
# `--skip.tag` is absent. Every command line it receives is appended to
# $NPX_LOG so a case can assert the workflow's own invocation is what ran.
#
# While RACE_CLONE is set, each of the first RACE_LANDINGS invocations first
# lands a concurrent merge on the remote branch RACE_BRANCH from that clone:
# the window in which a real run has fetched but not yet pushed.
set -e
printf '%s\n' "$*" >> "$NPX_LOG"
if [ "$1" != "standard-version@9" ]; then
  echo "npx stub: unexpected command: $*" >&2
  exit 97
fi
shift
release_as=""
skip_tag=false
while [ $# -gt 0 ]; do
  case "$1" in
    --release-as) release_as="$2"; shift 2 ;;
    --release-as=*) release_as="${1#*=}"; shift ;;
    --skip.tag) skip_tag=true; shift ;;
    *) shift ;;
  esac
done

calls=$(wc -l < "$NPX_LOG" | tr -d ' ')
if [ -n "${RACE_CLONE:-}" ] && [ "$calls" -le "${RACE_LANDINGS:-0}" ]; then
  (
    cd "$RACE_CLONE"
    # RACE_REWIND_TO: instead of landing a merge, force the branch back to
    # that commit, as someone with protection bypass rewinding it would.
    if [ -n "${RACE_REWIND_TO:-}" ]; then
      git push --quiet --force origin "$RACE_REWIND_TO:refs/heads/$RACE_BRANCH"
      exit 0
    fi
    git fetch --quiet origin "$RACE_BRANCH"
    git reset --quiet --hard "origin/$RACE_BRANCH"
    echo "$calls" >> concurrent.txt
    git add concurrent.txt
    git commit --quiet -m "feat: concurrent merge $calls"
    git push --quiet origin "HEAD:refs/heads/$RACE_BRANCH"
  )
fi

if [ -n "$release_as" ]; then
  next="$release_as"
else
  IFS=. read -r major minor patch < VERSION
  next="$major.$minor.$((patch + 1))"
fi
echo "$next" > VERSION
git add VERSION
git commit --quiet -m "chore(release): $next"
if [ "$skip_tag" = false ]; then
  git tag -a "v$next" -m "chore(release): $next"
fi

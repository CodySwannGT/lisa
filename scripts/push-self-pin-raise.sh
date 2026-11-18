#!/usr/bin/env bash
#
# Push the proved self-pin raise to main (CodySwannGT/lisa#4951).
#
# The deploy workflow's `push_self_pin_raise` job runs this in its final step,
# the only step that holds the deploy key. The raise commit is already made on
# top of the commit the raise was proved against (BASE_SHA).
#
# It pushes ONLY onto that exact commit. A push is never forced, so if main has
# moved the remote rejects it; this script then fetches main and, when the tip
# is no longer BASE_SHA, refuses. It never rebases: a rebased raise would
# combine the raised dependency graph with source nobody tested it against.
#
# The refusal needs no one to act on it. Deploy runs on main are serialized by
# the workflow's concurrency group, and the only commits that skip a deploy run
# are the release's own `[skip ci]` commits, which land before the raise is
# computed. So the commit that moved main starts its own deploy run; that run
# cuts a release, and its `prepare_self_pin_raise` recomputes and re-proves the
# raise against the new main.
#
# A push or fetch that fails while main is still BASE_SHA is transient (network,
# GitHub outage) and is retried a bounded number of times with a growing delay.
# When every attempt fails the step fails: nothing unproved is ever pushed.
#
# Usage:
#   scripts/push-self-pin-raise.sh <remote> <base-sha> <version>
#
# Environment:
#   SELF_PIN_PUSH_RETRY_DELAY  seconds per attempt of back-off (default 5)
#

set -euo pipefail

if [ "$#" -ne 3 ] || [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo "usage: push-self-pin-raise.sh <remote> <base-sha> <version>" >&2
  exit 2
fi

remote="$1"
base_sha="$2"
version="$3"
attempts=3
delay="${SELF_PIN_PUSH_RETRY_DELAY:-5}"

for attempt in $(seq 1 "$attempts"); do
  if git -c core.hooksPath=/dev/null push "$remote" HEAD:main; then
    echo "✅ Raised the self-pin to ^${version} on main."
    exit 0
  fi
  echo "::warning::Push attempt $attempt of $attempts failed; checking whether main moved."
  if git fetch "$remote" main; then
    fetched="$(git rev-parse FETCH_HEAD)"
    if [ "$fetched" != "$base_sha" ]; then
      echo "::error::main moved from $base_sha to $fetched after the raise was proved, so this raise is untested against it and nothing was pushed. The commit that moved main starts its own deploy run, whose prepare_self_pin_raise recomputes and re-proves the raise against the new main."
      exit 1
    fi
  else
    echo "::warning::Fetching main failed on attempt $attempt of $attempts; it is retried before anything is decided."
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep $((attempt * delay))
  fi
done

echo "::error::Could not push the self-pin raise to main after $attempts attempts; nothing was pushed."
exit 1

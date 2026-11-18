#!/usr/bin/env bash
#
# Push the proved self-pin raise to main (CodySwannGT/lisa#4951).
#
# The deploy workflow's `push_self_pin_raise` job runs this in its final step,
# the only step that holds the deploy key. The raise commit is already made on
# top of the commit the raise was proved against (BASE_SHA).
#
# It pushes ONLY onto that exact commit: the push carries an explicit lease on
# refs/heads/main at BASE_SHA, so any other tip — a newer main, or one rolled
# back to an ancestor — is rejected; this script then fetches main and, when the tip
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

# The raise must be exactly one commit on top of the proved base, or the lease
# below would vouch for a commit it never inspected.
if [ "$(git rev-parse HEAD^ 2>/dev/null || true)" != "$base_sha" ] || [ "$(git rev-list --parents -n 1 HEAD | wc -w | tr -d ' ')" != "2" ]; then
  echo "::error::HEAD is not a single raise commit on top of $base_sha; refusing to push." >&2
  exit 2
fi

for attempt in $(seq 1 "$attempts"); do
  # A plain push accepts any fast-forward, including one from an ANCESTOR of
  # BASE_SHA — so a main rolled back to an older commit would be quietly
  # restored. The explicit lease accepts only a main that is still BASE_SHA.
  if git -c core.hooksPath=/dev/null push --force-with-lease="refs/heads/main:$base_sha" "$remote" HEAD:main; then
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

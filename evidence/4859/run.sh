#!/bin/bash
# Evidence for CodySwannGT/lisa#4859 (Validation Journey steps 2, 3 and 6).
# Usage: evidence/4859/run.sh   (from the repository root)
#   linear-allocation-idempotent.txt   allocate twice against the mocked Linear GraphQL endpoint
#   jira-allocation-idempotent.txt     allocate twice against the mocked Jira REST endpoint
#   missing-credential-fails-closed.txt  the real CLI `allocate` with LINEAR_API_KEY unset
set -u
OUT="evidence/4859"
DRIVER="$OUT/allocate-evidence.ts"

{
  echo "\$ bun $DRIVER linear"
  bun "$DRIVER" linear
  echo "exit=$?"
} > "$OUT/linear-allocation-idempotent.txt" 2>&1

{
  echo "\$ bun $DRIVER jira"
  bun "$DRIVER" jira
  echo "exit=$?"
} > "$OUT/jira-allocation-idempotent.txt" 2>&1

WORK="$(mktemp -d "${TMPDIR:-/tmp}/lisa-npm-4859-XXXXXX")"
read -r HOST PHASE < <(bun "$DRIVER" prepare-missing "$WORK")
{
  echo "\$ env -u LINEAR_API_KEY -u LINEAR_API_KEY_acme GH_TOKEN=job-token node all/copy-overwrite/scripts/lisa-npm-updater.mjs allocate <linear-host> <phase>"
  env -u LINEAR_API_KEY -u LINEAR_API_KEY_acme GH_TOKEN=job-token \
    node all/copy-overwrite/scripts/lisa-npm-updater.mjs allocate "$HOST" "$PHASE"
  echo "exit=$?"
  echo "phase directory after the run (only the input proposal; nothing was written):"
  ls "$PHASE"
} > "$OUT/missing-credential-fails-closed.txt" 2>&1
rm -rf "$WORK"

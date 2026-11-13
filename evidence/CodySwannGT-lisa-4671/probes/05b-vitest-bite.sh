#!/usr/bin/env bash
# Falsifies the codified regression test (CodySwannGT/lisa#4671): swaps each bite
# control in for the workflow, runs the database_image test (it MUST fail), and
# always restores the original workflow. Run from the worktree root.
set -u
E=evidence/CodySwannGT-lisa-4671
WF=.github/workflows/quality-rails.yml
BACKUP="$E/controls/.head-backup.yml"
cp "$WF" "$BACKUP"
trap 'cp "$BACKUP" "$WF"; rm -f "$BACKUP"' EXIT
for c in mutation-reverted mysql-leak default-nonempty base-24d0d26b34; do
  echo "=== bite control: $c"
  cp "$E/controls/quality-rails.$c.yml" "$WF"
  bunx vitest run tests/integration/quality-rails-database-image.test.ts 2>&1 \
    | grep -E "✓|×|FAIL|Tests |AssertionError|Expected|Received" | head -30
  echo "exit=${PIPESTATUS[0]}"
  echo
done
cp "$BACKUP" "$WF"
echo "restored; sha256 of restored workflow:"
shasum -a 256 "$WF"

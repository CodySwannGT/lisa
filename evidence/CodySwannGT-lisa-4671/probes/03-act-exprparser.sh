#!/usr/bin/env bash
# Runs the nektos/act exprparser probe on the head workflow, then on bite controls
# that MUST fail (CodySwannGT/lisa#4671). Run from the worktree root.
set -u
ROOT="$PWD"
E="$ROOT/evidence/CodySwannGT-lisa-4671"
cd "$E/probes/actexpr" || exit 1
for f in "$ROOT/.github/workflows/quality-rails.yml" \
         "$E/controls/quality-rails.base-24d0d26b34.yml" \
         "$E/controls/quality-rails.mutation-reverted.yml" \
         "$E/controls/quality-rails.mysql-leak.yml"; do
  echo "=== \$ go run . ${f#"$ROOT/"}   (nektos/act v0.2.97 pkg/exprparser)"
  go run . "$f"
  echo "exit=$?"
  echo
done

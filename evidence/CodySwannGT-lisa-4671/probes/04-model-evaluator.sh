#!/usr/bin/env bash
# Hand-written model evaluator on head + bite controls (CodySwannGT/lisa#4671).
set -u
E=evidence/CodySwannGT-lisa-4671
for f in .github/workflows/quality-rails.yml \
         "$E/controls/quality-rails.base-24d0d26b34.yml" \
         "$E/controls/quality-rails.mutation-reverted.yml" \
         "$E/controls/quality-rails.mysql-leak.yml"; do
  echo "=== \$ node $E/probes/04-model-evaluator.cjs $f"
  node "$E/probes/04-model-evaluator.cjs" "$f"
  echo "exit=$?"
  echo
done

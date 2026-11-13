#!/usr/bin/env bash
# actionlint (rhysd/actionlint:1.7.7 via docker) over the head workflow, the base
# workflow, and a type-error bite control (CodySwannGT/lisa#4671).
# Run from the worktree root. shellcheck/pyflakes disabled: this checks workflow
# structure and expression typing only, not embedded run: scripts.
set -u
E=evidence/CodySwannGT-lisa-4671
run() {
  echo "\$ actionlint -shellcheck= -pyflakes= $1"
  docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -shellcheck= -pyflakes= "$1"
  echo "exit=$?"
  echo
}
run .github/workflows/quality-rails.yml
run "$E/controls/quality-rails.base-24d0d26b34.yml"
# Bite control: reference an undeclared input in the image expression; actionlint must flag it.
sed "s/inputs.database_image ||/inputs.database_imag ||/" .github/workflows/quality-rails.yml > "$E/controls/quality-rails.typo-input.yml"
run "$E/controls/quality-rails.typo-input.yml"

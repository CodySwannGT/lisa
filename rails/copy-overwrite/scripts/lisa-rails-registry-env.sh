#!/bin/sh
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

# Lefthook sources this file before it starts any jobs in an installed hook.
case "${0##*/}" in
  pre-commit | pre-push) ;;
  *) return 0 ;;
esac

unset LISA_RAILS_GATE_COVERAGE LISA_RAILS_GATE_PUSH_REFS
lisa_rails_gate_dir=$(mktemp -d "${TMPDIR:-/tmp}/lisa-rails-gates.XXXXXXXX") || exit 1
trap 'rm -f "$lisa_rails_gate_dir/covered" "$lisa_rails_gate_dir/push-refs"; rmdir "$lisa_rails_gate_dir" 2>/dev/null || :' 0

LISA_RAILS_GATE_COVERAGE="$lisa_rails_gate_dir/covered"
export LISA_RAILS_GATE_COVERAGE

if [ "${0##*/}" = pre-push ]; then
  LISA_RAILS_GATE_PUSH_REFS="$lisa_rails_gate_dir/push-refs"
  cat >"$LISA_RAILS_GATE_PUSH_REFS" || exit 1
  export LISA_RAILS_GATE_PUSH_REFS
  # Keep the same input available to the existing Rails push guard.
  exec <"$LISA_RAILS_GATE_PUSH_REFS"
fi

#!/bin/sh
# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.

case "${1:-}" in
  --coverage=*) coverage=${1#--coverage=} ;;
  *) printf '%s\n' 'Expected --coverage=<path> -- <gate runner>.' >&2; exit 1 ;;
esac
[ "${2:-}" = -- ] || exit 1
shift 2

if [ -z "$coverage" ]; then
  # Direct `lefthook run` has no generated wrapper to share the coverage file.
  coverage=$(mktemp "${TMPDIR:-/tmp}/lisa-rails-coverage.XXXXXXXX") || exit 1
  trap 'rm -f "$coverage"' 0
fi
: >"$coverage" || exit 1

if ! command -v "${1:-node}" >/dev/null 2>&1 || [ ! -f "${2:-scripts/lisa-run-gates.mjs}" ]; then
  printf '%s\n' 'Lisa gate runner unavailable. The existing Rails hook checks still run.' >&2
  exit 0
fi

if [ -n "${LISA_RAILS_GATE_PUSH_REFS:-}" ]; then
  set -- "$@" "--push-refs=$LISA_RAILS_GATE_PUSH_REFS"
fi
"$@" "--coverage=$coverage"
status=$?
case "$status" in
  78) exit 0 ;;
  *) exit "$status" ;;
esac

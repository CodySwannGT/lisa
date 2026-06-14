#!/usr/bin/env bash
# This file is managed by Lisa.
# -----------------------------------------------------------------------------
# Mutation-testing gate (mutant) for Rails
# -----------------------------------------------------------------------------
# Opt-in, diff-only mutation-testing gate shared by the lefthook pre-push hook
# and CI.
#
# Behavior:
#   1. Reads `mutation.gate.yml`. If the gate is disabled (the default), it
#      prints a notice and exits 0 — pushes and CI are never slowed down until a
#      project explicitly opts in.
#   2. When enabled, it runs mutant with `--since <ref>` so only code changed on
#      this branch (vs the configured `since` ref) is mutated. Mutation testing
#      is slow, so a full-suite run is never done by this gate.
#   3. The subjects to mutate are defined in `.mutant.yml` (matcher.subjects);
#      mutant exits non-zero when surviving mutants remain in the changed code,
#      which fails the gate.
#
# NOTE: mutant is commercially licensed for closed-source projects (free for
#       open source). Enabling this gate requires a valid license or switching
#       the integration to a permissively licensed alternative.
#
# Configuration (`mutation.gate.yml`, project-owned / create-only):
#   enabled: false
#   since: main
#
# Overridable via env: MUTATION_ENABLED=true|false, MUTATION_SINCE=<ref>.
# -----------------------------------------------------------------------------
set -euo pipefail

GATE_FILE="mutation.gate.yml"

read_gate() {
  local key="$1" default="$2"
  if [ -f "$GATE_FILE" ] && command -v ruby >/dev/null 2>&1; then
    ruby -ryaml -e "puts (YAML.load_file('${GATE_FILE}') || {}).fetch('${key}', '${default}')" 2>/dev/null || echo "$default"
  else
    echo "$default"
  fi
}

ENABLED="${MUTATION_ENABLED:-$(read_gate enabled false)}"
SINCE="${MUTATION_SINCE:-$(read_gate since main)}"

if [ "$ENABLED" != "true" ]; then
  echo "⚪ Mutation-testing gate disabled (mutation.gate.yml: enabled: false). Skipping."
  echo "   Set enabled: true (and configure matcher.subjects in .mutant.yml) to turn it on."
  exit 0
fi

# Only mutate when changed Ruby files exist under app/ or lib/.
BASE=""
for ref in "origin/${SINCE}" "${SINCE}"; do
  if BASE="$(git merge-base "$ref" HEAD 2>/dev/null)"; then
    [ -n "$BASE" ] && break
  fi
done

if [ -z "$BASE" ]; then
  echo "⚪ Mutation gate: could not resolve a merge-base against '${SINCE}'. Skipping."
  exit 0
fi

CHANGED="$(git diff --name-only --diff-filter=ACMR "${BASE}...HEAD" -- 'app/**/*.rb' 'lib/**/*.rb' || true)"
if [ -z "$CHANGED" ]; then
  echo "⚪ Mutation gate: no changed Ruby files under app/ or lib/ vs ${SINCE}. Nothing to mutate."
  exit 0
fi

echo "🧬 Mutation gate: running mutant (--since ${SINCE}) on changed subjects..."
exec bundle exec mutant run --since "$SINCE"

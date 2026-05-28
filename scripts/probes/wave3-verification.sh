#!/usr/bin/env bash
# Wave 3 per-cluster empirical verification probes.
#
# Runs end-to-end checks against each in-scope coding agent CLI that's
# installed on the local machine. Output is captured under
# `/tmp/wave3-e2e-<agent>.md` for attachment to the Wave 3 PR description.
#
# When an agent CLI is not on $PATH, the probe is skipped (not failed) — this
# script must succeed on CI hosts that lack the runtime CLIs. Per the Wave 2
# fan-out spec the probe cache (scripts/internal-<agent>-runtime-probe.json)
# captures unverified state so the Pattern B generators can fall through to
# conservative defaults.
#
# Usage: bash scripts/probes/wave3-verification.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLUGINS_DIR="$REPO_ROOT/plugins"

mkdir -p /tmp/wave3-evidence

probe_cursor() {
  if ! command -v cursor-agent >/dev/null 2>&1; then
    echo "[skip] cursor-agent not on PATH" | tee /tmp/wave3-evidence/cursor.md
    return 0
  fi
  if [ ! -d "$PLUGINS_DIR/lisa-cursor" ]; then
    echo "[skip] plugins/lisa-cursor not built — run \`bun run build:plugins\` first" \
      | tee /tmp/wave3-evidence/cursor.md
    return 0
  fi
  {
    echo "# Cursor Wave 3 Verification"
    echo
    echo "Probe: \`cursor-agent -p --trust --plugin-dir plugins/lisa-cursor \"list Lisa skills\"\`"
    echo
    echo "## Result"
    echo
    echo '```'
    cursor-agent -p --trust --plugin-dir "$PLUGINS_DIR/lisa-cursor" --model composer-2.5 \
      "List the names of Lisa skills you can see. One per line." 2>&1 | head -40 || true
    echo '```'
  } > /tmp/wave3-evidence/cursor.md
}

probe_agy() {
  if ! command -v agy >/dev/null 2>&1; then
    echo "[skip] agy not on PATH" | tee /tmp/wave3-evidence/agy.md
    return 0
  fi
  if [ ! -d "$PLUGINS_DIR/lisa-agy" ]; then
    echo "[skip] plugins/lisa-agy not built" | tee /tmp/wave3-evidence/agy.md
    return 0
  fi
  {
    echo "# agy Wave 3 Verification"
    echo
    echo "Probe 1: \`agy plugin validate plugins/lisa-agy\` (schema gate)"
    echo
    echo '```'
    agy plugin validate "$PLUGINS_DIR/lisa-agy" 2>&1 | head -10 || true
    echo '```'
    echo
    echo "Probe 2: install + list"
    echo
    echo '```'
    agy plugin install "$PLUGINS_DIR/lisa-agy" 2>&1 | head -10 || true
    echo "---"
    agy plugin list 2>&1 | head -20 || true
    echo '```'
  } > /tmp/wave3-evidence/agy.md
}

probe_copilot() {
  if ! command -v copilot >/dev/null 2>&1; then
    echo "[skip] copilot not on PATH" | tee /tmp/wave3-evidence/copilot.md
    return 0
  fi
  if [ ! -d "$PLUGINS_DIR/lisa-copilot" ]; then
    echo "[skip] plugins/lisa-copilot not built" | tee /tmp/wave3-evidence/copilot.md
    return 0
  fi
  {
    echo "# Copilot Wave 3 Verification"
    echo
    echo "Probe: \`copilot -p --allow-all-tools --plugin-dir plugins/lisa-copilot \"list Lisa agents\"\`"
    echo
    echo "## Result"
    echo
    echo '```'
    copilot -p "List names of Lisa agents available. One per line, no prose." \
      --allow-all-tools --model gpt-5.5 --effort medium \
      --plugin-dir "$PLUGINS_DIR/lisa-copilot" 2>&1 | head -40 || true
    echo '```'
  } > /tmp/wave3-evidence/copilot.md
}

echo "[probing cursor]"
probe_cursor
echo "[probing agy]"
probe_agy
echo "[probing copilot]"
probe_copilot
echo
echo "Evidence written to /tmp/wave3-evidence/{cursor,agy,copilot}.md"

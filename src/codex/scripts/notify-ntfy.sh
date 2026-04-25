#!/usr/bin/env bash
# Lisa-managed Codex hook script (Stop event).
# Sends a desktop/push notification when a Codex session completes.
# No-op if NTFY_TOPIC is not set or curl is unavailable.
set -euo pipefail

[ -n "${NTFY_TOPIC:-}" ] || exit 0
command -v curl >/dev/null 2>&1 || exit 0

TITLE="${NTFY_TITLE:-Codex session complete}"
MESSAGE="${NTFY_MESSAGE:-Your Codex session has finished. Check the terminal for results.}"

curl -s -m 5 \
  -H "Title: ${TITLE}" \
  -H "Priority: default" \
  -d "${MESSAGE}" \
  "https://ntfy.sh/${NTFY_TOPIC}" \
  >/dev/null 2>&1 || true

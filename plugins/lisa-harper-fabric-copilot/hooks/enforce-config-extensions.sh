#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly - changes will be overwritten on the next `lisa` run.

# PostToolUse hook: after a harper-app/config.yaml edit, compare the edited
# extension set against HEAD and block silent removals. Harper does not merge a
# custom config.yaml with defaults, so removing a top-level extension can disable
# runtime surfaces without a build-time failure.

PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-}
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if command -v bun >/dev/null 2>&1; then
  exec bun "$PLUGIN_ROOT/hooks/enforce-config-extensions.mjs"
fi

exec node "$PLUGIN_ROOT/hooks/enforce-config-extensions.mjs"

#!/usr/bin/env bash
# Install Rails Git wrappers in non-interactive agent sessions.
cat >/dev/null
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Rails Git hooks: Node.js is unavailable; run bundle exec lefthook install.' >&2
  exit 0
fi
node "$HOOK_DIR/install-rails-hooks.mjs"
exit 0

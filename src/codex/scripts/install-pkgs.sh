#!/usr/bin/env bash
# Lisa-managed Codex hook script (SessionStart startup).
# Mirrors Claude's dependency bootstrap, but remains fail-open so Codex startup
# is never bricked by a package-manager issue.
set -uo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" 2>/dev/null || exit 0

if [ -d "node_modules" ] || [ ! -f "package.json" ]; then
  exit 0
fi

if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
  command -v bun >/dev/null 2>&1 && bun install
elif [ -f "pnpm-lock.yaml" ]; then
  command -v pnpm >/dev/null 2>&1 && pnpm install
elif [ -f "yarn.lock" ]; then
  command -v yarn >/dev/null 2>&1 && yarn install
elif [ -f "package-lock.json" ]; then
  command -v npm >/dev/null 2>&1 && npm install
else
  command -v npm >/dev/null 2>&1 && npm install
fi

exit 0

#!/usr/bin/env bash
# Lisa-managed Codex hook script (SessionStart startup).
# Mirrors Claude's dependency bootstrap, but remains fail-open so Codex startup
# is never bricked by a package-manager issue.
set -uo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" 2>/dev/null || exit 0

if [ ! -f "package.json" ]; then
  exit 0
fi

link_primary_worktree_node_modules() {
  [ ! -e "node_modules" ] && [ ! -L "node_modules" ] || return 1

  case "$repo_root" in
    */.claude/worktrees/*)
      primary_root="${repo_root%%/.claude/worktrees/*}"
      ;;
    *)
      return 1
      ;;
  esac

  [ "$primary_root" != "$repo_root" ] || return 1
  [ -d "$primary_root/node_modules" ] || return 1

  ln -s "$primary_root/node_modules" "node_modules"
}

if [ -d "node_modules" ]; then
  exit 0
fi

if link_primary_worktree_node_modules && [ -d "node_modules" ]; then
  exit 0
fi

# Detect the package manager this project wants, honoring explicit opt-outs.
# Precedence: packageManager field > engines "please-use-<pm>" sentinel >
# lockfile presence (minus any PM the engines forbid) > npm default.
#
# This must NOT key on lockfile presence alone. An npm-only project
# (engines.bun = "please-use-npm", CI runs `npm ci`) that picks up a stray
# bun.lock would otherwise get `bun install`, re-create the bun.lock, and break
# — the SE-5221 regression. The engines/packageManager signals are
# authoritative; lockfiles are only a fallback and never override an opt-out.
detect_package_manager() {
  _field="" _forced="" _forbidden=""
  if [ -f package.json ] && command -v jq >/dev/null 2>&1; then
    _field=$(jq -r '(.packageManager // "") | sub("@.*$";"")' package.json 2>/dev/null)
    _forced=$(jq -r 'first((.engines // {})[] | strings | capture("please-use-(?<pm>bun|npm|yarn|pnpm)")?.pm) // ""' package.json 2>/dev/null)
    _forbidden=$(jq -r '[(.engines // {}) | to_entries[] | select(((.value|strings) // "") | test("please-use|do-not-use";"i")) | .key] | join(" ")' package.json 2>/dev/null)
  fi
  case "$_field" in bun | npm | yarn | pnpm) printf '%s\n' "$_field"; return 0 ;; esac
  case "$_forced" in bun | npm | yarn | pnpm) printf '%s\n' "$_forced"; return 0 ;; esac
  _pm_allowed() { case " $_forbidden " in *" $1 "*) return 1 ;; *) return 0 ;; esac; }
  if { [ -f bun.lockb ] || [ -f bun.lock ]; } && _pm_allowed bun; then printf 'bun\n'; return 0; fi
  if [ -f pnpm-lock.yaml ] && _pm_allowed pnpm; then printf 'pnpm\n'; return 0; fi
  if [ -f yarn.lock ] && _pm_allowed yarn; then printf 'yarn\n'; return 0; fi
  if [ -f package-lock.json ] && _pm_allowed npm; then printf 'npm\n'; return 0; fi
  printf 'npm\n'
}

PACKAGE_MANAGER="$(detect_package_manager)"
case "$PACKAGE_MANAGER" in
  bun) command -v bun >/dev/null 2>&1 && bun install ;;
  pnpm) command -v pnpm >/dev/null 2>&1 && pnpm install ;;
  yarn) command -v yarn >/dev/null 2>&1 && yarn install ;;
  *) command -v npm >/dev/null 2>&1 && npm install ;;
esac

exit 0

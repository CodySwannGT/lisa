#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Drain the hook envelope before any early return. The script does not inspect
# it, but Codex/Cursor-compatible runners may stream it through a bounded pipe.
cat >/dev/null 2>&1 || true

link_primary_worktree_node_modules() {
  [ -f "package.json" ] || return 1
  [ ! -e "node_modules" ] && [ ! -L "node_modules" ] || return 1

  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  # A linked worktree's --git-common-dir is <primary>/.git no matter where the
  # worktree lives (.claude/worktrees, ~/.codex/worktrees, plain
  # `git worktree add`), so derive the primary checkout from it. Fall back to
  # the legacy .claude path parse on git <2.31 (no --path-format support).
  git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -n "$git_common_dir" ]; then
    primary_root="$(dirname "$git_common_dir")"
  else
    case "$repo_root" in
      */.claude/worktrees/*)
        primary_root="${repo_root%%/.claude/worktrees/*}"
        ;;
      *)
        return 1
        ;;
    esac
  fi

  [ "$primary_root" != "$repo_root" ] || return 1
  [ -d "$primary_root/node_modules" ] || return 1

  ln -s "$primary_root/node_modules" "node_modules"
  echo "Linked node_modules from primary worktree: $primary_root/node_modules" >&2
}

# Only run package installation when node_modules are missing.
# This covers remote environments, new worktrees, fresh clones, and CI.
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
echo "Detected package manager: ${PACKAGE_MANAGER}" >&2
case "$PACKAGE_MANAGER" in
  bun) bun install >&2 ;;
  pnpm) pnpm install >&2 ;;
  yarn) yarn install >&2 ;;
  *) npm install >&2 ;;
esac

exit 0

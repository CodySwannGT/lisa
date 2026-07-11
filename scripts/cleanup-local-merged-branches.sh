#!/bin/bash
#
# Cleanup Local Merged Branches
#
# Deletes local branches that are safe to remove:
#   - Branches whose upstream was deleted on the remote ("gone" — the usual
#     aftermath of delete-branch-on-merge), AND
#   - Branches fully merged into an environment branch (main/dev/staging)
#
# Never touches:
#   - The currently checked-out branch
#   - Environment branches (main, dev, staging) or the default branch
#   - Branches checked out in a linked worktree (git refuses; reported)
#   - Unmerged branches (uses safe `git branch -d`)
#
# Usage:
#   ./scripts/cleanup-local-merged-branches.sh [--dry-run] [repo-path]
#
set -euo pipefail

PROTECTED_BRANCHES=("main" "dev" "staging")

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_dry_run() { echo -e "${CYAN}[DRY-RUN]${NC} Would delete: $1"; }

DRY_RUN=false
REPO_PATH="."
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) REPO_PATH="$arg" ;;
  esac
done

cd "$REPO_PATH"
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo -e "${RED}[ERROR]${NC} Not a git repository: $REPO_PATH" >&2
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current || echo "")
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || echo "main")
PROTECTED_BRANCHES+=("$DEFAULT_BRANCH")

is_protected() {
  local branch="$1"
  [[ "$branch" == "$CURRENT_BRANCH" ]] && return 0
  for protected in "${PROTECTED_BRANCHES[@]}"; do
    [[ "$branch" == "$protected" ]] && return 0
  done
  return 1
}

log_info "Fetching and pruning remote-tracking references..."
git fetch --prune --quiet

# Candidates, deduped: gone-upstream branches + branches merged into any
# environment branch that exists on the remote.
candidates=$(
  {
    git branch --format '%(refname:short) %(upstream:track)' \
      | awk '$2 == "[gone]" {print $1}'
    for env_branch in main dev staging; do
      if git show-ref --verify --quiet "refs/remotes/origin/$env_branch"; then
        git branch --merged "origin/$env_branch" --format '%(refname:short)'
      fi
    done
  } | sort -u
)

deleted=0
kept=0
while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  if is_protected "$branch"; then
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log_dry_run "$branch"
    deleted=$((deleted + 1))
    continue
  fi

  # Safe delete only: -d refuses unmerged branches and worktree checkouts.
  if git branch -d "$branch" > /dev/null 2>&1; then
    log_success "Deleted: $branch"
    deleted=$((deleted + 1))
  else
    log_warning "Kept (unmerged or checked out in a worktree): $branch"
    kept=$((kept + 1))
  fi
done <<< "$candidates"

echo ""
if [[ "$DRY_RUN" == true ]]; then
  log_info "Dry run complete. $deleted branch(es) would be deleted."
else
  log_success "Deleted $deleted branch(es); kept $kept."
fi

#!/bin/bash
#
# Cleanup GitHub Merged Branches
#
# Deletes remote branches that have been MERGED and are safe to remove:
#   - NOT environment branches (main, dev, staging) or the default branch
#   - NOT associated with an open pull request
#   - Provably merged: either a merged PR exists for the branch, or the
#     branch is fully contained in an environment branch (compare status
#     "behind"/"identical")
#
# Abandoned-but-unmerged branches are reported but never deleted — they may
# hold real work that was simply never PR'd.
#
# Usage:
#   ./scripts/cleanup-github-branches.sh <owner/repo> [--dry-run]
#
# Example:
#   ./scripts/cleanup-github-branches.sh repo-org/repo-name
#   ./scripts/cleanup-github-branches.sh repo-org/repo-name --dry-run
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated
#   - Write access to the repository
#

set -euo pipefail

# Environment branches that must never be deleted
PROTECTED_BRANCHES=("main" "dev" "staging")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: $0 <owner/repo> [--dry-run]"
  echo ""
  echo "Arguments:"
  echo "  owner/repo    GitHub repository in format 'owner/repo'"
  echo "  --dry-run     Show what would be deleted without actually deleting"
  exit 1
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_dry_run() { echo -e "${CYAN}[DRY-RUN]${NC} Would delete: $1"; }

is_protected_branch() {
  local branch="$1"
  for protected in "${PROTECTED_BRANCHES[@]}"; do
    if [[ "$branch" == "$protected" ]]; then
      return 0
    fi
  done
  return 1
}

# A branch is merged when a merged PR exists for it, or its tip is fully
# contained in an environment branch.
is_merged_branch() {
  local branch="$1"

  local merged_pr
  merged_pr=$(gh pr list --repo "$REPO" --state merged --head "$branch" \
    --limit 1 --json number --jq 'length' 2>/dev/null || echo 0)
  if [[ "$merged_pr" -gt 0 ]]; then
    return 0
  fi

  for base in "${EXISTING_ENV_BRANCHES[@]}"; do
    local status
    status=$(gh api "repos/$REPO/compare/$base...$branch" \
      --jq '.status' 2>/dev/null || echo "unknown")
    if [[ "$status" == "behind" || "$status" == "identical" ]]; then
      return 0
    fi
  done

  return 1
}

# Check arguments
if [[ $# -lt 1 ]]; then
  usage
fi

REPO="$1"
DRY_RUN=false

if [[ $# -ge 2 && "$2" == "--dry-run" ]]; then
  DRY_RUN=true
  log_warning "Running in dry-run mode - no branches will be deleted"
  echo ""
fi

# Validate repo format
if [[ ! "$REPO" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]; then
  log_error "Invalid repository format. Expected 'owner/repo', got: $REPO"
  exit 1
fi

# Check GitHub CLI authentication
log_info "Checking GitHub CLI authentication..."
if ! gh auth status > /dev/null 2>&1; then
  log_error "GitHub CLI is not authenticated. Please run 'gh auth login' first."
  exit 1
fi
log_success "GitHub CLI authenticated"
echo ""

# Verify repository access + resolve default branch
log_info "Verifying access to repository: $REPO"
DEFAULT_BRANCH=$(gh repo view "$REPO" --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null) || {
  log_error "Cannot access repository: $REPO"
  exit 1
}
PROTECTED_BRANCHES+=("$DEFAULT_BRANCH")
log_success "Repository access confirmed (default branch: $DEFAULT_BRANCH)"
echo ""

# Get all remote branches
log_info "Fetching all remote branches..."
all_branches=$(gh api "repos/$REPO/branches" --paginate --jq '.[].name' | sort -u)
total_branch_count=$(echo "$all_branches" | grep -c . || true)
log_info "Found $total_branch_count total branches"

# Environment branches that exist in this repo (containment bases)
EXISTING_ENV_BRANCHES=()
for env_branch in main dev staging; do
  if echo "$all_branches" | grep -qxF "$env_branch"; then
    EXISTING_ENV_BRANCHES+=("$env_branch")
  fi
done

# Get branches with open PRs
log_info "Fetching open pull requests..."
open_pr_branches=$(gh pr list --repo "$REPO" --state open --limit 500 --json headRefName --jq '.[].headRefName' | sort -u)
open_pr_count=$(echo "$open_pr_branches" | grep -c . || true)
log_info "Found $open_pr_count branches with open PRs"
echo ""

# Classify branches
log_info "Classifying branches (merged vs unmerged)..."
merged_branches=()
unmerged_branches=()

while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  if is_protected_branch "$branch"; then
    continue
  fi
  if echo "$open_pr_branches" | grep -qxF "$branch"; then
    continue
  fi
  if is_merged_branch "$branch"; then
    merged_branches+=("$branch")
  else
    unmerged_branches+=("$branch")
  fi
done <<< "$all_branches"

if [[ ${#unmerged_branches[@]} -gt 0 ]]; then
  log_warning "Skipping ${#unmerged_branches[@]} unmerged branch(es) (may hold unshipped work):"
  for branch in "${unmerged_branches[@]}"; do
    echo "  - $branch"
  done
  echo ""
fi

if [[ ${#merged_branches[@]} -eq 0 ]]; then
  log_success "No merged branches found. Repository is clean!"
  exit 0
fi

log_warning "Found ${#merged_branches[@]} merged branch(es) to delete"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Merged branches:"
for branch in "${merged_branches[@]}"; do
  echo "  - $branch"
done
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Delete merged branches
deleted_count=0
failed_count=0

for branch in "${merged_branches[@]}"; do
  # Safety check - never delete protected branches
  if is_protected_branch "$branch"; then
    log_error "Attempted to delete protected branch: $branch - SKIPPING"
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log_dry_run "$branch"
  else
    echo -n "Deleting: $branch ... "
    if gh api -X DELETE "repos/$REPO/git/refs/heads/$branch" > /dev/null 2>&1; then
      echo -e "${GREEN}done${NC}"
      deleted_count=$((deleted_count + 1))
    else
      echo -e "${RED}failed${NC}"
      failed_count=$((failed_count + 1))
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$DRY_RUN" == true ]]; then
  log_info "Dry run complete. ${#merged_branches[@]} branch(es) would be deleted."
else
  log_success "Deleted $deleted_count branch(es); $failed_count failed."
  log_success "Branch cleanup complete for $REPO"
fi

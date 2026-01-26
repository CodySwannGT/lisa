#!/bin/bash
#
# Cleanup GitHub Stale Branches
#
# Deletes remote branches that are:
#   - NOT protected branches (main, dev, staging)
#   - NOT associated with an open pull request
#
# This helps keep the repository clean by removing stale feature branches
# that have been merged or abandoned.
#
# Usage:
#   ./scripts/cleanup-github-branches.sh <owner/repo>
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

# Protected branches that should never be deleted
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
  echo ""
  echo "Example:"
  echo "  $0 repo-org/repo-name"
  echo "  $0 repo-org/repo-name --dry-run"
  exit 1
}

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_dry_run() {
  echo -e "${CYAN}[DRY-RUN]${NC} Would delete: $1"
}

is_protected_branch() {
  local branch="$1"
  for protected in "${PROTECTED_BRANCHES[@]}"; do
    if [[ "$branch" == "$protected" ]]; then
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
if [[ ! "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+$ ]]; then
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

# Verify repository access
log_info "Verifying access to repository: $REPO"
if ! gh repo view "$REPO" > /dev/null 2>&1; then
  log_error "Cannot access repository: $REPO"
  log_error "Please check the repository name and your permissions."
  exit 1
fi
log_success "Repository access confirmed"
echo ""

# Get branches with open PRs
log_info "Fetching open pull requests..."
open_pr_branches=$(gh pr list --repo "$REPO" --state open --json headRefName --jq '.[].headRefName' | sort)
open_pr_count=$(echo "$open_pr_branches" | grep -c . || true)
log_info "Found $open_pr_count branches with open PRs"

# Get all remote branches
log_info "Fetching all remote branches..."
all_branches=$(gh api "repos/$REPO/branches" --paginate --jq '.[].name' | sort)
total_branch_count=$(echo "$all_branches" | grep -c . || true)
log_info "Found $total_branch_count total branches"
echo ""

# Find stale branches (not protected, no open PR)
log_info "Identifying stale branches..."
stale_branches=$(comm -23 <(echo "$all_branches") <(echo "$open_pr_branches") | while read -r branch; do
  if ! is_protected_branch "$branch"; then
    echo "$branch"
  fi
done)

stale_count=$(echo "$stale_branches" | grep -c . || true)

if [[ "$stale_count" -eq 0 || -z "$stale_branches" ]]; then
  log_success "No stale branches found. Repository is clean!"
  exit 0
fi

log_warning "Found $stale_count stale branch(es) to delete"
echo ""

# Display stale branches
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Stale branches:"
echo "$stale_branches" | while read -r branch; do
  echo "  - $branch"
done
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Delete stale branches
deleted_count=0
failed_count=0

echo "$stale_branches" | while read -r branch; do
  if [[ -z "$branch" ]]; then
    continue
  fi

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
      ((deleted_count++)) || true
    else
      echo -e "${RED}failed${NC}"
      ((failed_count++)) || true
    fi
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$DRY_RUN" == true ]]; then
  log_info "Dry run complete. $stale_count branch(es) would be deleted."
else
  log_success "Branch cleanup complete for $REPO"
  echo ""

  # Show remaining branches
  log_info "Remaining branches:"
  gh api "repos/$REPO/branches" --paginate --jq '.[].name' | sort | while read -r branch; do
    echo "  - $branch"
  done
fi

#!/bin/bash
#
# GitHub Status Check
#
# Checks multiple GitHub repositories for:
#   1. Open pull requests
#   2. Pull requests assigned to the current user
#   3. Pull requests waiting for code review from the current user
#   4. GitHub Actions that are currently in a failed state
#
# The script reads repositories from the LISA_GITHUB_REPOS environment variable
# in the format: owner/repo owner/repo owner/repo
#
# Usage:
#   LISA_GITHUB_REPOS="owner/repo1 owner/repo2" ./scripts/github-status-check.sh
#
# Example:
#   LISA_GITHUB_REPOS="CodySwannGT/lisa anthropics/claude-code" ./scripts/github-status-check.sh
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated
#   - LISA_GITHUB_REPOS environment variable set with space-separated repos
#

set -euo pipefail

# Auto-load .env.local if it exists (look in script dir and current dir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$PROJECT_ROOT/.env.local" ]]; then
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env.local"
elif [[ -f ".env.local" ]]; then
  # shellcheck source=/dev/null
  source ".env.local"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

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

log_header() {
  echo ""
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${MAGENTA}$1${NC}"
  echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

time_ago() {
  local timestamp="$1"
  local now
  local then
  local diff_seconds
  local diff_hours
  local diff_days

  now=$(date +%s)
  then=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$timestamp" +%s 2>/dev/null || date -d "$timestamp" +%s 2>/dev/null)
  diff_seconds=$((now - then))
  diff_hours=$((diff_seconds / 3600))
  diff_days=$((diff_hours / 24))

  if [[ $diff_days -gt 0 ]]; then
    if [[ $diff_days -eq 1 ]]; then
      echo "1 day ago"
    else
      echo "$diff_days days ago"
    fi
  elif [[ $diff_hours -gt 0 ]]; then
    if [[ $diff_hours -eq 1 ]]; then
      echo "1 hour ago"
    else
      echo "$diff_hours hours ago"
    fi
  else
    echo "just now"
  fi
}

# Check for LISA_GITHUB_REPOS environment variable
if [[ -z "${LISA_GITHUB_REPOS:-}" ]]; then
  log_error "LISA_GITHUB_REPOS environment variable is not set"
  log_info "Usage: LISA_GITHUB_REPOS=\"owner/repo1 owner/repo2\" $0"
  exit 1
fi

# Check GitHub CLI authentication
log_info "Checking GitHub CLI authentication..."
if ! gh auth status > /dev/null 2>&1; then
  log_error "GitHub CLI is not authenticated. Please run 'gh auth login' first."
  exit 1
fi
log_success "GitHub CLI authenticated"

# Get current user
CURRENT_USER=$(gh api user --jq '.login')
log_success "Current user: $CURRENT_USER"
echo ""

# Initialize counters
total_open_prs=0
total_assigned_prs=0
total_review_prs=0
total_failed_actions=0

# Parse repos from environment variable
IFS=' ' read -ra REPOS <<< "$LISA_GITHUB_REPOS"

# Process each repository
for REPO in "${REPOS[@]}"; do
  # Validate repo format
  if [[ ! "$REPO" =~ ^[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+$ ]]; then
    log_warning "Invalid repository format: $REPO (expected owner/repo)"
    continue
  fi

  # Verify repository access
  if ! gh repo view "$REPO" > /dev/null 2>&1; then
    log_warning "Cannot access repository: $REPO"
    continue
  fi

  log_info "Processing repository: $REPO"

  # Get open PRs created by current user
  open_prs=$(gh pr list --repo "$REPO" --state open --author "$CURRENT_USER" --json number,title,url,createdAt --jq '.[] | "\(.number)|\(.title)|\(.url)|\(.createdAt)"' 2>/dev/null || echo "")
  open_prs_count=$(echo "$open_prs" | grep -c . || true)

  # Get PRs assigned to current user (excluding dependabot)
  assigned_prs=$(gh pr list --repo "$REPO" --state open --assignee "$CURRENT_USER" --json number,title,author,url,createdAt --jq '.[] | select(.author.login != "dependabot[bot]" and .author.login != "app/dependabot") | "\(.number)|\(.title)|\(.url)|\(.createdAt)"' 2>/dev/null || echo "")
  assigned_prs_count=$(echo "$assigned_prs" | grep -c . || true)

  # Get PRs where current user is requested for review (excluding dependabot)
  review_prs=$(gh pr list --repo "$REPO" --state open --json number,title,author,reviewRequests,url,createdAt --jq '.[] | select(.author.login != "dependabot[bot]" and .author.login != "app/dependabot") | select(.reviewRequests | length > 0) | select(.reviewRequests[].requestedReviewer.login == "'$CURRENT_USER'") | "\(.number)|\(.title)|\(.author.login)|\(.url)|\(.createdAt)"' 2>/dev/null || echo "")
  review_prs_count=$(echo "$review_prs" | grep -c . || true)

  # Get failed GitHub Actions
  # Check the latest workflow runs and filter for failed ones
  failed_actions=$(gh api "repos/$REPO/actions/runs" --jq '.workflow_runs[] | select(.status == "completed" and .conclusion == "failure") | "\(.id)|\(.name)|\(.head_branch)|\(.html_url)|\(.created_at)"' 2>/dev/null || echo "")
  failed_actions_count=$(echo "$failed_actions" | grep -c . || true)

  # Display results for this repo
  if [[ $open_prs_count -gt 0 || $assigned_prs_count -gt 0 || $review_prs_count -gt 0 || $failed_actions_count -gt 0 ]]; then
    log_header "Repository: $REPO"

    # Display open PRs (created by current user)
    if [[ $open_prs_count -gt 0 ]]; then
      echo -e "${CYAN}Your Open Pull Requests ($open_prs_count):${NC}"
      echo "$open_prs" | while IFS='|' read -r pr_num title url created_at; do
        age=$(time_ago "$created_at")
        echo "  • #$pr_num - $title - $age"
        echo "    🔗 $url"
      done
      echo ""
      total_open_prs=$((total_open_prs + open_prs_count))
    fi

    # Display assigned PRs
    if [[ $assigned_prs_count -gt 0 ]]; then
      echo -e "${CYAN}PRs Assigned to You ($assigned_prs_count):${NC}"
      echo "$assigned_prs" | while IFS='|' read -r pr_num title url created_at; do
        age=$(time_ago "$created_at")
        echo "  • #$pr_num - $title - $age"
        echo "    🔗 $url"
      done
      echo ""
      total_assigned_prs=$((total_assigned_prs + assigned_prs_count))
    fi

    # Display review requested PRs
    if [[ $review_prs_count -gt 0 ]]; then
      echo -e "${CYAN}PRs Waiting for Your Review ($review_prs_count):${NC}"
      echo "$review_prs" | while IFS='|' read -r pr_num title author url created_at; do
        age=$(time_ago "$created_at")
        echo "  • #$pr_num - $title (by @$author) - $age"
        echo "    🔗 $url"
      done
      echo ""
      total_review_prs=$((total_review_prs + review_prs_count))
    fi

    # Display failed actions
    if [[ $failed_actions_count -gt 0 ]]; then
      echo -e "${RED}Failed GitHub Actions ($failed_actions_count):${NC}"
      echo "$failed_actions" | while IFS='|' read -r action_id action_name branch url created_at; do
        age=$(time_ago "$created_at")
        echo "  • $action_name (branch: $branch) - $age"
        echo "    🔗 $url"
      done
      echo ""
      total_failed_actions=$((total_failed_actions + failed_actions_count))
    fi
  else
    log_success "All checks passed for $REPO"
  fi
done

# Display summary
echo ""
log_header "Summary"
echo -e "Total ${CYAN}Your Open PRs${NC}: $total_open_prs"
echo -e "Total ${CYAN}PRs Assigned to You${NC}: $total_assigned_prs"
echo -e "Total ${CYAN}PRs Waiting for Review${NC}: $total_review_prs"
echo -e "Total ${RED}Failed Actions${NC}: $total_failed_actions"
echo ""

# Exit with appropriate code
if [[ $total_failed_actions -gt 0 || $total_review_prs -gt 0 ]]; then
  log_warning "Action required: Check failed actions or pending reviews"
  exit 0
else
  log_success "All systems normal"
  exit 0
fi

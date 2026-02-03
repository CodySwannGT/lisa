#!/bin/bash
#
# Lisa Local Project Commit & PR
#
# Iterates over projects defined in .lisa.config.local.json, creates
# date-stamped branches for any projects with uncommitted changes,
# commits those changes, pushes to remote, and opens pull requests.
#
# Intended to run after `lisa-update-local.sh` has applied Lisa templates
# to all local projects, so each project's changes get their own PR.
#
# Usage:
#   ./scripts/lisa-commit-and-pr-local.sh [--dry-run]
#
# Example:
#   ./scripts/lisa-commit-and-pr-local.sh
#   ./scripts/lisa-commit-and-pr-local.sh --dry-run
#
# Prerequisites:
#   - jq installed
#   - GitHub CLI (gh) installed and authenticated
#   - .lisa.config.local.json exists in the project root
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISA_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$LISA_ROOT/.lisa.config.local.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

log_dry_run() {
  echo -e "${CYAN}[DRY-RUN]${NC} $1"
}

# Parse arguments
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  log_warning "Running in dry-run mode - no changes will be made"
  echo ""
fi

# Validate prerequisites
if ! command -v jq &> /dev/null; then
  log_error "jq is required but not installed. Install with: brew install jq"
  exit 1
fi

if ! command -v gh &> /dev/null; then
  log_error "GitHub CLI (gh) is required but not installed. Install with: brew install gh"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  log_error "Config file not found: $CONFIG_FILE"
  log_info "Create .lisa.config.local.json with project paths and target branches"
  exit 1
fi

# Validate JSON
if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
  log_error "Invalid JSON in $CONFIG_FILE"
  exit 1
fi

# Check GitHub CLI authentication (skip in dry-run since we won't use it)
if [[ "$DRY_RUN" == false ]]; then
  log_info "Checking GitHub CLI authentication..."
  if ! gh auth status > /dev/null 2>&1; then
    log_error "GitHub CLI is not authenticated. Please run 'gh auth login' first."
    exit 1
  fi
  log_success "GitHub CLI authenticated"
  echo ""
fi

project_count=$(jq 'length' "$CONFIG_FILE")
log_info "Found $project_count project(s) in config"
echo ""

DATE_STAMP=$(date +%Y-%m-%d)

# Counters
success_count=0
fail_count=0
skip_count=0

while IFS=$'\t' read -r project_path target_branch; do
  # Expand tilde to $HOME
  expanded_path="${project_path/#\~/$HOME}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Project: $project_path (base: $target_branch)"

  # Validate directory exists
  if [[ ! -d "$expanded_path" ]]; then
    log_error "Directory does not exist: $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  # Check for changes
  if [[ -z "$(git -C "$expanded_path" status --porcelain)" ]]; then
    log_info "No changes detected, skipping"
    ((skip_count++)) || true
    continue
  fi

  # Determine unique branch name
  branch_name="chore/lisa-update-$DATE_STAMP"
  suffix=1
  while git -C "$expanded_path" show-ref --verify --quiet "refs/heads/$branch_name" 2>/dev/null; do
    ((suffix++)) || true
    branch_name="chore/lisa-update-$DATE_STAMP-$suffix"
  done

  if [[ "$DRY_RUN" == true ]]; then
    log_dry_run "Would create branch: $branch_name"
    log_dry_run "Would stage all changes"
    log_dry_run "Would commit: chore: update Lisa configuration"
    log_dry_run "Would push to origin/$branch_name"
    log_dry_run "Would create PR: chore: update Lisa configuration (base: $target_branch)"
    ((success_count++)) || true
    continue
  fi

  # Create branch
  log_info "Creating branch: $branch_name"
  if ! git -C "$expanded_path" checkout -b "$branch_name" "$target_branch" 2>&1; then
    log_error "Failed to create branch $branch_name in $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  # Stage and commit
  log_info "Staging and committing changes..."
  if ! git -C "$expanded_path" add -A 2>&1; then
    log_error "Failed to stage changes in $expanded_path"
    ((fail_count++)) || true
    continue
  fi
  if ! git -C "$expanded_path" commit -m "chore: update Lisa configuration" 2>&1; then
    log_error "Failed to commit changes in $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  # Push
  log_info "Pushing to origin/$branch_name..."
  if ! GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git -C "$expanded_path" push -u origin "$branch_name" 2>&1; then
    log_error "Failed to push $branch_name in $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  # Create PR
  log_info "Creating pull request..."
  if ! (cd "$expanded_path" && gh pr create --title "chore: update Lisa configuration" --base "$target_branch" --body "Automated Lisa configuration update applied on $DATE_STAMP."); then
    log_error "Failed to create PR for $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  log_success "PR created for $project_path"
  ((success_count++)) || true

done < <(jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$CONFIG_FILE")

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$DRY_RUN" == true ]]; then
  log_info "Dry run complete. $success_count project(s) would have PRs created, $skip_count skipped (no changes)."
else
  log_info "Commit & PR complete"
  echo -e "  ${GREEN}Succeeded${NC}: $success_count"
  echo -e "  ${RED}Failed${NC}:    $fail_count"
  echo -e "  ${YELLOW}Skipped${NC}:   $skip_count"
fi

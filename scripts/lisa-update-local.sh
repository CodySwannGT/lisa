#!/bin/bash
#
# Lisa Local Project Update
#
# Iterates over projects defined in .lisa.config.local.json, checks out their
# target branches, pulls latest changes, and updates @codyswann/lisa via the
# project's package manager. The postinstall script automatically applies
# Lisa templates.
#
# This enables batch-updating all locally managed projects in a single command
# rather than manually visiting each project directory.
#
# Usage:
#   ./scripts/lisa-update-local.sh [--dry-run]
#
# Example:
#   ./scripts/lisa-update-local.sh
#   ./scripts/lisa-update-local.sh --dry-run
#
# Prerequisites:
#   - jq installed
#   - .lisa.config.local.json exists in the project root
#   - each project's package manager (bun, pnpm, yarn, or npm) installed
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

project_count=$(jq 'length' "$CONFIG_FILE")
log_info "Found $project_count project(s) in config"
echo ""

success_count=0
fail_count=0

while IFS=$'\t' read -r project_path target_branch; do
  # Expand tilde to $HOME
  expanded_path="${project_path/#\~/$HOME}"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Project: $project_path (branch: $target_branch)"

  # Validate directory exists
  if [[ ! -d "$expanded_path" ]]; then
    log_error "Directory does not exist: $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log_dry_run "Would checkout '$target_branch' in $expanded_path"
    log_dry_run "Would pull latest from origin/$target_branch"
    log_dry_run "Would run: bun run dev $expanded_path -y"
    ((success_count++)) || true
    continue
  fi

  # Checkout target branch
  log_info "Checking out $target_branch..."
  if ! git -C "$expanded_path" checkout "$target_branch" 2>&1; then
    log_error "Failed to checkout $target_branch in $expanded_path (dirty worktree?)"
    ((fail_count++)) || true
    continue
  fi

  # Pull latest
  log_info "Pulling latest from origin/$target_branch..."
  if ! git -C "$expanded_path" pull origin "$target_branch" 2>&1; then
    log_error "Failed to pull origin/$target_branch in $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  # Detect package manager and update @codyswann/lisa
  log_info "Updating @codyswann/lisa (triggers postinstall template application)..."
  pm=""
  yarn_subcmd=""
  if [[ -f "$expanded_path/bun.lockb" ]]; then
    pm="bun"
  elif [[ -f "$expanded_path/pnpm-lock.yaml" ]]; then
    pm="pnpm"
  elif [[ -f "$expanded_path/yarn.lock" ]]; then
    pm="yarn"
    # Berry (v2+) identified by .yarnrc.yml uses 'up'; Classic (v1) uses 'upgrade'
    if [[ -f "$expanded_path/.yarnrc.yml" ]]; then
      yarn_subcmd="up"
    else
      yarn_subcmd="upgrade"
    fi
  elif [[ -f "$expanded_path/package-lock.json" ]]; then
    pm="npm"
  else
    log_error "Unable to detect package manager for $expanded_path (no supported lockfile found)"
    ((fail_count++)) || true
    continue
  fi

  log_info "Using package manager: $pm"

  if ! command -v "$pm" &> /dev/null; then
    log_error "Package manager '$pm' is not installed for $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  update_ok=true
  if [[ -n "$yarn_subcmd" ]]; then
    (cd "$expanded_path" && yarn "$yarn_subcmd" @codyswann/lisa) || update_ok=false
  else
    (cd "$expanded_path" && "$pm" update @codyswann/lisa) || update_ok=false
  fi

  if [[ "$update_ok" != true ]]; then
    log_error "Failed to update @codyswann/lisa in $expanded_path"
    ((fail_count++)) || true
    continue
  fi

  log_success "Updated $project_path"
  ((success_count++)) || true

done < <(jq -r 'to_entries[] | "\(.key)\t\(.value)"' "$CONFIG_FILE")

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$DRY_RUN" == true ]]; then
  log_info "Dry run complete. $success_count project(s) would be updated."
else
  log_info "Update complete"
  echo -e "  ${GREEN}Succeeded${NC}: $success_count"
  echo -e "  ${RED}Failed${NC}:    $fail_count"
fi

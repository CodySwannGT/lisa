#!/bin/bash
#
# Cleanup AWS Amplify Branches
#
# Disconnects all branches from Amplify apps except for protected environment
# branches (main, dev, staging). This helps reduce Amplify costs and clutter
# from stale feature branches and PR previews.
#
# Usage:
#   ./scripts/cleanup-amplify-branches.sh <aws-profile>
#
# Example:
#   ./scripts/cleanup-amplify-branches.sh profile-dev
#   ./scripts/cleanup-amplify-branches.sh profile-staging
#   ./scripts/cleanup-amplify-branches.sh profile-production
#
# Prerequisites:
#   - AWS CLI v2 installed
#   - AWS SSO configured for the profile
#

set -euo pipefail

# Protected branches that should never be deleted
PROTECTED_BRANCHES=("main" "dev" "staging" "production" "prod")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: $0 <aws-profile>"
  echo ""
  echo "Arguments:"
  echo "  aws-profile    AWS CLI profile name configured with SSO"
  echo ""
  echo "Example:"
  echo "  $0 profile-dev"
  echo "  $0 profile-staging"
  echo "  $0 profile-production"
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
if [[ $# -ne 1 ]]; then
  usage
fi

AWS_PROFILE="$1"

# Perform SSO login
log_info "Logging in with AWS SSO profile: $AWS_PROFILE"
if ! aws sso login --profile "$AWS_PROFILE"; then
  log_error "Failed to login with AWS SSO. Please check your profile configuration."
  exit 1
fi

log_success "SSO login successful"
echo ""

# List all Amplify apps
log_info "Fetching Amplify apps..."
apps_json=$(aws amplify list-apps --profile "$AWS_PROFILE" --output json)
app_count=$(echo "$apps_json" | jq '.apps | length')

if [[ "$app_count" -eq 0 ]]; then
  log_warning "No Amplify apps found for profile: $AWS_PROFILE"
  exit 0
fi

log_info "Found $app_count Amplify app(s)"
echo ""

# Process each app
total_deleted=0

echo "$apps_json" | jq -r '.apps[] | "\(.appId)|\(.name)"' | while IFS='|' read -r app_id app_name; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Processing app: $app_name ($app_id)"

  # Get all branches for this app
  branches=$(aws amplify list-branches \
    --app-id "$app_id" \
    --profile "$AWS_PROFILE" \
    --query 'branches[].branchName' \
    --output text | tr '\t' '\n')

  if [[ -z "$branches" ]]; then
    log_warning "No branches found for app: $app_name"
    continue
  fi

  branch_count=0
  deleted_count=0

  for branch in $branches; do
    ((branch_count++)) || true

    if is_protected_branch "$branch"; then
      log_info "  Keeping protected branch: $branch"
    else
      echo -n "  Deleting: $branch ... "
      if aws amplify delete-branch \
        --app-id "$app_id" \
        --branch-name "$branch" \
        --profile "$AWS_PROFILE" \
        --no-cli-pager > /dev/null 2>&1; then
        echo -e "${GREEN}done${NC}"
        ((deleted_count++)) || true
      else
        echo -e "${RED}failed${NC}"
      fi
    fi
  done

  log_success "Deleted $deleted_count of $branch_count branches from $app_name"
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_success "Amplify branch cleanup complete for profile: $AWS_PROFILE"

#!/usr/bin/env bash
#
# lisa-github-environments.sh
#
# Provisions GitHub deployment Environments declared in .lisa.config.json:
#   { "github": { "environments": {
#       "production": {
#         "branch": "main",
#         "require_approval": true,
#         "reviewers": ["some-user", "some-org/some-team"],
#         "prevent_self_review": false,
#         "wait_timer": 0
#       } } } }
#
# For each declared environment it applies:
#   - required reviewers (the human approval gate), resolved from usernames
#     ("login") and team slugs ("org/team-slug") to reviewer ids
#   - prevent_self_review / wait_timer protection rules
#   - a custom deployment branch policy pinned to the environment's branch,
#     so only that branch can deploy to the environment
#
# Branch resolution order: .branch → deploy.branches[<name>] → <name> itself.
#
# Entirely optional: repos without github.environments in .lisa.config.json
# are left untouched. Provisioning matters because GitHub silently
# auto-creates an environment WITHOUT protection rules the first time a
# workflow references it — an approval gate bound to a non-provisioned
# environment gates on nothing.
#
# Usage:
#   lisa-github-environments.sh [options] [project-path]
#
# Options:
#   -n, --dry-run    Show the environment payloads without applying them
#   -v, --verbose    Show detailed output
#   -h, --help       Show this help message
#
# Requires:
#   - gh CLI (authenticated with repo admin permissions)
#   - jq
#

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DRY_RUN=false
VERBOSE=false
PROJECT_PATH=""
REPO=""

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_verbose() { [[ "$VERBOSE" == "true" ]] && echo -e "  $1" || true; }

show_help() {
  sed -n '2,38p' "$0" | sed 's/^# \{0,1\}//'
}

read_environments() {
  local project_path="$1"
  local envs="{}"

  if [[ -f "$project_path/.lisa.config.json" ]]; then
    if ! envs=$(jq '.github.environments // {}' "$project_path/.lisa.config.json" 2>/dev/null); then
      log_warning ".lisa.config.json could not be parsed — ignoring github.environments" >&2
      envs="{}"
    fi
  fi

  echo "$envs"
}

resolve_branch() {
  local project_path="$1"
  local name="$2"
  local env_json="$3"
  local branch

  branch=$(echo "$env_json" | jq -r '.branch // empty')
  if [[ -z "$branch" && -f "$project_path/.lisa.config.json" ]]; then
    branch=$(jq -r --arg n "$name" '.deploy.branches[$n] // empty' "$project_path/.lisa.config.json" 2>/dev/null) || branch=""
  fi

  echo "${branch:-$name}"
}

# Resolves a reviewer entry to the {type, id} shape the environments API
# expects. Entries containing "/" are org team slugs; anything else is a user.
resolve_reviewer() {
  local entry="$1"
  local id

  if [[ "$entry" == */* ]]; then
    local org="${entry%%/*}"
    local slug="${entry#*/}"
    if ! id=$(gh api "orgs/$org/teams/$slug" --jq .id 2>/dev/null); then
      log_error "Could not resolve team reviewer '$entry' — check the org/team-slug and your token's read:org scope"
      return 1
    fi
    jq -n --argjson id "$id" '{type: "Team", id: $id}'
  else
    if ! id=$(gh api "users/$entry" --jq .id 2>/dev/null); then
      log_error "Could not resolve user reviewer '$entry' — check the username"
      return 1
    fi
    jq -n --argjson id "$id" '{type: "User", id: $id}'
  fi
}

build_payload() {
  local env_json="$1"
  local reviewers_json="$2"

  jq -n \
    --argjson reviewers "$reviewers_json" \
    --argjson prevent "$(echo "$env_json" | jq '.prevent_self_review // false')" \
    --argjson wait "$(echo "$env_json" | jq '.wait_timer // 0')" \
    '{
      wait_timer: $wait,
      prevent_self_review: $prevent,
      reviewers: $reviewers,
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true
      }
    }'
}

ensure_branch_policy() {
  local name="$1"
  local branch="$2"
  local existing

  existing=$(gh api "repos/$REPO/environments/$name/deployment-branch-policies" --jq '.branch_policies[].name' 2>/dev/null) || existing=""
  if echo "$existing" | grep -qxF "$branch"; then
    log_verbose "Deployment branch policy '$branch' already present on '$name'"
    return 0
  fi

  if jq -n --arg b "$branch" '{name: $b}' | gh api -X POST "repos/$REPO/environments/$name/deployment-branch-policies" --input - > /dev/null 2>&1; then
    log_success "Pinned '$name' deployments to branch '$branch'"
  else
    log_warning "Could not create deployment branch policy '$branch' on '$name'"
  fi
}

provision_environment() {
  local name="$1"
  local env_json="$2"
  local branch
  branch=$(resolve_branch "$PROJECT_PATH" "$name" "$env_json")

  local require_approval
  require_approval=$(echo "$env_json" | jq -r '.require_approval // false')

  local reviewer_entries
  reviewer_entries=$(echo "$env_json" | jq -r '.reviewers // [] | .[]')

  # An approval gate with nobody able to approve would silently gate on
  # nothing — refuse rather than provision a no-op.
  if [[ "$require_approval" == "true" && -z "$reviewer_entries" ]]; then
    log_error "Environment '$name' has require_approval: true but no reviewers — list at least one username or org/team-slug in github.environments.$name.reviewers"
    exit 1
  fi

  local reviewers_json="[]"
  local entry reviewer
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    if ! reviewer=$(resolve_reviewer "$entry"); then
      exit 1
    fi
    reviewers_json=$(echo "$reviewers_json" | jq --argjson r "$reviewer" '. + [$r]')
  done <<< "$reviewer_entries"

  local payload
  payload=$(build_payload "$env_json" "$reviewers_json")
  log_verbose "Environment '$name' payload: $(echo "$payload" | jq -c .)"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would provision environment '$name' (branch: $branch):"
    echo "$payload" | jq .
    log_info "[DRY RUN] Would pin deployment branch policy '$branch' on '$name'"
    return 0
  fi

  local response
  if ! response=$(echo "$payload" | gh api -X PUT "repos/$REPO/environments/$name" --input - 2>&1); then
    # Environments with protection rules need a public repo or a paid plan —
    # skip gracefully like the rulesets script does.
    if echo "$response" | grep -qiE "HTTP 403|HTTP 422|upgrade to github"; then
      log_warning "Environments are not available on this repository's plan — skipped '$name'. Approval gates will not be enforced until the repo is public or on a paid plan."
      return 0
    fi
    log_error "Failed to provision environment '$name': $response"
    exit 1
  fi
  log_success "Provisioned environment '$name' (branch: $branch)"

  ensure_branch_policy "$name" "$branch"
}

main() {
  while [[ $# -gt 0 ]]; do
    case $1 in
      -n|--dry-run) DRY_RUN=true; shift ;;
      -v|--verbose) VERBOSE=true; shift ;;
      -h|--help) show_help; exit 0 ;;
      -*) log_error "Unknown option: $1"; show_help; exit 1 ;;
      *) PROJECT_PATH="$1"; shift ;;
    esac
  done

  PROJECT_PATH="${PROJECT_PATH:-.}"
  PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

  if ! command -v gh &> /dev/null || ! command -v jq &> /dev/null; then
    log_error "Requires gh and jq"
    exit 1
  fi

  local envs
  envs=$(read_environments "$PROJECT_PATH")
  if [[ "$(echo "$envs" | jq 'length')" == "0" ]]; then
    log_info "No github.environments configured in .lisa.config.json — skipping"
    return 0
  fi

  if ! gh auth status &> /dev/null; then
    log_error "GitHub CLI is not authenticated. Run 'gh auth login' first."
    exit 1
  fi

  cd "$PROJECT_PATH"
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || {
    log_error "Could not determine repository for $PROJECT_PATH"
    exit 1
  }
  log_info "Repository: $REPO"

  local name env_json
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    env_json=$(echo "$envs" | jq --arg n "$name" '.[$n]')
    provision_environment "$name" "$env_json"
  done <<< "$(echo "$envs" | jq -r 'keys[]')"
}

main "$@"

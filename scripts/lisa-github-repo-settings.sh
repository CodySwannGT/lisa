#!/usr/bin/env bash
#
# lisa-github-repo-settings.sh
#
# Applies Lisa's baseline GitHub repository settings via the gh CLI:
#   - merge commits on, squash and rebase merging off (merge-only fleet policy)
#   - merge commit title/message from the PR (MERGE_MESSAGE / PR_TITLE)
#   - auto-merge enabled
#   - head branches deleted after merge (environment branches survive via
#     the deletion rule in Lisa's rulesets — GitHub never deletes a branch
#     a ruleset protects)
#   - "always suggest updating pull request branches" enabled
#   - GitHub wiki tab disabled (Lisa projects use in-repo wiki/)
#   - secret scanning + push protection enabled where the plan supports it
#
#   - default branch set to the lowest-tier environment branch that exists
#     on the repository (dev > staging > main); repos with none of the
#     environment branches keep their current default
#
# Per-repo overrides come from .lisa.config.json:
#   { "github": { "settings": { "allow_auto_merge": false, "default_branch": "main" } } }
# Any key in github.settings replaces the baseline value for that repo.
#
# Usage:
#   lisa-github-repo-settings.sh [options] [project-path]
#
# Options:
#   -n, --dry-run    Show the settings payload without applying it
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

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1" >&2; }
log_verbose() { [[ "$VERBOSE" == "true" ]] && echo -e "  $1" || true; }

show_help() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

baseline_settings() {
  jq -n '{
    allow_merge_commit: true,
    allow_squash_merge: false,
    allow_rebase_merge: false,
    allow_auto_merge: true,
    allow_update_branch: true,
    delete_branch_on_merge: true,
    merge_commit_title: "MERGE_MESSAGE",
    merge_commit_message: "PR_TITLE",
    web_commit_signoff_required: false,
    has_issues: true,
    has_wiki: false
  }'
}

# The default branch is the lowest-tier environment branch the repo has.
resolve_default_branch() {
  local repo="$1"
  local branch
  for branch in dev staging main; do
    if gh api "repos/$repo/branches/$branch" > /dev/null 2>&1; then
      echo "$branch"
      return 0
    fi
  done
  echo ""
}

# Merge .lisa.config.json github.settings overrides on top of the baseline.
resolved_settings() {
  local project_path="$1"
  local repo="$2"
  local overrides="{}"

  if [[ -f "$project_path/.lisa.config.json" ]]; then
    if ! overrides=$(jq '.github.settings // {}' "$project_path/.lisa.config.json" 2>/dev/null); then
      log_warning ".lisa.config.json could not be parsed — ignoring github.settings overrides" >&2
      overrides="{}"
    fi
  fi

  local base
  base=$(baseline_settings)

  local default_branch
  default_branch=$(resolve_default_branch "$repo")
  if [[ -n "$default_branch" ]]; then
    base=$(echo "$base" | jq --arg b "$default_branch" '. + {default_branch: $b}')
  fi

  jq -n --argjson base "$base" --argjson over "$overrides" '$base * $over'
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
  if ! gh auth status &> /dev/null; then
    log_error "GitHub CLI is not authenticated. Run 'gh auth login' first."
    exit 1
  fi

  cd "$PROJECT_PATH"
  local repo
  repo=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || {
    log_error "Could not determine repository for $PROJECT_PATH"
    exit 1
  }
  log_info "Repository: $repo"

  local settings
  settings=$(resolved_settings "$PROJECT_PATH" "$repo")
  log_verbose "Settings payload: $(echo "$settings" | jq -c .)"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would apply settings:"
    echo "$settings" | jq .
    log_info "[DRY RUN] Would enable secret scanning + push protection (best effort)"
    return 0
  fi

  # Auto-merge isn't available on every plan; if the full payload is
  # rejected, retry without it rather than failing the whole baseline.
  if echo "$settings" | gh api -X PATCH "repos/$repo" --input - > /dev/null 2>&1; then
    log_success "Applied repository settings"
  else
    log_warning "Full settings payload rejected — retrying without allow_auto_merge"
    if echo "$settings" | jq 'del(.allow_auto_merge)' | gh api -X PATCH "repos/$repo" --input - > /dev/null; then
      log_success "Applied repository settings (auto-merge unavailable on this plan)"
    else
      log_error "Failed to apply repository settings"
      exit 1
    fi
  fi

  # Secret scanning + push protection: free on public repos, requires GHAS on
  # private ones — enable where the API allows, skip quietly otherwise.
  if jq -n '{security_and_analysis: {secret_scanning: {status: "enabled"}, secret_scanning_push_protection: {status: "enabled"}}}' \
    | gh api -X PATCH "repos/$repo" --input - > /dev/null 2>&1; then
    log_success "Enabled secret scanning + push protection"
  else
    log_warning "Secret scanning not available on this repository's plan — skipped"
  fi
}

main "$@"

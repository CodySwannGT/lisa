#!/usr/bin/env bash
#
# lisa-github-rulesets.sh
#
# Applies GitHub repository rulesets from Lisa's project type directories.
# Reads ruleset templates from github-rulesets/ folders and uses the gh CLI
# to create or update them on the target repository.
#
# Usage:
#   lisa-github-rulesets.sh [options] [project-path]
#
# Options:
#   -n, --dry-run    Show what would be done without making changes
#   -y, --yes        Non-interactive mode (skip confirmations)
#   -v, --verbose    Show detailed output
#   -h, --help       Show this help message
#
# Requires:
#   - gh CLI (authenticated with repo admin permissions)
#   - jq
#

set -eo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (where Lisa is installed)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default options
DRY_RUN=false
YES_MODE=false
VERBOSE=false
PROJECT_PATH=""

# Project type hierarchy (child -> parent)
# Using a function to avoid associative array issues with set -u
get_parent_type() {
  local type="$1"
  case "$type" in
    typescript) echo "" ;;
    npm-package) echo "typescript" ;;
    expo) echo "typescript" ;;
    nestjs) echo "typescript" ;;
    cdk) echo "typescript" ;;
    *) echo "" ;;
  esac
}

##############################################################################
# Utility Functions
##############################################################################

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1" >&2
}

log_verbose() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo -e "  $1"
  fi
}

show_help() {
  cat << 'EOF'
lisa-github-rulesets.sh - Apply GitHub repository rulesets from Lisa templates

USAGE:
    lisa-github-rulesets.sh [OPTIONS] [PROJECT_PATH]

ARGUMENTS:
    PROJECT_PATH    Path to the project (defaults to current directory)

OPTIONS:
    -n, --dry-run   Show what would be done without making API calls
    -y, --yes       Non-interactive mode (skip confirmations)
    -v, --verbose   Show detailed output
    -h, --help      Show this help message

DESCRIPTION:
    Reads ruleset templates from Lisa's project type directories
    (all/github-rulesets/, typescript/github-rulesets/, etc.) and
    applies them to the target repository using the GitHub API.

    Templates are applied in order: all -> parent types -> specific type.
    If a ruleset with the same name exists, it will be updated.

REQUIREMENTS:
    - gh CLI must be installed and authenticated
    - User must have admin permissions on the repository
    - jq must be installed for JSON processing

EXAMPLES:
    # Apply rulesets to current directory's repo
    lisa-github-rulesets.sh

    # Dry run to see what would happen
    lisa-github-rulesets.sh --dry-run /path/to/project

    # Non-interactive mode
    lisa-github-rulesets.sh --yes /path/to/project
EOF
}

##############################################################################
# Prerequisite Checks
##############################################################################

check_prerequisites() {
  local missing=()

  if ! command -v gh &> /dev/null; then
    missing+=("gh (GitHub CLI)")
  fi

  if ! command -v jq &> /dev/null; then
    missing+=("jq")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing required tools: ${missing[*]}"
    exit 1
  fi

  # Check gh authentication
  if ! gh auth status &> /dev/null; then
    log_error "GitHub CLI is not authenticated. Run 'gh auth login' first."
    exit 1
  fi
}

##############################################################################
# Project Detection
##############################################################################

detect_project_types() {
  local project_path="$1"
  local detected_types=()

  # TypeScript detection
  if [[ -f "$project_path/tsconfig.json" ]]; then
    detected_types+=("typescript")
  elif [[ -f "$project_path/package.json" ]]; then
    if jq -e '.devDependencies.typescript // .dependencies.typescript' "$project_path/package.json" &> /dev/null; then
      detected_types+=("typescript")
    fi
  fi

  # npm-package detection (not private and has main/bin/exports/files)
  if [[ -f "$project_path/package.json" ]]; then
    local is_private
    is_private=$(jq -r '.private // false' "$project_path/package.json")
    if [[ "$is_private" != "true" ]]; then
      if jq -e '.main // .bin // .exports // .files' "$project_path/package.json" &> /dev/null; then
        detected_types+=("npm-package")
      fi
    fi
  fi

  # Expo detection
  if [[ -f "$project_path/app.json" ]] || [[ -f "$project_path/eas.json" ]]; then
    detected_types+=("expo")
  elif [[ -f "$project_path/package.json" ]]; then
    if jq -e '.dependencies.expo // .devDependencies.expo' "$project_path/package.json" &> /dev/null; then
      detected_types+=("expo")
    fi
  fi

  # NestJS detection
  if [[ -f "$project_path/nest-cli.json" ]]; then
    detected_types+=("nestjs")
  elif [[ -f "$project_path/package.json" ]]; then
    if jq -e '.dependencies["@nestjs/core"] // .devDependencies["@nestjs/core"]' "$project_path/package.json" &> /dev/null; then
      detected_types+=("nestjs")
    fi
  fi

  # CDK detection
  if [[ -f "$project_path/cdk.json" ]]; then
    detected_types+=("cdk")
  elif [[ -f "$project_path/package.json" ]]; then
    if jq -e '.dependencies["aws-cdk-lib"] // .devDependencies["aws-cdk-lib"]' "$project_path/package.json" &> /dev/null; then
      detected_types+=("cdk")
    fi
  fi

  echo "${detected_types[@]}"
}

expand_types_with_parents() {
  local -a input_types=("$@")
  local -a expanded=()
  local seen=""

  for type in "${input_types[@]}"; do
    local current="$type"
    local -a chain=()

    # Build chain from type to root
    while [[ -n "$current" ]]; do
      chain+=("$current")
      current=$(get_parent_type "$current")
    done

    # Add in reverse order (parent first)
    for ((i=${#chain[@]}-1; i>=0; i--)); do
      local t="${chain[$i]}"
      if [[ ! " $seen " =~ " $t " ]]; then
        expanded+=("$t")
        seen="$seen $t"
      fi
    done
  done

  echo "${expanded[@]}"
}

##############################################################################
# Repository Info
##############################################################################

get_repo_info() {
  local project_path="$1"

  cd "$project_path"

  if ! git rev-parse --git-dir &> /dev/null; then
    log_error "Not a git repository: $project_path"
    exit 1
  fi

  local repo_info
  repo_info=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || {
    log_error "Could not determine repository. Make sure you're in a git repo with a GitHub remote."
    exit 1
  }

  echo "$repo_info"
}

##############################################################################
# Ruleset Operations
##############################################################################

get_existing_rulesets() {
  local repo="$1"
  gh api "repos/$repo/rulesets" 2>/dev/null || echo "[]"
}

find_ruleset_by_name() {
  local rulesets_json="$1"
  local name="$2"
  echo "$rulesets_json" | jq -r --arg name "$name" '.[] | select(.name == $name) | .id // empty'
}

strip_readonly_fields() {
  local json="$1"
  # Remove fields that are read-only or repository-specific
  echo "$json" | jq 'del(.id, .source_type, .source, .node_id, .created_at, .updated_at, ._links, .current_user_can_bypass)'
}

apply_ruleset() {
  local repo="$1"
  local template_file="$2"
  local existing_rulesets="$3"

  local template_content
  template_content=$(cat "$template_file")

  local ruleset_name
  ruleset_name=$(echo "$template_content" | jq -r '.name')

  local clean_template
  clean_template=$(strip_readonly_fields "$template_content")

  local existing_id
  existing_id=$(find_ruleset_by_name "$existing_rulesets" "$ruleset_name")

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -n "$existing_id" ]]; then
      log_info "[DRY RUN] Would update ruleset '$ruleset_name' (id: $existing_id)"
    else
      log_info "[DRY RUN] Would create ruleset '$ruleset_name'"
    fi
    log_verbose "Template: $template_file"
    return 0
  fi

  # Create temp file for the request body
  local temp_file
  temp_file=$(mktemp)
  echo "$clean_template" > "$temp_file"

  if [[ -n "$existing_id" ]]; then
    log_info "Updating ruleset '$ruleset_name' (id: $existing_id)..."
    if gh api -X PUT "repos/$repo/rulesets/$existing_id" --input "$temp_file" > /dev/null; then
      log_success "Updated ruleset '$ruleset_name'"
    else
      log_error "Failed to update ruleset '$ruleset_name'"
      rm -f "$temp_file"
      return 1
    fi
  else
    log_info "Creating ruleset '$ruleset_name'..."
    if gh api -X POST "repos/$repo/rulesets" --input "$temp_file" > /dev/null; then
      log_success "Created ruleset '$ruleset_name'"
    else
      log_error "Failed to create ruleset '$ruleset_name'"
      rm -f "$temp_file"
      return 1
    fi
  fi

  rm -f "$temp_file"
}

##############################################################################
# Main Logic
##############################################################################

collect_templates() {
  local -a types=("$@")
  local -a templates=()

  # Always include 'all' first
  local all_dir="$SCRIPT_DIR/all/github-rulesets"
  if [[ -d "$all_dir" ]]; then
    for file in "$all_dir"/*.json; do
      [[ -f "$file" ]] && templates+=("$file")
    done
  fi

  # Then add type-specific templates in order
  for type in "${types[@]}"; do
    local type_dir="$SCRIPT_DIR/$type/github-rulesets"
    if [[ -d "$type_dir" ]]; then
      for file in "$type_dir"/*.json; do
        [[ -f "$file" ]] && templates+=("$file")
      done
    fi
  done

  echo "${templates[@]}"
}

main() {
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      -n|--dry-run)
        DRY_RUN=true
        shift
        ;;
      -y|--yes)
        YES_MODE=true
        shift
        ;;
      -v|--verbose)
        VERBOSE=true
        shift
        ;;
      -h|--help)
        show_help
        exit 0
        ;;
      -*)
        log_error "Unknown option: $1"
        show_help
        exit 1
        ;;
      *)
        PROJECT_PATH="$1"
        shift
        ;;
    esac
  done

  # Default to current directory
  PROJECT_PATH="${PROJECT_PATH:-.}"
  PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

  log_info "Lisa GitHub Rulesets"
  echo ""

  # Check prerequisites
  check_prerequisites

  # Get repository info
  local repo
  repo=$(get_repo_info "$PROJECT_PATH")
  log_info "Repository: $repo"

  # Detect project types
  local detected_types_str
  detected_types_str=$(detect_project_types "$PROJECT_PATH")

  if [[ -z "$detected_types_str" ]]; then
    log_warning "No specific project types detected, using 'all' templates only"
    detected_types_str=""
  fi

  # Convert to array safely
  local -a detected_types=()
  if [[ -n "$detected_types_str" ]]; then
    read -ra detected_types <<< "$detected_types_str"
  fi

  # Expand with parent types
  local -a expanded_types=()
  if [[ ${#detected_types[@]} -gt 0 ]]; then
    local expanded_str
    expanded_str=$(expand_types_with_parents "${detected_types[@]}")
    read -ra expanded_types <<< "$expanded_str"
  fi

  if [[ ${#expanded_types[@]} -gt 0 ]]; then
    log_info "Detected types: ${expanded_types[*]}"
  fi

  # Collect templates
  local templates_str
  templates_str=$(collect_templates "${expanded_types[@]}")

  local -a templates=()
  if [[ -n "$templates_str" ]]; then
    read -ra templates <<< "$templates_str"
  fi

  if [[ ${#templates[@]} -eq 0 ]]; then
    log_warning "No ruleset templates found"
    exit 0
  fi

  log_info "Found ${#templates[@]} ruleset template(s)"
  for t in "${templates[@]}"; do
    log_verbose "  - $t"
  done
  echo ""

  # Confirmation prompt
  if [[ "$DRY_RUN" == "false" ]] && [[ "$YES_MODE" == "false" ]]; then
    echo -n "Apply rulesets to $repo? [y/N] "
    read -r response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
      log_info "Aborted"
      exit 0
    fi
    echo ""
  fi

  # Get existing rulesets
  log_info "Fetching existing rulesets..."
  local existing_rulesets
  existing_rulesets=$(get_existing_rulesets "$repo")
  local existing_count
  existing_count=$(echo "$existing_rulesets" | jq 'length')
  log_verbose "Found $existing_count existing ruleset(s)"

  # Apply each template
  local success_count=0
  local fail_count=0

  for template in "${templates[@]}"; do
    if apply_ruleset "$repo" "$template" "$existing_rulesets"; then
      ((success_count++))
    else
      ((fail_count++))
    fi
  done

  echo ""
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "Dry run complete. ${#templates[@]} ruleset(s) would be applied."
  else
    log_success "Applied $success_count ruleset(s)"
    if [[ $fail_count -gt 0 ]]; then
      log_warning "$fail_count ruleset(s) failed"
      exit 1
    fi
  fi
}

main "$@"

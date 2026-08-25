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

# Script directory (this file lives in scripts/; templates live one level up)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISA_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default options
DRY_RUN=false
YES_MODE=false
VERBOSE=false
PROJECT_PATH=""

# Rulesets that already matched and were therefore not sent, and the payload
# GitHub last accepted (set by apply_with_integration_fallback).
UNCHANGED_COUNT=0
APPLIED_PAYLOAD=""

# The temp file holding the config-derived `base` ruleset, cleaned up on exit.
GENERATED_RULESET=""

# Delete the generated ruleset, but ONLY when the top-level shell exits.
#
# A command substitution runs in a subshell that inherits this EXIT trap and
# fires it on the subshell's exit. Without the pid guard the very next
# `$(collect_templates ...)` deleted the file that had just been generated, and
# the applier then read an empty template, resolved its name to the empty
# string, and reported "Skipping ruleset '' — no applicable rules" while
# exiting 0. That is the whole failure mode this change exists to prevent, one
# layer down: a run that reports success having applied no branch protection.
cleanup_generated_ruleset() {
  [[ "$BASHPID" == "$$" ]] || return 0
  [[ -n "$GENERATED_RULESET" ]] && rm -f "$GENERATED_RULESET"
  return 0
}
trap cleanup_generated_ruleset EXIT

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
    rails) echo "" ;;
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

  # The `base` ruleset is no longer a shipped JSON file; it is generated from
  # .lisa.config.json by scripts/lisa-ruleset-payload.mjs. Without node there
  # is no branch protection to apply at all, so this is a hard prerequisite
  # rather than a degraded mode.
  if ! command -v node &> /dev/null; then
    missing+=("node")
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

  # Rails detection
  if [[ -f "$project_path/Gemfile" ]] && grep -q "rails" "$project_path/Gemfile" 2>/dev/null; then
    detected_types+=("rails")
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

# GitHub Actions integration id — its checks only ever report when the project
# actually has workflows, so requiring them on a workflow-less repo (e.g. a
# wiki) would block every PR forever.
ACTIONS_INTEGRATION_ID=15368

strip_actions_checks_if_no_workflows() {
  local json="$1"
  local project_path="$2"

  if [[ -d "$project_path/.github/workflows" ]]; then
    echo "$json"
    return 0
  fi

  echo "$json" | jq --argjson actions "$ACTIONS_INTEGRATION_ID" '
    if .rules then
      .rules |= (
        map(
          if .type == "required_status_checks" then
            .parameters.required_status_checks |=
              map(select(.integration_id != $actions))
          else . end
        )
        | map(select(
            .type != "required_status_checks"
            or (.parameters.required_status_checks | length) > 0
          ))
      )
    else . end'
}

# Per-repo opt-out: .lisa.config.json can list required-check contexts that
# must never be required on this repository, e.g. wikis that should not gate
# on CodeRabbit:
#   { "github": { "rulesets": { "dropRequiredChecks": ["CodeRabbit"] } } }
strip_config_dropped_checks() {
  local json="$1"
  local project_path="$2"
  local config="$project_path/.lisa.config.json"

  if [[ ! -f "$config" ]]; then
    echo "$json"
    return 0
  fi

  local dropped
  if ! dropped=$(jq -c '.github.rulesets.dropRequiredChecks // []' "$config" 2>/dev/null); then
    log_warning ".lisa.config.json could not be parsed — ignoring github.rulesets overrides" >&2
    dropped="[]"
  fi

  if [[ "$dropped" == "[]" ]]; then
    echo "$json"
    return 0
  fi

  echo "$json" | jq --argjson dropped "$dropped" '
    if .rules then
      .rules |= (
        map(
          if .type == "required_status_checks" then
            .parameters.required_status_checks |=
              map(select(.context as $c | ($dropped | index($c)) | not))
          else . end
        )
        | map(select(
            .type != "required_status_checks"
            or (.parameters.required_status_checks | length) > 0
          ))
      )
    else . end'
}

# Per-repo opt-IN, the mirror of dropRequiredChecks above. Some repositories run
# a high-signal check that only exists in THAT repository, so it cannot live in
# a shared template: putting it there would ship a context host projects never
# report, and a required check that never reports blocks every pull request
# forever (the #2476 "aspirational seed a guard then trusts" defect).
#
# Keyed by ruleset name, because more than one ruleset carries a
# required_status_checks rule (the generated `base` and `quality checks` both
# do) and an unkeyed list could not say which one it meant:
#   { "github": { "rulesets": { "requiredChecks": {
#       "quality checks": [
#         { "context": "🧩 Plugin artifacts match source", "integration_id": 15368 }
#       ] } } } }
#
# `requiredChecks` is DECLARATIVE where the retired `addRequiredChecks` was
# additive: naming a ruleset here also stops the applier unioning that
# ruleset's LIVE required list back into the payload. Additive-only could add a
# context and never remove one, so a required check outlived the job that
# posted it and the only way to drop it was the admin console. `addRequiredChecks`
# is still read so installed projects keep applying, with a warning naming its
# replacement.
#
# `integration_id` is optional and defaults to GitHub Actions. Contexts already
# present are not duplicated, and a ruleset with no required_status_checks rule
# gets one created so an addition is never silently dropped.
#
# Additions are applied FIRST, before the no-workflows strip and before
# dropRequiredChecks, so both of those still win over an addition. That is
# deliberate: the no-workflows strip is a safety rule (a required Actions check
# on a repository with no workflows can never report, and would block every pull
# request), and naming the same context in both lists is operator error whose
# safe resolution is to drop it rather than to require it.

# The declared required-check list for one ruleset, or "[]" when none.
# Prefers the declarative key and falls back to the retired additive one.
config_required_checks() {
  local project_path="$1"
  local ruleset_name="$2"
  local config="$project_path/.lisa.config.json"

  if [[ ! -f "$config" ]]; then
    echo "[]"
    return 0
  fi

  local declared
  if ! declared=$(jq -c --arg name "$ruleset_name" \
    '.github.rulesets.requiredChecks[$name] // null' "$config" 2>/dev/null); then
    log_warning ".lisa.config.json could not be parsed — ignoring github.rulesets overrides" >&2
    echo "[]"
    return 0
  fi

  if [[ "$declared" != "null" ]]; then
    echo "$declared"
    return 0
  fi

  local legacy
  legacy=$(jq -c --arg name "$ruleset_name" \
    '.github.rulesets.addRequiredChecks[$name] // []' "$config" 2>/dev/null) || legacy="[]"
  if [[ "$legacy" != "[]" && "$legacy" != "null" ]]; then
    log_warning "github.rulesets.addRequiredChecks is retired — rename it to requiredChecks, which can also STOP requiring a context" >&2
  fi
  echo "$legacy"
}

# True when config states this ruleset's required list, so the live list must
# NOT be unioned back in. That union is what made removal impossible.
ruleset_checks_are_declared() {
  local project_path="$1"
  local ruleset_name="$2"
  local config="$project_path/.lisa.config.json"

  [[ -f "$config" ]] || return 1
  jq -e --arg name "$ruleset_name" \
    '(.github.rulesets.requiredChecks[$name] // null) | type == "array"' \
    "$config" &> /dev/null
}

add_config_required_checks() {
  local json="$1"
  local project_path="$2"
  local ruleset_name="$3"

  local added
  added=$(config_required_checks "$project_path" "$ruleset_name")

  if [[ "$added" == "[]" || "$added" == "null" ]]; then
    echo "$json"
    return 0
  fi

  echo "$json" | jq --argjson added "$added" --argjson actions "$ACTIONS_INTEGRATION_ID" '
    ($added
      | map(select(type == "object" and (.context | type) == "string"))
      | map({ context: .context, integration_id: (.integration_id // $actions) })
    ) as $checks
    | if ($checks | length) == 0 then .
      elif ((.rules // []) | map(select(.type == "required_status_checks")) | length) > 0 then
        .rules |= map(
          if .type == "required_status_checks" then
            .parameters.required_status_checks |= (
              . as $existing
              | . + ($checks | map(
                  select(.context as $c | ($existing | map(.context) | index($c)) | not)
                ))
            )
          else . end
        )
      else
        .rules = ((.rules // []) + [{
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: true,
            required_status_checks: $checks
          }
        }])
      end'
}

preserve_live_required_checks() {
  local live="$1"
  local json="$2"

  if [[ -z "$live" ]]; then
    echo "$json"
    return 0
  fi

  echo "$json" | jq --argjson live "$live" '
    def required_checks:
      (.rules // [])
      | map(select(.type == "required_status_checks"))
      | .[0].parameters.required_status_checks // [];

    ($live | required_checks) as $live_checks
    | if ($live_checks | length) == 0 then .
      elif ((.rules // []) | map(select(.type == "required_status_checks")) | length) > 0 then
        .rules |= map(
          if .type == "required_status_checks" then
            .parameters.required_status_checks |= (
              . as $expected
              | . + ($live_checks | map(
                  select(.context as $c | ($expected | map(.context) | index($c)) | not)
                ))
            )
          else . end
        )
      else
        .rules = ((.rules // []) + [{
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: true,
            required_status_checks: $live_checks
          }
        }])
      end'
}

# The contexts the outgoing payload requires that the live ruleset does not.
# This is the drift a template change opens: a context added to a template never
# reaches an already-configured repository on its own (#2641), so the operator
# needs the reconciliation to SAY which checks it just made blocking rather than
# to report an opaque "applied".
ruleset_added_contexts() {
  local live="$1"
  local payload="$2"

  jq -r -n --argjson live "${live:-null}" --argjson want "$payload" '
    def contexts:
      [ (.rules // [])[]
        | select(.type == "required_status_checks")
        | (.parameters.required_status_checks // [])[]
        | .context ];

    (if $live == null then [] else ($live | contexts) end) as $have
    | ($want | contexts)
    | map(select(. as $context | ($have | index($context)) | not))
    | .[]'
}

# True when everything the payload asks for is ALREADY true of the live ruleset.
#
# Deliberately a subset test rather than an equality test: GitHub echoes back
# parameters it filled in with its own defaults (`required_reviewers`, ...)
# which no template names. Comparing whole documents would report drift on
# every run and make "nothing to do" unreachable — the AC's second scenario
# would then never hold even on a repository that needs no change.
#
# `require_extra_approval_for_unattributed_changes` used to be listed here as
# another such default, and that reading was measured wrong on 2026-08-25. It
# IS filled in when omitted, but the fill is `true` and it is re-applied on
# every write: a rule PUT without the field came back `true` even after being
# explicitly set to `false`. Being invisible to a subset test is therefore not
# harmless for it — an operator who wants it off cannot keep it off, and the
# reconciliation reports no drift while GitHub turns it back on. It is now
# declarable as `policy.review.require_extra_approval_for_unattributed_changes`
# (CodySwannGT/lisa#3096), and once declared the payload names it, so this
# subset test compares it like any other parameter.
ruleset_is_current() {
  local live="$1"
  local payload="$2"

  [[ -n "$live" ]] || return 1

  jq -e -n \
    --argjson live "$(strip_readonly_fields "$live")" \
    --argjson want "$payload" '
    def covers($have; $need):
      if ($need | type) == "object" then
        ($have | type) == "object"
        and ([$need | keys_unsorted[]]
             | all(. as $key | ($have | has($key)) and covers($have[$key]; $need[$key])))
      elif ($need | type) == "array" then
        ($have | type) == "array"
        and ($have | length) == ($need | length)
        and ([range(0; $need | length)]
             | all(. as $index | covers($have[$index]; $need[$index])))
      else $have == $need
      end;
    covers($live; $want)' > /dev/null
}

# The contexts the live ruleset requires that the outgoing payload does not.
# The mirror of ruleset_added_contexts, and it exists because a declarative
# required-check list can now REMOVE a requirement. Losing a protection is the
# more consequential of the two directions, so it is never merely "applied".
ruleset_removed_contexts() {
  local live="$1"
  local payload="$2"

  jq -r -n --argjson live "${live:-null}" --argjson want "$payload" '
    def contexts:
      [ (.rules // [])[]
        | select(.type == "required_status_checks")
        | (.parameters.required_status_checks // [])[]
        | .context ];

    ($want | contexts) as $want_contexts
    | (if $live == null then [] else ($live | contexts) end)
    | map(select(. as $context | ($want_contexts | index($context)) | not))
    | .[]'
}

# Print one line per context this run makes blocking. Reads the payload that
# GitHub actually ACCEPTED, so a context dropped by the integration fallback is
# never reported as added.
report_added_contexts() {
  local live="$1"
  local payload="$2"

  local context
  while IFS= read -r context; do
    [[ -n "$context" ]] && log_info "  + now required: $context"
  done < <(ruleset_added_contexts "$live" "$payload")
}

# Print one line per context this run stops requiring, by name. A declarative
# list that quietly dropped a check would read in the audit log as a routine
# reconciliation, which is exactly how a guarantee disappears without anyone
# deciding to give it up.
report_removed_contexts() {
  local live="$1"
  local payload="$2"

  local context
  while IFS= read -r context; do
    [[ -n "$context" ]] && log_warning "  - no longer required: $context (nothing in .lisa.config.json declares it)"
  done < <(ruleset_removed_contexts "$live" "$payload")
}

apply_ruleset() {
  local repo="$1"
  local template_file="$2"
  local existing_rulesets="$3"
  local project_path="$4"

  local template_content
  template_content=$(cat "$template_file")

  local ruleset_name
  ruleset_name=$(echo "$template_content" | jq -r '.name')

  local clean_template
  clean_template=$(strip_readonly_fields "$template_content")
  clean_template=$(add_config_required_checks "$clean_template" "$project_path" "$ruleset_name")
  clean_template=$(strip_actions_checks_if_no_workflows "$clean_template" "$project_path")
  clean_template=$(strip_config_dropped_checks "$clean_template" "$project_path")

  # A template whose rules were entirely stripped has nothing to enforce here.
  if [[ $(echo "$clean_template" | jq '(.rules // [1]) | length') -eq 0 ]]; then
    log_warning "Skipping ruleset '$ruleset_name' — no applicable rules for this project (no workflows)"
    return 0
  fi

  local existing_id live=""
  existing_id=$(find_ruleset_by_name "$existing_rulesets" "$ruleset_name")
  if [[ -n "$existing_id" ]]; then
    if ! live=$(gh api -X GET "repos/$repo/rulesets/$existing_id" 2>/dev/null); then
      log_warning "Could not read existing ruleset '$ruleset_name' details — refusing to silently replace required checks"
      return 1
    fi
    # Union the live required list back in UNLESS config states it. Preserving
    # it is the right default — the live list carries external app checks
    # nothing declares, and replacing it silently would strip protection. But a
    # project that names a ruleset in `requiredChecks` has said what it wants
    # required there, and honouring the union in that case is precisely what
    # made `addRequiredChecks` unable to remove anything.
    #
    # The generated `base` ruleset gets NO exemption from this. It was tempting:
    # its payload is entirely config-derived, so unioning the live list back in
    # means an await removed from config does not stop being required. But the
    # exemption would make removal unconditional on every run of a script
    # `lisa-github-repo-setup.sh` invokes with `--yes`, so any context required
    # today that no gate awaits and no `requiredChecks.base` names would be
    # deleted with no operator ever opting in. That is the mirror of the rule
    # `lisa-reconcile-policy.mjs` states in its own header — an EXTRA context is
    # reported, never removed without `--prune` — and a protection lost by
    # default reads in the audit log as a routine reconciliation. So `base`
    # becomes declarative the same way every other ruleset does: by being named.
    if ruleset_checks_are_declared "$project_path" "$ruleset_name"; then
      log_verbose "Required checks for '$ruleset_name' are declared in .lisa.config.json — the live list is not preserved"
    else
      clean_template=$(preserve_live_required_checks "$live" "$clean_template")
    fi
  fi

  # Idempotence: a run that would change nothing must say so and send nothing,
  # so a second run is visibly a no-op rather than an indistinguishable write.
  if ruleset_is_current "$live" "$clean_template"; then
    log_success "Ruleset '$ruleset_name' already matches the template — nothing to do"
    UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
    return 0
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    if [[ -n "$existing_id" ]]; then
      log_info "[DRY RUN] Would update ruleset '$ruleset_name' (id: $existing_id)"
    else
      log_info "[DRY RUN] Would create ruleset '$ruleset_name'"
    fi
    report_added_contexts "$live" "$clean_template"
    report_removed_contexts "$live" "$clean_template"
    log_verbose "Template: $template_file"
    return 0
  fi

  if [[ -n "$existing_id" ]]; then
    log_info "Updating ruleset '$ruleset_name' (id: $existing_id)..."
  else
    log_info "Creating ruleset '$ruleset_name'..."
  fi

  APPLIED_PAYLOAD=""
  if apply_with_integration_fallback "$repo" "$ruleset_name" "$clean_template" "$existing_id"; then
    report_added_contexts "$live" "${APPLIED_PAYLOAD:-$clean_template}"
    report_removed_contexts "$live" "${APPLIED_PAYLOAD:-$clean_template}"
    return 0
  fi
  log_error "Failed to apply ruleset '$ruleset_name'"
  return 1
}

# Send the ruleset to GitHub. App-based required checks (CodeRabbit,
# GitGuardian, ...) are rejected with "Invalid integration ids" on repos
# where that app is not installed — and no user-token API can list per-repo
# installations up front. So on that specific error, retry with app-based
# checks progressively removed: first each single app id, then all of them,
# keeping as many checks as the repo actually supports.
apply_with_integration_fallback() {
  local repo="$1"
  local ruleset_name="$2"
  local payload="$3"
  local existing_id="$4"

  local temp_file error_output
  temp_file=$(mktemp)

  # Capture stdout AND stderr — gh prints the API error body (which carries
  # the "Invalid integration ids" detail) on stdout, not stderr.
  send_ruleset() {
    APPLIED_PAYLOAD="$1"
    echo "$1" > "$temp_file"
    if [[ -n "$existing_id" ]]; then
      error_output=$(gh api -X PUT "repos/$repo/rulesets/$existing_id" --input "$temp_file" 2>&1)
    else
      error_output=$(gh api -X POST "repos/$repo/rulesets" --input "$temp_file" 2>&1)
    fi
  }

  if send_ruleset "$payload"; then
    log_success "Applied ruleset '$ruleset_name'"
    rm -f "$temp_file"
    return 0
  fi

  if ! echo "$error_output" | grep -qi "invalid integration ids"; then
    log_error "$error_output"
    rm -f "$temp_file"
    return 1
  fi

  local app_ids
  app_ids=$(echo "$payload" | jq --argjson actions "$ACTIONS_INTEGRATION_ID" \
    '[.rules[]? | select(.type=="required_status_checks") | .parameters.required_status_checks[]?.integration_id | select(. != null and . != $actions)] | unique | .[]')

  local drop_filter='
    .rules |= (
      map(
        if .type == "required_status_checks" then
          .parameters.required_status_checks |= map(select((.integration_id // -1) as $i | ($drop | index($i)) | not))
        else . end
      )
      | map(select(.type != "required_status_checks" or (.parameters.required_status_checks | length) > 0))
    )'

  # Each single app id first (keep the most checks), then all app ids.
  local candidates=()
  local app_id
  for app_id in $app_ids; do
    candidates+=("[$app_id]")
  done
  candidates+=("$(echo "$app_ids" | jq -s -c .)")

  local drop attempt
  for drop in "${candidates[@]}"; do
    attempt=$(echo "$payload" | jq --argjson drop "$drop" --argjson actions "$ACTIONS_INTEGRATION_ID" "$drop_filter")
    if [[ $(echo "$attempt" | jq '(.rules // [1]) | length') -eq 0 ]]; then
      continue
    fi
    if send_ruleset "$attempt"; then
      log_warning "Applied ruleset '$ruleset_name' without app integration id(s) $drop — app(s) not installed on this repository"
      rm -f "$temp_file"
      return 0
    fi
  done

  log_error "$error_output"
  rm -f "$temp_file"
  return 1
}

##############################################################################
# Main Logic
##############################################################################

# Build the `base` ruleset from .lisa.config.json into a temp file.
#
# `all/github-rulesets/base.json` used to be a shipped template here. Seven of
# its fields were already declared in `.lisa.config.json`, so two writers set
# the same settings and the last one won; four more could not be declared at
# all; and it pinned two vendor status checks every repository inherited and
# none could drop. It is now generated, from one declaration, per project.
#
# A failure here is fatal rather than a skip. The alternative is applying every
# OTHER ruleset and reporting success while the repository has no branch
# protection, which is the shape of failure this whole change exists to stop.
generate_base_ruleset() {
  local project_path="$1"
  local generator="$LISA_ROOT/scripts/lisa-ruleset-payload.mjs"
  local out

  if [[ ! -f "$generator" ]]; then
    log_error "Missing $generator — the base ruleset is generated from .lisa.config.json and cannot be applied without it"
    return 1
  fi

  out="$(mktemp)"
  if ! node "$generator" --project="$project_path" > "$out" 2>"$out.err"; then
    log_error "Could not build the base ruleset from .lisa.config.json:"
    log_error "$(cat "$out.err")"
    rm -f "$out" "$out.err"
    return 1
  fi
  rm -f "$out.err"

  # A generator that exits 0 having printed nothing is the failure this guard
  # exists for: the applier would read an empty template, resolve its name to
  # the empty string, skip it as "no applicable rules", and exit 0 having
  # applied no branch protection at all. Measured — a symlinked path made the
  # generator's own entry-point guard false. Never trust the exit code alone.
  if ! jq -e '(.name | type == "string" and length > 0) and ((.rules // []) | length) > 0' "$out" &> /dev/null; then
    log_error "The generated base ruleset is empty or has no name — refusing to continue with no branch protection to apply"
    rm -f "$out"
    return 1
  fi

  echo "$out"
}

collect_templates() {
  local -a types=("$@")
  local -a templates=()

  # Always include 'all' first
  local all_dir="$LISA_ROOT/all/github-rulesets"
  if [[ -d "$all_dir" ]]; then
    for file in "$all_dir"/*.json; do
      [[ -f "$file" ]] && templates+=("$file")
    done
  fi

  # Then add type-specific templates in order
  for type in "${types[@]}"; do
    local type_dir="$LISA_ROOT/$type/github-rulesets"
    if [[ -d "$type_dir" ]]; then
      for file in "$type_dir"/*.json; do
        [[ -f "$file" ]] && templates+=("$file")
      done
    fi
  done

  echo "${templates[@]}"
}

##############################################################################
# Retired Required Contexts
##############################################################################

# Report required contexts that NOTHING WILL EVER POST, across EVERY ruleset the
# repository has — including the ones this script does not manage.
#
# This exists because the rest of the script cannot see the failure. Everything
# above is scoped per MANAGED ruleset name: it makes Lisa's four templates match,
# and it never looks at a ruleset somebody hand-made. #3067 is what that costs.
# 4.x renamed the quality job `🔎 AST Grep Scan` to `🔎 Structural Rules`. A
# repository whose hand-made ruleset still required the old name was left with a
# required check that can never report — and a required check that never reports
# does NOT fail a pull request. GitHub holds it at "Expected — Waiting for status
# to be reported", indefinitely: `mergeable: MERGEABLE`, `mergeStateStatus:
# BLOCKED`, every other check green, no red tick, no log to open, and nothing
# anywhere naming the cause. `--dry-run` on that repository correctly added the
# NEW name to the ruleset it manages and never mentioned the OLD name surviving
# in the one it does not. Running it to completion left the repository blocked.
#
# REPORT ONLY, and deliberately so. Lisa does not own a hand-made ruleset, and
# silently editing somebody else's branch protection is a bigger decision than
# this script carries — it would be Lisa deleting a requirement a human wrote,
# with no record of asking. What this owes the operator is the name and the
# reason, which is precisely what nothing gave them.
#
# The evidence is `previousLabels` in the shipped registry — Lisa's own record
# that Lisa renamed the job, which is why the claim is provable rather than
# inferred. A context that is simply absent from the derived set proves nothing:
# a repository may legitimately require a status posted by a third-party app or
# by a job its own CI defines, and a sweep that flagged every externally
# produced context would be noise an operator learns to ignore.
report_retired_contexts() {
  local repo="$1"
  local rulesets="$2"
  local registry="$LISA_ROOT/all/copy-overwrite/scripts/lisa-gates.mjs"
  local retired

  # An unread retirement list is NOT "no retired contexts". Saying nothing here
  # would report a repository clean on the strength of a read that never
  # happened, which is the same defect one layer up.
  if [[ ! -f "$registry" ]]; then
    log_warning "Could not read $registry — retired required contexts were NOT checked. This is not a clean result."
    return 0
  fi
  if ! retired=$(node "$registry" retired-contexts 2>/dev/null); then
    log_warning "Could not derive the retired-context list — retired required contexts were NOT checked. This is not a clean result."
    return 0
  fi

  # Likewise for the other side of the comparison: zero rulesets read and a
  # repository with nothing required look identical from here.
  local -a ids=()
  if [[ -n "$rulesets" ]]; then
    while IFS= read -r id; do
      [[ -n "$id" ]] && ids+=("$id")
    done < <(echo "$rulesets" | jq -r '.[].id // empty')
  fi
  if [[ ${#ids[@]} -eq 0 ]]; then
    log_warning "No rulesets were readable — retired required contexts were NOT checked. This is not a clean result."
    return 0
  fi

  # The LIST endpoint answers with summaries: id, name, enforcement — and no
  # `rules`. A sweep run over the list would therefore find nothing on every
  # repository, always, and report it as clean. Each ruleset's required checks
  # only exist on its detail payload, so each one is fetched, and a detail this
  # run could not read is stated rather than skipped.
  local details="[]"
  local id detail
  for id in "${ids[@]}"; do
    if ! detail=$(gh api -X GET "repos/$repo/rulesets/$id" 2>/dev/null); then
      log_warning "Ruleset $id could not be read — retired required contexts were NOT checked for it. This is not a clean result."
      continue
    fi
    details=$(jq -c -n --argjson all "$details" --argjson one "$detail" '$all + [$one]')
  done

  local hits
  hits=$(jq -r -n --argjson live "$details" --argjson retired "$retired" '
    ($retired | map({key: .context, value: .}) | from_entries) as $dead
    | [ $live[]
        | .name as $ruleset
        | (.rules // [])[]
        | select(.type == "required_status_checks")
        | (.parameters.required_status_checks // [])[]
        | .context as $context
        | select($dead[$context] != null)
        | "\($ruleset)\t\($context)\t\($dead[$context].replacement)\t\($dead[$context].gate)"
      ] | unique | .[]')

  if [[ -z "$hits" ]]; then
    log_verbose "No ruleset requires a context Lisa retired."
    return 0
  fi

  echo ""
  log_warning "RETIRED REQUIRED CONTEXTS — these can NEVER report, and every pull request in this repository is waiting on them:"
  while IFS=$'\t' read -r ruleset context replacement gate; do
    [[ -n "$context" ]] || continue
    echo "  ruleset '$ruleset' requires: $context"
    echo "    Lisa renamed the '$gate' job; it posts \"$replacement\" now."
    echo "    Not a failing check — GitHub waits on it forever, so there is no red tick and no log."
  done <<< "$hits"
  echo ""
  echo "  Lisa does NOT edit a ruleset it does not manage, so nothing above was changed."
  echo "  A rename is a three-step sequence and only this order is safe at every point:"
  echo "    1. remove the OLD context from every ruleset naming it"
  echo "    2. merge the change that makes the job post the NEW name"
  echo "    3. add the NEW context as required"
  echo "  Doing (3) before (2) creates the same permanent wait in the other direction."
  echo ""
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

  # Build the config-derived base ruleset first, so it is applied before any
  # template and a failure to build it stops the run before anything is written.
  if ! GENERATED_RULESET=$(generate_base_ruleset "$PROJECT_PATH"); then
    exit 1
  fi
  log_verbose "Generated base ruleset from .lisa.config.json"

  # Collect templates
  local templates_str
  templates_str=$(collect_templates "${expanded_types[@]}")

  local -a templates=("$GENERATED_RULESET")
  local -a extra_templates=()
  if [[ -n "$templates_str" ]]; then
    read -ra extra_templates <<< "$templates_str"
    templates+=("${extra_templates[@]}")
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

  # Get existing rulesets — a 403 here means the plan doesn't support rulesets
  # (private repo on a free personal plan); that's a skip, not a failure.
  log_info "Fetching existing rulesets..."
  local existing_rulesets
  if ! existing_rulesets=$(gh api "repos/$repo/rulesets" 2>&1); then
    if echo "$existing_rulesets" | grep -qi "upgrade to github\|HTTP 403"; then
      log_warning "Rulesets are not available on this repository's plan — skipping"
      exit 0
    fi
    log_error "Could not fetch rulesets: $existing_rulesets"
    exit 1
  fi
  local existing_count
  existing_count=$(echo "$existing_rulesets" | jq 'length')
  log_verbose "Found $existing_count existing ruleset(s)"

  # Apply each template
  local success_count=0
  local fail_count=0

  for template in "${templates[@]}"; do
    if apply_ruleset "$repo" "$template" "$existing_rulesets" "$PROJECT_PATH"; then
      success_count=$((success_count + 1))
    else
      fail_count=$((fail_count + 1))
    fi
  done

  # Runs whatever the apply did, dry-run included. The retired name lives in a
  # ruleset the apply above never touched, so an apply that "succeeded" is
  # exactly the run that most needs to say this.
  report_retired_contexts "$repo" "$existing_rulesets"

  echo ""
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "Dry run complete. ${#templates[@]} ruleset(s) would be applied."
  else
    log_success "Applied $((success_count - UNCHANGED_COUNT)) ruleset(s), $UNCHANGED_COUNT already current"
    if [[ $UNCHANGED_COUNT -eq $success_count ]]; then
      log_info "Nothing to do — every ruleset already matches its template"
    fi
    if [[ $fail_count -gt 0 ]]; then
      log_warning "$fail_count ruleset(s) failed"
      exit 1
    fi
  fi
}

main "$@"

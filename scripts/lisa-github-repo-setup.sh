#!/usr/bin/env bash
#
# lisa-github-repo-setup.sh
#
# One-shot GitHub repository governance setup for a Lisa project:
#   1. Repository settings baseline (lisa-github-repo-settings.sh)
#   2. Branch + tag rulesets from Lisa templates (lisa-github-rulesets.sh)
#   3. CI deploy key + DEPLOY_KEY secret (setup-deploy-key.sh --yes),
#      so release workflows can push version bumps through the rulesets'
#      DeployKey bypass.
#   4. Deployment environments with required-reviewer approval gates
#      (lisa-github-environments.sh), from the optional
#      github.environments block in .lisa.config.json.
#
# Usage:
#   lisa-github-repo-setup.sh [options] [project-path]
#
# Options:
#   -n, --dry-run    Show what would be done without making changes
#   -v, --verbose    Show detailed output
#   -h, --help       Show this help message
#
# Requires:
#   - gh CLI (authenticated with repo admin permissions)
#   - jq, ssh-keygen
#

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRY_RUN=false
VERBOSE=false
PROJECT_PATH=""
PASSTHROUGH=()

while [[ $# -gt 0 ]]; do
  case $1 in
    -n|--dry-run) DRY_RUN=true; PASSTHROUGH+=("--dry-run"); shift ;;
    -v|--verbose) VERBOSE=true; PASSTHROUGH+=("--verbose"); shift ;;
    -h|--help) sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) PROJECT_PATH="$1"; shift ;;
  esac
done

PROJECT_PATH="${PROJECT_PATH:-.}"
PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

echo "==> Step 1/4: repository settings"
bash "$SCRIPT_DIR/lisa-github-repo-settings.sh" "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "==> Step 2/4: rulesets"
bash "$SCRIPT_DIR/lisa-github-rulesets.sh" --yes "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "==> Step 3/4: deploy key"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] Would ensure a write-access deploy key + DEPLOY_KEY secret exist"
else
  deploy_output=$(cd "$PROJECT_PATH" && bash "$SCRIPT_DIR/setup-deploy-key.sh" --yes 2>&1)
  deploy_rc=$?
  echo "$deploy_output"
  if [[ $deploy_rc -ne 0 ]]; then
    if echo "$deploy_output" | grep -qi "deploy keys are disabled"; then
      # Org policy, not a repo problem — settings/rulesets still applied.
      echo "⚠ Deploy keys are disabled by organization policy — skipped. Release workflows needing DEPLOY_KEY will not work until an org admin re-enables deploy keys."
    else
      exit $deploy_rc
    fi
  fi
fi

echo ""
echo "==> Step 4/4: deployment environments"
bash "$SCRIPT_DIR/lisa-github-environments.sh" "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "✓ GitHub repository governance setup complete"

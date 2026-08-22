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
#   5. Policy reconciliation (lisa-reconcile-policy.mjs): compares the DECLARED
#      gate and policy configuration against what GitHub actually has, and
#      converges it when policy.on_drift is `repair`.
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
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) PROJECT_PATH="$1"; shift ;;
  esac
done

PROJECT_PATH="${PROJECT_PATH:-.}"
PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

# The reconciler ships as a template AND is installed into host projects. The
# installed copy is preferred so a project pinned to an older Lisa reconciles
# with the script it actually has; the template is the fallback so a repository
# that has not run `lisa apply` yet still gets reconciled. Failing closed when
# NEITHER resolves is the point — a missing script that exits 0 is how a control
# reports success while examining nothing.
resolve_reconciler() {
  local installed="$PROJECT_PATH/scripts/lisa-reconcile-policy.mjs"
  local shipped="$SCRIPT_DIR/../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs"

  if [[ -f "$installed" ]]; then
    echo "$installed"
  elif [[ -f "$shipped" ]]; then
    echo "$shipped"
  else
    return 1
  fi
}

echo "==> Step 1/5: repository settings"
bash "$SCRIPT_DIR/lisa-github-repo-settings.sh" "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "==> Step 2/5: rulesets"
bash "$SCRIPT_DIR/lisa-github-rulesets.sh" --yes "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "==> Step 3/5: deploy key"
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
echo "==> Step 4/5: deployment environments"
bash "$SCRIPT_DIR/lisa-github-environments.sh" "${PASSTHROUGH[@]}" "$PROJECT_PATH"

echo ""
echo "==> Step 5/5: policy reconciliation"
if ! RECONCILER="$(resolve_reconciler)"; then
  echo "✗ Could not find lisa-reconcile-policy.mjs in $PROJECT_PATH/scripts/ or in this Lisa install" >&2
  exit 1
fi

# Not `[[ ... ]] && cmd`: under `set -e` a false test at top level is a failing
# command, so on a non-dry run the script would exit right here.
RECONCILE_ARGS=()
if [[ "$DRY_RUN" == "true" ]]; then
  RECONCILE_ARGS+=("--dry-run")
fi

# Exit 2 is UNPROVEN: `gh` refused, is missing, or answered something
# unparseable. A private repository on a plan without rulesets answers 403, and
# 13 rulesets across the portfolio do exactly that — failing setup for a plan
# limitation punishes a repository that has done nothing wrong. But a blind gate
# has to SAY it is blind, which is why this is a named warning and not silence,
# and why the reconciler keeps 2 as its own code rather than collapsing it into
# either 0 or 1.
set +e
(cd "$PROJECT_PATH" && node "$RECONCILER" "${RECONCILE_ARGS[@]}")
RECONCILE_STATUS=$?
set -e

case "$RECONCILE_STATUS" in
  0) ;;
  2)
    echo "⚠ Policy was NOT checked (UNPROVEN) — see the reason above. Setup continues; nothing about the declared policy has been verified." >&2
    ;;
  *)
    echo "✗ Policy reconciliation failed (exit $RECONCILE_STATUS)" >&2
    exit "$RECONCILE_STATUS"
    ;;
esac

echo ""
echo "✓ GitHub repository governance setup complete"

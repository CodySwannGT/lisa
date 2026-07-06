#!/usr/bin/env bash
# OWASP ZAP Baseline Scan - Harper Fabric app
# Builds the Harper app, starts it locally when no deployed target is supplied,
# and runs a ZAP baseline scan via Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_URL="${ZAP_TARGET_URL:-http://host.docker.internal:9926}"
LOCAL_TARGETS=("http://localhost:9926" "http://host.docker.internal:9926")
SCAN_TARGET_URL="$TARGET_URL"
ZAP_RULES_FILE="${ZAP_RULES_FILE:-.zap/baseline.conf}"
REPORT_FILE="zap-report.html"

cd "$PROJECT_ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is required but not installed."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker daemon is not running."
  exit 1
fi

echo "==> Building Harper Fabric project..."
bun run build

should_start_local=false
for local_target in "${LOCAL_TARGETS[@]}"; do
  if [ "$TARGET_URL" = "$local_target" ]; then
    should_start_local=true
    SCAN_TARGET_URL="http://host.docker.internal:9926"
  fi
done

cleanup() {
  if [ -n "${HARPER_STARTED:-}" ]; then
    echo "==> Stopping Harper..."
    HDB_ROOT="$HDB_ROOT" "$HARPER_BIN" stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$should_start_local" = true ]; then
  if command -v harper >/dev/null 2>&1; then
    HARPER_BIN="harper"
  elif [ -x node_modules/.bin/harper ]; then
    HARPER_BIN="node_modules/.bin/harper"
  elif [ -x node_modules/.bin/harperdb ]; then
    HARPER_BIN="node_modules/.bin/harperdb"
  else
    echo "Error: missing Harper CLI. Set ZAP_TARGET_URL to a deployed app or install the Harper CLI."
    exit 1
  fi

  HDB_ROOT="${HDB_ROOT:-$HOME/.harperdb}"

  # A bare `harper run` neither performs first-run initialization (keys,
  # config) nor registers the app, so nothing ever listens on the scan port.
  # Mirror the starter bootstrap flow instead: non-interactive install,
  # register harper-app as a component, then start the Harper service.
  if [ ! -f "$HDB_ROOT/harperdb-config.yaml" ]; then
    echo "==> Installing HarperDB (non-interactive)..."
    # Env answers every first-run prompt (Terms & Conditions, admin
    # credentials, install destination). HTTP_PORT must stay 9926 to match
    # the scan target URL above.
    TC_AGREEMENT="${TC_AGREEMENT:-yes}" \
    HDB_ROOT="$HDB_ROOT" \
    HDB_ADMIN_USERNAME="${HDB_ADMIN_USERNAME:-admin}" \
    HDB_ADMIN_PASSWORD="${HDB_ADMIN_PASSWORD:-zap-baseline-local}" \
    OPERATIONSAPI_NETWORK_PORT="${OPERATIONSAPI_NETWORK_PORT:-9925}" \
    HTTP_PORT="${HTTP_PORT:-9926}" \
    ANALYTICS_ENABLED="${ANALYTICS_ENABLED:-false}" \
    LOGGING_LEVEL="${LOGGING_LEVEL:-warn}" \
      "$HARPER_BIN" install
  fi

  echo "==> Registering harper-app component..."
  mkdir -p "$HDB_ROOT/components"
  ln -sfn "$PROJECT_ROOT/harper-app" \
    "$HDB_ROOT/components/$(basename "$PROJECT_ROOT")"

  echo "==> Starting Harper..."
  HDB_ROOT="$HDB_ROOT" "$HARPER_BIN" start
  HARPER_STARTED=1

  echo "==> Waiting for Harper app..."
  retries=30
  until curl -sf http://localhost:9926 >/dev/null 2>&1 || [ "$retries" -eq 0 ]; do
    retries=$((retries - 1))
    sleep 2
  done

  if [ "$retries" -eq 0 ]; then
    echo "Error: Harper app did not become reachable at http://localhost:9926"
    exit 1
  fi
fi

echo "==> Running OWASP ZAP baseline scan against $SCAN_TARGET_URL..."
zap_args="-t $SCAN_TARGET_URL"

if [ -f "$ZAP_RULES_FILE" ]; then
  echo "    Using rules file: $ZAP_RULES_FILE"
  rules_abs="$(realpath "$ZAP_RULES_FILE")"
  case "$rules_abs" in
    "$PROJECT_ROOT"/*)
      # The project root is already mounted at /zap/wrk — reference the rules
      # file inside it; a second mount on /zap/wrk collides
      # (docker: Duplicate mount point).
      zap_args="$zap_args -c /zap/wrk/${rules_abs#"$PROJECT_ROOT"/}"
      mount_rules=""
      ;;
    *)
      zap_args="$zap_args -c /zap/rules/$(basename "$rules_abs")"
      mount_rules="-v $(dirname "$rules_abs"):/zap/rules:ro"
      ;;
  esac
else
  mount_rules=""
fi

# The zaproxy image runs as the unprivileged `zap` user (uid 1000); CI
# checkouts are owned by a different uid (e.g. 1001 on GitHub runners), so
# without this the report writes fail with PermissionError and the scan
# aborts with exit 3.
chmod o+w "$(pwd)"

# -I honors .zap/baseline.conf's documented policy: WARN-marked rules are
# reported but do not fail the scan; rules marked FAIL there still fail it.
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)":/zap/wrk/:rw \
  $mount_rules \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py $zap_args \
  -r "$REPORT_FILE" \
  -J zap-report.json \
  -w zap-report.md \
  -I \
  -l WARN || zap_exit=$?

if [ -f "$REPORT_FILE" ]; then
  echo "ZAP report saved to: $REPORT_FILE"
fi

if [ "${zap_exit:-0}" -ne 0 ]; then
  echo "ZAP found FAIL-level findings or errored (exit code: $zap_exit)."
  exit "$zap_exit"
fi

echo "ZAP baseline scan passed."

#!/usr/bin/env bash
# OWASP ZAP Baseline Scan — NestJS GraphQL API
# Builds and starts the NestJS server, then runs a ZAP baseline scan via Docker.
# Outputs an HTML report to zap-report.html in the project root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_URL="${ZAP_TARGET_URL:-http://host.docker.internal:3000/graphql}"
ZAP_RULES_FILE="${ZAP_RULES_FILE:-.zap/baseline.conf}"
REPORT_FILE="zap-report.html"

cd "$PROJECT_ROOT"

# Verify Docker is available
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is required but not installed."
  echo "Install Docker from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker info &> /dev/null 2>&1; then
  echo "Error: Docker daemon is not running."
  exit 1
fi

# Detect package manager
if [ -f "bun.lockb" ]; then
  PKG_MGR="bun"
elif [ -f "yarn.lock" ]; then
  PKG_MGR="yarn"
elif [ -f "pnpm-lock.yaml" ]; then
  PKG_MGR="pnpm"
else
  PKG_MGR="npm"
fi

echo "==> Building NestJS project..."
$PKG_MGR run build

echo "==> Starting NestJS server..."
NODE_ENV=test PORT=3000 $PKG_MGR run start &
SERVER_PID=$!

cleanup() {
  echo "==> Cleaning up..."
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> Waiting for server to be ready..."
RETRIES=30
until curl -sf http://localhost:3000/health > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  RETRIES=$((RETRIES - 1))
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo "Error: Server failed to start within timeout"
  exit 1
fi
echo "    Server is ready"

echo "==> Running OWASP ZAP baseline scan..."
ZAP_ARGS="-t $TARGET_URL"

if [ -f "$ZAP_RULES_FILE" ]; then
  echo "    Using rules file: $ZAP_RULES_FILE"
  ZAP_ARGS="$ZAP_ARGS -c /zap/wrk/$(basename "$ZAP_RULES_FILE")"
  MOUNT_RULES="-v $(dirname "$(realpath "$ZAP_RULES_FILE")"):/zap/wrk:ro"
else
  MOUNT_RULES=""
fi

docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)":/zap/wrk/:rw \
  $MOUNT_RULES \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py $ZAP_ARGS \
  -r "$REPORT_FILE" \
  -J zap-report.json \
  -w zap-report.md \
  -l WARN || ZAP_EXIT=$?

echo ""
if [ -f "$REPORT_FILE" ]; then
  echo "ZAP report saved to: $REPORT_FILE"
fi

if [ "${ZAP_EXIT:-0}" -ne 0 ]; then
  echo "ZAP found medium+ severity findings (exit code: $ZAP_EXIT)"
  echo "Review $REPORT_FILE for details."
  exit "$ZAP_EXIT"
else
  echo "ZAP baseline scan passed — no medium+ severity findings."
fi

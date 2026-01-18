#!/usr/bin/env bash
#
# Lisa - Claude Code governance framework
#
# This script wraps the TypeScript implementation. If Node.js is not available,
# it falls back to the legacy bash implementation.
#

set -euo pipefail

LISA_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check if Node.js is available and the dist directory exists
if command -v node &> /dev/null && [[ -d "$LISA_DIR/dist" ]]; then
    # Run the TypeScript version
    exec node "$LISA_DIR/dist/index.js" "$@"
elif command -v npx &> /dev/null && [[ -f "$LISA_DIR/package.json" ]]; then
    # Try building and running via npm
    echo "[INFO] Building TypeScript version..."
    cd "$LISA_DIR"
    npm run build --silent 2>/dev/null || true
    if [[ -d "$LISA_DIR/dist" ]]; then
        exec node "$LISA_DIR/dist/index.js" "$@"
    fi
fi

# If we get here, TypeScript version is not available
echo "[ERROR] TypeScript version not available."
echo ""
echo "To use Lisa, please ensure Node.js is installed and run:"
echo "  cd $LISA_DIR && npm install && npm run build"
echo ""
echo "Then run Lisa again:"
echo "  $0 $*"
exit 1

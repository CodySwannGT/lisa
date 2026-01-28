#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Hook script to run slow lint rules before pushing
# Blocks push if lint:slow fails, preventing pushes with linting issues
# Reference: https://docs.claude.com/en/docs/claude-code/hooks

# Check if package.json has lint:slow script
if ! grep -q '"lint:slow"' package.json 2>/dev/null; then
    echo "ℹ Skipping lint:slow: lint:slow script not found in package.json"
    exit 0
fi

# Detect package manager based on lock file presence
detect_package_manager() {
    if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
        echo "bun"
    elif [ -f "pnpm-lock.yaml" ]; then
        echo "pnpm"
    elif [ -f "yarn.lock" ]; then
        echo "yarn"
    elif [ -f "package-lock.json" ]; then
        echo "npm"
    else
        echo "npm"  # Default fallback
    fi
}

PKG_MANAGER=$(detect_package_manager)

echo "🐢 Running slow lint rules before push..."

# Run lint:slow - exit code matters here, we want to block the push if it fails
if $PKG_MANAGER run lint:slow; then
    echo "✓ Slow lint rules passed"
    exit 0
else
    echo "✗ Slow lint rules failed. Fix issues and try again." >&2
    exit 1  # Block the push
fi

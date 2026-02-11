#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Only run package installation in remote (Claude Code web) environment
# node_modules are gitignored, so they need to be installed remotely
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Detect package manager based on lock file presence
if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
  bun install
elif [ -f "pnpm-lock.yaml" ]; then
  pnpm install
elif [ -f "yarn.lock" ]; then
  yarn install
elif [ -f "package-lock.json" ]; then
  npm install
else
  npm install
fi

# Install Gitleaks for secret detection (pre-commit hook)
echo "Installing Gitleaks for secret detection..."
GITLEAKS_VERSION="8.18.4"
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C /usr/local/bin gitleaks
echo "Gitleaks installed: $(gitleaks version)"

# Install jira-cli for JIRA integration
echo "Installing jira-cli for JIRA integration..."
JIRA_CLI_VERSION="1.7.0"
curl -sSfL "https://github.com/ankitpokhrel/jira-cli/releases/download/v${JIRA_CLI_VERSION}/jira_${JIRA_CLI_VERSION}_linux_x86_64.tar.gz" | tar -xz -C /usr/local/bin jira
echo "jira-cli installed: $(jira version)"

# Install Chromium for Lighthouse CI (pre-push hook)
# Playwright's bundled Chromium works with @lhci/cli
echo "Installing Chromium for Lighthouse CI..."
npx playwright install chromium

# Find and export CHROME_PATH for Lighthouse CI
# Use sort to ensure deterministic selection of the latest version
CHROME_PATH=$(find ~/.cache/ms-playwright -name "chrome" -type f 2>/dev/null | grep "chrome-linux" | sort | tail -n 1)
if [ -n "$CHROME_PATH" ]; then
  # Append to ~/.bashrc for shell sessions (idempotent)
  if ! grep -q "export CHROME_PATH=" ~/.bashrc 2>/dev/null; then
    echo "export CHROME_PATH=\"$CHROME_PATH\"" >> ~/.bashrc
  else
    # Update existing CHROME_PATH in bashrc
    sed -i "s|^export CHROME_PATH=.*|export CHROME_PATH=\"$CHROME_PATH\"|" ~/.bashrc
  fi

  export CHROME_PATH="$CHROME_PATH"
  echo "Chromium installed at: $CHROME_PATH"
fi

exit 0
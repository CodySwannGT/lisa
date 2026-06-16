#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Only run package installation when node_modules are missing.
# This covers remote environments, new worktrees, fresh clones, and CI.
if [ -d "node_modules" ]; then
  exit 0
fi

# Detect the package manager this project wants, honoring explicit opt-outs.
# Precedence: packageManager field > engines "please-use-<pm>" sentinel >
# lockfile presence (minus any PM the engines forbid) > npm default.
#
# This must NOT key on lockfile presence alone. An npm-only project
# (engines.bun = "please-use-npm", CI runs `npm ci`) that picks up a stray
# bun.lock would otherwise get `bun install`, re-create the bun.lock, and break
# — the SE-5221 regression. The engines/packageManager signals are
# authoritative; lockfiles are only a fallback and never override an opt-out.
detect_package_manager() {
  _field="" _forced="" _forbidden=""
  if [ -f package.json ] && command -v jq >/dev/null 2>&1; then
    _field=$(jq -r '(.packageManager // "") | sub("@.*$";"")' package.json 2>/dev/null)
    _forced=$(jq -r 'first((.engines // {})[] | strings | capture("please-use-(?<pm>bun|npm|yarn|pnpm)")?.pm) // ""' package.json 2>/dev/null)
    _forbidden=$(jq -r '[(.engines // {}) | to_entries[] | select(((.value|strings) // "") | test("please-use|do-not-use";"i")) | .key] | join(" ")' package.json 2>/dev/null)
  fi
  case "$_field" in bun | npm | yarn | pnpm) printf '%s\n' "$_field"; return 0 ;; esac
  case "$_forced" in bun | npm | yarn | pnpm) printf '%s\n' "$_forced"; return 0 ;; esac
  _pm_allowed() { case " $_forbidden " in *" $1 "*) return 1 ;; *) return 0 ;; esac; }
  if { [ -f bun.lockb ] || [ -f bun.lock ]; } && _pm_allowed bun; then printf 'bun\n'; return 0; fi
  if [ -f pnpm-lock.yaml ] && _pm_allowed pnpm; then printf 'pnpm\n'; return 0; fi
  if [ -f yarn.lock ] && _pm_allowed yarn; then printf 'yarn\n'; return 0; fi
  if [ -f package-lock.json ] && _pm_allowed npm; then printf 'npm\n'; return 0; fi
  printf 'npm\n'
}

PACKAGE_MANAGER="$(detect_package_manager)"
echo "Detected package manager: ${PACKAGE_MANAGER}"
case "$PACKAGE_MANAGER" in
  bun) bun install ;;
  pnpm) pnpm install ;;
  yarn) yarn install ;;
  *) npm install ;;
esac

# The tools below use Linux-specific binaries and paths — skip on other platforms.
if [ "$(uname -s)" != "Linux" ]; then
  exit 0
fi

# Install Gitleaks for secret detection (pre-commit hook)
echo "Installing Gitleaks for secret detection..."
GITLEAKS_VERSION="8.18.4"
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C /usr/local/bin gitleaks
echo "Gitleaks installed: $(gitleaks version)"

# Install jira-cli for JIRA integration
# The tarball nests the binary at jira_VERSION_linux_x86_64/bin/jira,
# so we extract to a temp dir and copy the binary out.
echo "Installing jira-cli for JIRA integration..."
JIRA_CLI_VERSION="1.7.0"
JIRA_TMPDIR=$(mktemp -d)
curl -sSfL "https://github.com/ankitpokhrel/jira-cli/releases/download/v${JIRA_CLI_VERSION}/jira_${JIRA_CLI_VERSION}_linux_x86_64.tar.gz" \
  | tar -xz -C "${JIRA_TMPDIR}"
cp "${JIRA_TMPDIR}/jira_${JIRA_CLI_VERSION}_linux_x86_64/bin/jira" /usr/local/bin/jira
chmod +x /usr/local/bin/jira
rm -rf "${JIRA_TMPDIR}"
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
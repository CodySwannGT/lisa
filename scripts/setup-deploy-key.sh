#!/usr/bin/env bash
#
# Setup GitHub Deploy Key for CI/CD
#
# This script creates an SSH key pair and configures it as a deploy key
# with write access, enabling GitHub Actions to push to protected branches.
#
# Usage:
#   ./scripts/setup-deploy-key.sh [--yes]
#
# Options:
#   -y, --yes    Non-interactive mode: skips if a deploy key + DEPLOY_KEY
#                secret already exist, otherwise creates both without
#                prompting and never leaves key files on disk.
#
# Requirements:
#   - ssh-keygen (usually pre-installed)
#   - gh CLI (optional, for automatic setup; required for --yes)
#

set -euo pipefail

YES_MODE=false
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES_MODE=true ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
  echo -e "${BLUE}==>${NC} $1"
}

print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}!${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  print_error "Not in a git repository. Please run from your project root."
  exit 1
fi

# Get repository info
REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [[ -z "$REPO_URL" ]]; then
  print_error "No git remote 'origin' found."
  exit 1
fi

# Extract owner/repo from URL
if [[ "$REPO_URL" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
else
  print_error "Could not parse GitHub repository from remote URL: $REPO_URL"
  exit 1
fi

echo ""
echo "=============================================="
echo "  GitHub Deploy Key Setup"
echo "=============================================="
echo ""
echo "Repository: $OWNER/$REPO"
echo ""

# Non-interactive mode: idempotent — skip when already configured, and keep
# generated key material in a private temp dir that is always cleaned up.
KEY_TITLE="GitHub Actions Deploy Key"
if [[ "$YES_MODE" == "true" ]]; then
  if ! command -v gh &>/dev/null || ! gh auth status &>/dev/null; then
    print_error "--yes mode requires an authenticated gh CLI."
    exit 1
  fi

  HAS_KEY=$(gh repo deploy-key list --repo "$OWNER/$REPO" --json title \
    --jq --arg t "$KEY_TITLE" '[.[] | select(.title == $t)] | length' 2>/dev/null || echo 0)
  HAS_SECRET=$(gh secret list --repo "$OWNER/$REPO" --json name \
    --jq '[.[] | select(.name == "DEPLOY_KEY")] | length' 2>/dev/null || echo 0)
  if [[ "$HAS_KEY" -gt 0 && "$HAS_SECRET" -gt 0 ]]; then
    print_success "Deploy key and DEPLOY_KEY secret already configured — nothing to do."
    exit 0
  fi

  TEMP_KEY_DIR=$(mktemp -d)
  trap 'rm -rf "$TEMP_KEY_DIR"' EXIT
  KEY_FILE="$TEMP_KEY_DIR/deploy_key"

  print_step "Generating SSH key pair..."
  ssh-keygen -t ed25519 -C "github-actions-deploy-key-${REPO}" -f "$KEY_FILE" -N "" -q

  # A stale key under the same title blocks re-adding; replace it.
  if [[ "$HAS_KEY" -gt 0 ]]; then
    gh repo deploy-key list --repo "$OWNER/$REPO" --json id,title \
      --jq --arg t "$KEY_TITLE" '.[] | select(.title == $t) | .id' 2>/dev/null \
      | while read -r key_id; do
          gh repo deploy-key delete "$key_id" --repo "$OWNER/$REPO" || true
        done
  fi

  print_step "Adding deploy key to repository..."
  gh repo deploy-key add "${KEY_FILE}.pub" --repo "$OWNER/$REPO" \
    --title "$KEY_TITLE" --allow-write
  print_success "Deploy key added with write access"

  print_step "Adding DEPLOY_KEY secret..."
  gh secret set DEPLOY_KEY --repo "$OWNER/$REPO" < "$KEY_FILE"
  print_success "DEPLOY_KEY secret added"

  print_success "Deploy key setup complete!"
  exit 0
fi

# Check for existing key
KEY_FILE="deploy_key"
if [[ -f "$KEY_FILE" ]] || [[ -f "${KEY_FILE}.pub" ]]; then
  print_warning "Deploy key files already exist in current directory."
  read -p "Overwrite? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  rm -f "$KEY_FILE" "${KEY_FILE}.pub"
fi

# Generate SSH key
print_step "Generating SSH key pair..."
ssh-keygen -t ed25519 -C "github-actions-deploy-key-${REPO}" -f "$KEY_FILE" -N "" -q
print_success "Generated $KEY_FILE and ${KEY_FILE}.pub"

# Check if gh CLI is available and authenticated
GH_AVAILABLE=false
if command -v gh &>/dev/null; then
  if gh auth status &>/dev/null; then
    GH_AVAILABLE=true
  fi
fi

if $GH_AVAILABLE; then
  echo ""
  print_step "GitHub CLI detected. Attempting automatic setup..."
  echo ""

  # Add deploy key with write access
  print_step "Adding deploy key to repository..."
  if gh repo deploy-key add "${KEY_FILE}.pub" \
    --repo "$OWNER/$REPO" \
    --title "GitHub Actions Deploy Key" \
    --allow-write 2>/dev/null; then
    print_success "Deploy key added with write access"
  else
    print_warning "Could not add deploy key automatically."
    print_warning "You may not have admin permissions, or the key already exists."
    echo ""
    echo "Manual step required:"
    echo "  1. Go to: https://github.com/$OWNER/$REPO/settings/keys"
    echo "  2. Click 'Add deploy key'"
    echo "  3. Title: GitHub Actions Deploy Key"
    echo "  4. Key: (contents of ${KEY_FILE}.pub)"
    echo "  5. Check 'Allow write access'"
    echo ""
  fi

  # Add secret
  print_step "Adding DEPLOY_KEY secret..."
  if gh secret set DEPLOY_KEY --repo "$OWNER/$REPO" < "$KEY_FILE" 2>/dev/null; then
    print_success "DEPLOY_KEY secret added"
  else
    print_warning "Could not add secret automatically."
    echo ""
    echo "Manual step required:"
    echo "  1. Go to: https://github.com/$OWNER/$REPO/settings/secrets/actions"
    echo "  2. Click 'New repository secret'"
    echo "  3. Name: DEPLOY_KEY"
    echo "  4. Value: (entire contents of $KEY_FILE file)"
    echo ""
  fi

else
  echo ""
  print_warning "GitHub CLI not found or not authenticated."
  print_warning "Please complete setup manually:"
  echo ""
  echo "1. Add the PUBLIC key as a Deploy Key:"
  echo "   - Go to: https://github.com/$OWNER/$REPO/settings/keys"
  echo "   - Click 'Add deploy key'"
  echo "   - Title: GitHub Actions Deploy Key"
  echo "   - Key: (copy from below)"
  echo "   - Check 'Allow write access'"
  echo "   - Click 'Add key'"
  echo ""
  echo "   Public key contents:"
  echo "   ─────────────────────────────────────────"
  cat "${KEY_FILE}.pub"
  echo "   ─────────────────────────────────────────"
  echo ""
  echo "2. Add the PRIVATE key as a Repository Secret:"
  echo "   - Go to: https://github.com/$OWNER/$REPO/settings/secrets/actions"
  echo "   - Click 'New repository secret'"
  echo "   - Name: DEPLOY_KEY"
  echo "   - Value: (entire contents of $KEY_FILE file, including BEGIN/END lines)"
  echo "   - Click 'Add secret'"
  echo ""
  echo "   To copy the private key:"
  echo "   cat $KEY_FILE | pbcopy  # macOS"
  echo "   cat $KEY_FILE | xclip   # Linux"
  echo ""
fi

# Cleanup prompt
echo ""
echo "=============================================="
echo "  Cleanup"
echo "=============================================="
echo ""
print_warning "The key files contain sensitive data!"
echo ""
read -p "Delete local key files now? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  rm -f "$KEY_FILE" "${KEY_FILE}.pub"
  print_success "Deleted $KEY_FILE and ${KEY_FILE}.pub"
else
  print_warning "Key files kept. Remember to delete them after setup!"
  echo "  rm $KEY_FILE ${KEY_FILE}.pub"
fi

echo ""
print_success "Deploy key setup complete!"
echo ""
echo "Your GitHub Actions workflows can now push to protected branches."
echo ""

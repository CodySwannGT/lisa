#!/usr/bin/env bash
# Fails if the generated plugin directories (plugins/lisa, plugins/lisa-*) are
# out of sync with their source (plugins/src). This guards against editing the
# build artifact directly: build-plugins.sh runs `rm -rf plugins/lisa && cp -r
# plugins/src/base`, so any artifact-only edit is silently discarded on the next
# build/release. Two real PRs (#471, #478) were wiped this way before this check
# existed.
#
# The check is a reproducibility test: regenerate the artifacts from source and
# assert the working tree is unchanged. A diff means either (a) someone edited
# plugins/lisa** directly instead of plugins/src**, or (b) someone edited
# plugins/src** but forgot to run `bun run build:plugins` and commit the result.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [ -n "$(git status --porcelain -- plugins/ 2>/dev/null)" ]; then
  echo "✗ plugins/ has uncommitted changes before the sync check could run." >&2
  echo "  Commit or stash them, then re-run: bun run check:plugins" >&2
  exit 1
fi

bun run build:plugins >/dev/null

if ! git diff --quiet -- plugins/; then
  echo "✗ Generated plugin artifacts are out of sync with plugins/src." >&2
  echo "" >&2
  echo "  Files that changed after rebuilding from source:" >&2
  git --no-pager diff --name-only -- plugins/ | sed 's/^/    /' >&2
  echo "" >&2
  echo "  plugins/lisa and plugins/lisa-* are GENERATED from plugins/src by" >&2
  echo "  'bun run build:plugins'. Never edit them directly — the next build" >&2
  echo "  overwrites the change." >&2
  echo "" >&2
  echo "  Fix:" >&2
  echo "    1. Make your edit under plugins/src/<base|stack|standalone (e.g. wiki)>/..." >&2
  echo "    2. Run: bun run build:plugins" >&2
  echo "    3. Commit both plugins/src and the regenerated plugins/lisa*." >&2
  # Leave the tree dirty so the diff is inspectable locally; CI fails on exit.
  exit 1
fi

echo "✓ Plugin artifacts are in sync with plugins/src."

# Marketplace coverage: every built plugin directory (plugins/lisa, plugins/lisa-*)
# must be registered in .claude-plugin/marketplace.json, and every marketplace
# entry must point at a directory that exists. The reproducibility check above
# only proves artifacts match plugins/src — it does NOT prove a built plugin is
# actually published. lisa-harper-fabric shipped built-but-unpublished for
# exactly this reason: install-claude-plugins.sh tried "lisa-harper-fabric@lisa"
# but the marketplace never advertised it, so resolution failed at install time.
MARKETPLACE="$ROOT_DIR/.claude-plugin/marketplace.json"
marketplace_fail=0

# Every built plugin dir needs a marketplace entry whose source points to it.
while IFS= read -r dir; do
  name="$(basename "$dir")"
  if ! jq -e --arg src "./plugins/$name" '.plugins[] | select(.source == $src)' "$MARKETPLACE" >/dev/null; then
    echo "✗ Built plugin plugins/$name is not registered in .claude-plugin/marketplace.json (expected source \"./plugins/$name\")." >&2
    marketplace_fail=1
  fi
done < <(find "$ROOT_DIR/plugins" -maxdepth 1 -mindepth 1 -type d ! -name src | sort)

# Every marketplace entry must point at a directory that exists.
while IFS= read -r src; do
  if [ ! -d "$ROOT_DIR/$src" ]; then
    echo "✗ marketplace.json entry source \"$src\" does not exist as a built plugin directory." >&2
    marketplace_fail=1
  fi
done < <(jq -r '.plugins[].source' "$MARKETPLACE")

if [ "$marketplace_fail" -ne 0 ]; then
  echo "" >&2
  echo "  Every plugins/lisa* directory must be registered in .claude-plugin/marketplace.json" >&2
  echo "  and every marketplace source must point to a real built directory. Edit the manifest" >&2
  echo "  at .claude-plugin/marketplace.json, then re-run: bun run check:plugins" >&2
  exit 1
fi

echo "✓ Marketplace registers every built plugin."

#!/usr/bin/env bash
#
# Remote environment entrypoint. Installed by /lisa:setup:remote-env; the remote
# environment's setup AND maintenance fields both call this exact path.
#
# They are the same script on purpose. A container may be built fresh or resumed
# from cache, and everything below is idempotent and version-aware — so running
# it twice is correct, and running it on resume is what picks up a rotated
# value, an edited note, or a changed version pin.
#
# This file is deliberately thin. It resolves an interpreter and hands off; the
# reviewed, tested, versioned logic lives in the Lisa skill rather than here,
# and emphatically not in a vendor settings field.
set -euo pipefail

# Claude Code web runs the environment setup field from $HOME, while the
# checkout lives at $HOME/<repo>. If this installed copy is invoked by absolute
# path, move back to the repository root before resolving project-local files.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "$script_dir" in
  */scripts/lisa-remote-env)
    cd "$script_dir/../.."
    ;;
esac

# Node is the one thing that cannot be installed by the installer, since the
# installer is written in it. Checked before the dependency install rather than
# after: every package manager below is itself a node program, so a missing node
# would otherwise surface as that manager failing under `set -e`, and the script
# would exit on a confusing error instead of this actionable one.
if ! command -v node >/dev/null 2>&1; then
  echo "node is required to prepare this environment but is not present." >&2
  echo "It cannot be installed by the toolchain step, because that step runs" >&2
  echo "on node. Pin a base image that provides it." >&2
  exit 1
fi

# Install the project's dependencies, unless the caller already did.
#
# This lives here rather than in the vendor's settings field so that field can
# be one identical line for every project. Naming the package manager there
# meant a Claude environment for an npm project and one for a bun project
# differed by a string a human had to get right, in a box with no review, no
# version history, and no test.
#
# Which manager is decided by the lockfile that is actually committed, never
# guessed: a guessed one fails on the container's first command with an error
# blaming the project rather than the guess.
#
# A directory's presence says nothing about which lockfile produced it. Remote
# vendors cache containers across commits, so node_modules can exist while
# carrying the previous Lisa release or an otherwise stale dependency graph.
# Persist the reconciled lockfile signature inside node_modules instead: a
# matching signature is the cheap resume path, and a changed or missing one
# earns one frozen reinstall.
lock_file=""
install_cmd=""
if [ -f bun.lock ]; then lock_file="bun.lock"; install_cmd="bun install"
elif [ -f bun.lockb ]; then lock_file="bun.lockb"; install_cmd="bun install"
elif [ -f pnpm-lock.yaml ]; then lock_file="pnpm-lock.yaml"; install_cmd="pnpm install --frozen-lockfile"
elif [ -f yarn.lock ]; then
  lock_file="yarn.lock"
  # Yarn Classic and Berry spell the same intent differently, and each rejects
  # the other's flag. The lockfile itself says which is in use: Yarn 1 writes a
  # "# yarn lockfile v1" header, Berry does not.
  if head -5 yarn.lock | grep -q "yarn lockfile v1"; then
    install_cmd="yarn install --frozen-lockfile"
  else
    install_cmd="yarn install --immutable"
  fi
elif [ -f package-lock.json ]; then lock_file="package-lock.json"; install_cmd="npm ci"
fi

if [ -n "$install_cmd" ]; then
  lock_digest=$(node -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = process.argv[1];
    process.stdout.write(
      crypto.createHash("sha256").update(path).update("\0").update(fs.readFileSync(path)).digest("hex")
    );
  ' "$lock_file") || {
    echo "Could not fingerprint $lock_file; refusing to trust cached dependencies." >&2
    exit 1
  }
  lock_signature="$lock_file:$lock_digest"
  lock_marker="node_modules/.lisa-lockfile.sha256"
  cached_lock_signature=""
  if [ -f "$lock_marker" ]; then
    IFS= read -r cached_lock_signature < "$lock_marker" || true
  fi

  if [ ! -d node_modules ] || [ "$cached_lock_signature" != "$lock_signature" ]; then
    echo "Installing dependencies with: $install_cmd"
    # CI=1 so lifecycle scripts take their automation path and leave the
    # checkout alone. A remote-env setup is automation by definition, and a
    # postinstall that rewrites tracked files here breaks any skill with a
    # clean-checkout precondition — which the publishing skills have, because
    # their diff is contractually bounded and merged without human review.
    #
    # Lisa's own postinstall already guards on exactly this variable, so this
    # is an existing convention rather than a new one.
    #
    # NOT --ignore-scripts: that would also stop patch-package, so a project
    # relying on patched dependencies would silently get unpatched ones — a
    # quieter failure than the one being fixed.
    #
    # Without it the bug is cache-dependent, not deterministic: a fresh
    # container installs and dirties the tree, a resumed one skips the install
    # and succeeds. That reads as flakiness rather than a cause.
    # LISA_SKIP_INSTALL suppresses the INSTALL, not the decision. It used to
    # gate the whole block, so the only way to observe which package manager
    # was chosen was to actually run it — which is why a test asserting the
    # choice ran `yarn install` against a fabricated lockfile, passing on a
    # machine without yarn and doing a real network install on one with it.
    #
    # Reporting the choice and skipping the work is also the more useful
    # behaviour for a caller that installed already: it still says what it
    # would have done.
    if [ "${LISA_SKIP_INSTALL:-}" = "1" ]; then
      echo "  LISA_SKIP_INSTALL=1 — not running it."
    else
      CI=1 $install_cmd
      # npm ci replaces node_modules, while the other managers may update it in
      # place. Write only after a successful install so an interrupted or
      # explicitly skipped reconciliation never blesses a stale cache.
      mkdir -p node_modules
      printf '%s\n' "$lock_signature" > "$lock_marker"
    fi
  fi
elif [ ! -d node_modules ]; then
  # Not fatal on its own. A project may carry no lockfile and still have the
  # skill in a checkout directory, so let the resolver below decide.
  echo "No lockfile found; skipping dependency install." >&2
fi

# Where the skill lives depends on how this project's harness receives it, and
# the two delivery models differ in a way that matters here.
#
# OpenCode and Antigravity get skills written INTO the checkout by `lisa apply`,
# so a clone already carries them. Claude and Codex receive them as an installed
# plugin, which lives in the user's home directory and is emphatically NOT part
# of a clone. A fresh remote container is the second case every time: it clones
# the repository and has never run a plugin install.
#
# So the agent directories are searched first — they are the cheapest hit and
# need nothing installed — and the npm package is the fallback that makes the
# plugin-delivered harnesses work at all. Lisa is a dependency of every project
# it is applied to, so `node_modules` carries the same skill at the version that
# project pins, which is the version its setup should run.
#
# `plugins/lisa/skills/` sits between them, and exists for exactly one project:
# Lisa itself. There the checkout IS Lisa, at HEAD, while `node_modules` holds
# whatever version its own lockfile pins — which was four months and a hundred
# skills behind, so this file did not exist there at all and setup aborted
# claiming the skill could not be found. The one place it was is the only place
# that was not searched. It is ahead of node_modules because a checkout that
# builds this skill is newer than any published copy of it, and harmless
# everywhere else because no other project has that directory.
runner=""
for candidate in \
  ".claude/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".agents/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".codex/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  ".opencode/skills/lisa/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  "plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs" \
  "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs"; do
  if [ -f "$candidate" ]; then
    runner="$candidate"
    break
  fi
done

if [ -z "$runner" ]; then
  echo "Cannot find the lisa-setup-remote-env skill." >&2
  echo >&2
  echo "Searched the agent skill directories and node_modules. On a remote" >&2
  echo "container the usual cause is that dependencies have not been installed" >&2
  echo "yet: Claude and Codex receive Lisa skills as an installed plugin, which" >&2
  echo "is not part of a clone, so node_modules is the only copy present." >&2
  echo >&2
  echo "This script installs dependencies itself, so reaching here means the" >&2
  echo "install did not produce the package, or the project has no lockfile" >&2
  echo "identifying its package manager. Check that @codyswann/lisa is a" >&2
  echo "dependency and that a lockfile is committed." >&2
  echo >&2
  echo "If dependencies are installed, run 'lisa apply' so the skills are" >&2
  echo "present, then re-run setup." >&2
  echo >&2
  # The version actually resolved, because "not found" and "found, but too old
  # to contain this skill" read identically above and are fixed differently.
  # The second is what happened on Lisa itself: node_modules held a release
  # from before this skill existed, so every path checked was legitimately
  # absent and the message blamed the install.
  if [ -f node_modules/@codyswann/lisa/package.json ]; then
    echo "For reference, node_modules has @codyswann/lisa version:" >&2
    node -p "require('./node_modules/@codyswann/lisa/package.json').version" >&2 2>/dev/null ||
      echo "  (unreadable)" >&2
    echo "If that predates this skill, the pin is the problem, not the install." >&2
  fi
  exit 1
fi

exec node "$runner" "$@"

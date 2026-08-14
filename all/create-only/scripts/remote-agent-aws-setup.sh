#!/usr/bin/env bash
# Seeded by Lisa on first setup — this file is YOURS.
# Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)

# Installed by Lisa. The authoritative implementation is shipped by the
# lisa-setup-remote-aws skill and the @codyswann/lisa package.

set -euo pipefail

if NPM_ROOT="$(npm root 2>/dev/null)" && [ -n "$NPM_ROOT" ]; then
  LOCAL_LISA_SCRIPT="$NPM_ROOT/@codyswann/lisa/plugins/lisa/scripts/remote-agent-aws-setup.sh"
  # Spelled as a full `if` rather than `[ -x … ] && exec …`. That form is the
  # last command in this block, so when the file is absent its non-zero status
  # is the block's status, and `set -e` exits (1) right here — before the
  # diagnostic below can print. The operator saw a silent failure instead of
  # being told to install the package.
  if [ -x "$LOCAL_LISA_SCRIPT" ]; then
    exec "$LOCAL_LISA_SCRIPT" "$@"
  fi
fi

echo "remote-agent-aws-setup: install @codyswann/lisa before running this setup script" >&2
exit 1

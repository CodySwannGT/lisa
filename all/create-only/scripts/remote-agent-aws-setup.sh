#!/usr/bin/env bash
# Installed by Lisa. The authoritative implementation is shipped by the
# lisa-setup-remote-aws skill and the @codyswann/lisa package.

set -euo pipefail

if NPM_ROOT="$(npm root 2>/dev/null)" && [ -n "$NPM_ROOT" ]; then
  LOCAL_LISA_SCRIPT="$NPM_ROOT/@codyswann/lisa/plugins/lisa/scripts/remote-agent-aws-setup.sh"
  [ -x "$LOCAL_LISA_SCRIPT" ] && exec "$LOCAL_LISA_SCRIPT" "$@"
fi

echo "remote-agent-aws-setup: install @codyswann/lisa before running this setup script" >&2
exit 1

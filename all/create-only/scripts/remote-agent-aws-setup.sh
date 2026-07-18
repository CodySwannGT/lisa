#!/usr/bin/env bash
# Installed by Lisa. The authoritative implementation is shipped by the
# lisa-setup-remote-aws skill and the @codyswann/lisa package.

set -euo pipefail

LOCAL_LISA_SCRIPT="$(npm root 2>/dev/null)/@codyswann/lisa/plugins/lisa/scripts/remote-agent-aws-setup.sh"
[ -x "$LOCAL_LISA_SCRIPT" ] && exec "$LOCAL_LISA_SCRIPT" "$@"

echo "remote-agent-aws-setup: install @codyswann/lisa before running this setup script" >&2
exit 1

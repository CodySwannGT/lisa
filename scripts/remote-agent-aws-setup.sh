#!/usr/bin/env bash
# Package-level convenience wrapper. The implementation is authored upstream
# in plugins/src/base and copied into plugins/lisa by build:plugins.

set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for candidate in \
  "$REPOSITORY_ROOT/plugins/lisa/scripts/remote-agent-aws-setup.sh" \
  "$REPOSITORY_ROOT/plugins/src/base/scripts/remote-agent-aws-setup.sh"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

echo "remote-agent-aws-setup: Lisa plugin script is missing; run bun run build:plugins" >&2
exit 1

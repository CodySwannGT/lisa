#!/usr/bin/env bash
##
# Writes the JIRA CLI config file from environment variables.
# Runs on SessionStart so the config is available for every session.
#
# Required env vars (must be created in your Claude Code Web environment):
#   JIRA_INSTALLATION - cloud or local
#   JIRA_SERVER       - Atlassian instance URL
#   JIRA_LOGIN        - login email
#   JIRA_PROJECT      - default project key
#   JIRA_API_TOKEN    - already expected by jira-cli natively
#
# Optional env vars:
#   JIRA_BOARD        - default board name
##

set -euo pipefail

# Fix jira-cli installation if install-pkgs.sh failed to extract correctly.
# The tarball nests the binary at jira_VERSION_linux_x86_64/bin/jira,
# but install-pkgs.sh expects a top-level "jira" file.
if ! command -v jira &>/dev/null; then
  JIRA_CLI_VERSION="1.7.0"
  TMPDIR=$(mktemp -d)
  curl -sSfL "https://github.com/ankitpokhrel/jira-cli/releases/download/v${JIRA_CLI_VERSION}/jira_${JIRA_CLI_VERSION}_linux_x86_64.tar.gz" \
    | tar -xz -C "${TMPDIR}"
  cp "${TMPDIR}/jira_${JIRA_CLI_VERSION}_linux_x86_64/bin/jira" /usr/local/bin/jira
  chmod +x /usr/local/bin/jira
  rm -rf "${TMPDIR}"
fi

CONFIG_DIR="${HOME}/.config/.jira"
CONFIG_FILE="${CONFIG_DIR}/.config.yml"

# Skip config write if required vars are missing
if [[ -z "${JIRA_SERVER:-}" || -z "${JIRA_LOGIN:-}" ]]; then
  exit 0
fi

mkdir -p "${CONFIG_DIR}"

cat > "${CONFIG_FILE}" << EOF
installation: ${JIRA_INSTALLATION:-cloud}
server: ${JIRA_SERVER}
login: ${JIRA_LOGIN}
project: ${JIRA_PROJECT:-}
board: "${JIRA_BOARD:-}"
auth_type: basic
epic:
  name: Epic Name
  link: Epic Link
EOF

#!/usr/bin/env bash
# Lisa-managed Codex hook script (SessionStart).
# Writes jira-cli configuration from environment variables when available.
set -euo pipefail

if [[ -z "${JIRA_SERVER:-}" || -z "${JIRA_LOGIN:-}" ]]; then
  exit 0
fi

config_dir="${HOME}/.config/.jira"
config_file="${config_dir}/.config.yml"
mkdir -p "$config_dir"

cat > "$config_file" << EOF
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

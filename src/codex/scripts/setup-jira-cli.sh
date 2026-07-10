#!/usr/bin/env bash
# Lisa-managed Codex hook script (SessionStart).
# Writes jira-cli configuration from environment variables when available.
set -euo pipefail

# Drain the hook envelope before any config-dependent early return.
cat >/dev/null 2>&1 || true

read_lisa_config() {
  local query="$1"
  local value=""

  if ! command -v jq &>/dev/null; then
    return 0
  fi

  if [[ -f ".lisa.config.local.json" ]]; then
    value=$(jq -r "${query} // empty" .lisa.config.local.json 2>/dev/null || true)
  fi

  if [[ -z "${value}" && -f ".lisa.config.json" ]]; then
    value=$(jq -r "${query} // empty" .lisa.config.json 2>/dev/null || true)
  fi

  printf '%s' "${value}"
}

if [[ -z "${JIRA_SERVER:-}" ]]; then
  ATLASSIAN_SITE="$(read_lisa_config '.atlassian.site')"
  if [[ -n "${ATLASSIAN_SITE}" ]]; then
    if [[ "${ATLASSIAN_SITE}" == http://* || "${ATLASSIAN_SITE}" == https://* ]]; then
      JIRA_SERVER="${ATLASSIAN_SITE}"
    else
      JIRA_SERVER="https://${ATLASSIAN_SITE}"
    fi
  fi
fi

if [[ -z "${JIRA_PROJECT:-}" ]]; then
  JIRA_PROJECT="$(read_lisa_config '.jira.project')"
fi

if [[ -z "${JIRA_SERVER:-}" || -z "${JIRA_LOGIN:-}" ]]; then
  exit 0
fi

project_dir="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
config_dir="${project_dir}/.lisa/jira-cli"
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

#!/usr/bin/env bash
##
# Writes the JIRA CLI config file from environment variables.
# Runs on SessionStart so the config is available for every session.
#
# Required env vars (must be created in your Claude Code Web environment):
#   JIRA_INSTALLATION - cloud or local
#   JIRA_SERVER       - Atlassian instance URL (falls back to .lisa.config*.json atlassian.site)
#   JIRA_LOGIN        - login email
#   JIRA_PROJECT      - default project key (falls back to .lisa.config*.json jira.project)
#   JIRA_API_TOKEN    - already expected by jira-cli natively
#
# Optional env vars:
#   JIRA_BOARD        - default board name
##

set -euo pipefail

# Fix jira-cli installation if install-pkgs.sh failed to extract correctly.
# Only attempt on Linux — the binary download is Linux-only.
if [[ "$(uname -s)" == "Linux" ]] && ! command -v jira &>/dev/null; then
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

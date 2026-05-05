#!/usr/bin/env bash
# download-attachment.sh — Download a JIRA attachment to a local file.
#
# Usage:
#   bash download-attachment.sh <ATTACHMENT_ID_OR_URL> <OUTPUT_PATH>
#
# Why this helper exists:
#   The Atlassian MCP server (mcp__atlassian__*) returns attachment metadata
#   (id, filename, mimeType, size, content URL) on getJiraIssue but provides
#   no tool to fetch the binary content. This script closes the gap by
#   hitting the Jira REST API directly with Basic auth, mirroring the
#   env-var contract already used by jira-evidence/scripts/post-evidence.sh.
#
#   See https://jira.atlassian.com/browse/JRACLOUD-97830 for the upstream
#   gap; remove this helper once Atlassian ships a download tool in the MCP.
#
# Required env vars:
#   JIRA_SERVER     - https://<your-tenant>.atlassian.net
#   JIRA_LOGIN      - login email
#   JIRA_API_TOKEN  - API token (https://id.atlassian.com/manage-profile/security/api-tokens)
#
# Exit codes:
#   0  success
#   1  download failed (HTTP error)
#   2  missing required env var
#   3  invalid arguments

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: download-attachment.sh <ATTACHMENT_ID_OR_URL> <OUTPUT_PATH>" >&2
  exit 3
fi
ID_OR_URL="$1"
OUTPUT_PATH="$2"

# Resolve credentials: prefer env, fall back to jira-cli config for server/login.
JIRA_CONFIG="${HOME}/.config/.jira/.config.yml"
if [[ -z "${JIRA_SERVER:-}" && -f "$JIRA_CONFIG" ]]; then
  JIRA_SERVER=$(grep '^server:' "$JIRA_CONFIG" | awk '{print $2}')
fi
if [[ -z "${JIRA_LOGIN:-}" && -f "$JIRA_CONFIG" ]]; then
  JIRA_LOGIN=$(grep '^login:' "$JIRA_CONFIG" | awk '{print $2}')
fi

for VAR in JIRA_SERVER JIRA_LOGIN JIRA_API_TOKEN; do
  if [[ -z "${!VAR:-}" ]]; then
    echo "ERROR: $VAR is not set." >&2
    echo "Required env vars: JIRA_SERVER, JIRA_LOGIN, JIRA_API_TOKEN." >&2
    echo "Generate an API token: https://id.atlassian.com/manage-profile/security/api-tokens" >&2
    exit 2
  fi
done

OUTPUT_DIR=$(dirname "$OUTPUT_PATH")
if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "ERROR: Output directory does not exist: $OUTPUT_DIR" >&2
  exit 3
fi

if [[ "$ID_OR_URL" == http*://* ]]; then
  ATTACHMENT_URL="$ID_OR_URL"
else
  ATTACHMENT_URL="${JIRA_SERVER%/}/rest/api/3/attachment/content/$ID_OR_URL"
fi

JIRA_AUTH=$(printf '%s' "$JIRA_LOGIN:$JIRA_API_TOKEN" | base64 | tr -d '\n')

# Atlassian responds 302 to a signed URL on media.atlassian.com that has its
# own auth and rejects Basic. Two-step: capture Location, then GET unauthed.
HEADERS_FILE=$(mktemp)
trap 'rm -f "$HEADERS_FILE"' EXIT

HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  --max-redirs 0 \
  -D "$HEADERS_FILE" \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Accept: */*" \
  "$ATTACHMENT_URL" || true)

case "$HTTP_CODE" in
  302|303|307)
    SIGNED_URL=$(awk 'BEGIN{IGNORECASE=1} /^location:/{sub(/^[Ll]ocation:[ \t]*/,""); sub(/\r$/,""); print; exit}' "$HEADERS_FILE")
    if [[ -z "$SIGNED_URL" ]]; then
      echo "ERROR: Got HTTP $HTTP_CODE but no Location header in response." >&2
      exit 1
    fi
    curl -sSf -o "$OUTPUT_PATH" "$SIGNED_URL"
    ;;
  200)
    curl -sSf -o "$OUTPUT_PATH" \
      -H "Authorization: Basic $JIRA_AUTH" \
      -H "Accept: */*" \
      "$ATTACHMENT_URL"
    ;;
  401|403)
    echo "ERROR: Authentication failed (HTTP $HTTP_CODE). Verify JIRA_LOGIN and JIRA_API_TOKEN." >&2
    exit 1
    ;;
  404)
    echo "ERROR: Attachment not found at $ATTACHMENT_URL (HTTP 404). Verify the ID and your access." >&2
    exit 1
    ;;
  *)
    echo "ERROR: Unexpected HTTP $HTTP_CODE from $ATTACHMENT_URL" >&2
    exit 1
    ;;
esac

echo "  ✓ Downloaded -> $OUTPUT_PATH"

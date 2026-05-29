#!/usr/bin/env bash
# post-evidence.sh — Upload evidence and post to JIRA + GitHub PR description
#
# Usage:
#   bash post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>
#
# Prerequisites:
#   - JIRA_API_TOKEN env var set
#   - jira-cli configured (~/.config/.jira/.config.yml)
#   - gh CLI authenticated
#
# What it does:
#   1. Uploads evidence files to the 'pr-assets' GitHub release
#   2. Updates the GitHub PR description with evidence/comment.md
#   3. Uploads image evidence as JIRA attachments
#   4. Posts/updates the JIRA comment with evidence/comment.txt
#   5. Moves the JIRA ticket to "Code Review"

set -euo pipefail

TICKET_ID="${1:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"
EVIDENCE_DIR="${2:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"
PR_NUMBER="${3:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"

JIRA_CONFIG="${HOME}/.config/.jira/.config.yml"
if [[ ! -f "$JIRA_CONFIG" ]]; then
  echo "ERROR: jira-cli config not found at $JIRA_CONFIG — run 'jira init' first" >&2
  exit 1
fi
JIRA_SERVER=$(grep '^server:' "$JIRA_CONFIG" | awk '{print $2}')
JIRA_USER=$(grep '^login:' "$JIRA_CONFIG" | awk '{print $2}')
GH_REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
RELEASE_TAG="pr-assets"

if [[ -z "${JIRA_API_TOKEN:-}" ]]; then
  echo "ERROR: JIRA_API_TOKEN environment variable is not set" >&2
  exit 1
fi

# Collect numbered evidence files (images + text)
SCREENSHOTS=()
while IFS= read -r -d '' f; do
  SCREENSHOTS+=("$f")
done < <(find "$EVIDENCE_DIR" -maxdepth 1 -name '[0-9][0-9]-*.png' -print0 | sort -z)

TEXT_EVIDENCE=()
while IFS= read -r -d '' f; do
  TEXT_EVIDENCE+=("$f")
done < <(find "$EVIDENCE_DIR" -maxdepth 1 \( -name '[0-9][0-9]-*.txt' -o -name '[0-9][0-9]-*.json' \) ! -name 'comment.txt' -print0 | sort -z)

ALL_EVIDENCE=("${SCREENSHOTS[@]}" "${TEXT_EVIDENCE[@]}")

if [[ ${#ALL_EVIDENCE[@]} -eq 0 ]]; then
  echo "ERROR: No numbered evidence files found in $EVIDENCE_DIR (expected NN-*.png, NN-*.txt, or NN-*.json)" >&2
  exit 1
fi

echo "Found ${#SCREENSHOTS[@]} screenshots and ${#TEXT_EVIDENCE[@]} text evidence files to upload"

# Compute JIRA auth early (used in steps 3 and 4)
JIRA_AUTH=$(echo -n "$JIRA_USER:$JIRA_API_TOKEN" | base64)

# ── Step 1: Upload to GitHub pr-assets release ──────────────────────────────
echo ""
echo "==> Uploading to GitHub release '$RELEASE_TAG'..."

for FILE in "${ALL_EVIDENCE[@]}"; do
  FILENAME=$(basename "$FILE")
  echo "  ↑ $FILENAME"
  gh release upload "$RELEASE_TAG" "$FILE" --repo "$GH_REPO" --clobber
done

echo "  ✓ GitHub release assets uploaded"

# ── Step 2: Update GitHub PR description with evidence ──────────────────────
COMMENT_MD="$EVIDENCE_DIR/comment.md"
if [[ ! -f "$COMMENT_MD" ]]; then
  echo "ERROR: $COMMENT_MD not found — run generate-templates.py first" >&2
  exit 1
fi

echo ""
echo "==> Updating GitHub PR #$PR_NUMBER description..."

CURRENT_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body')

# Replace or append the Evidence section
if echo "$CURRENT_BODY" | grep -q "^## Evidence"; then
  # Replace from "## Evidence" to end of file
  NEW_BODY=$(echo "$CURRENT_BODY" | sed '/^## Evidence/,$d')
  EVIDENCE_SECTION=$(cat "$COMMENT_MD")
  UPDATED_BODY="${NEW_BODY}
${EVIDENCE_SECTION}"
else
  EVIDENCE_SECTION=$(cat "$COMMENT_MD")
  UPDATED_BODY="${CURRENT_BODY}

${EVIDENCE_SECTION}"
fi

gh pr edit "$PR_NUMBER" --body "$UPDATED_BODY"
echo "  ✓ PR description updated with evidence"

# ── Step 3: Upload image evidence as JIRA attachments ───────────────────────
if [[ ${#SCREENSHOTS[@]} -gt 0 ]]; then
  echo ""
  echo "==> Uploading image attachments to JIRA $TICKET_ID..."

  for IMG in "${SCREENSHOTS[@]}"; do
    FILENAME=$(basename "$IMG")
    echo "  ↑ $FILENAME"
    RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
      -X POST \
      -H "Authorization: Basic $JIRA_AUTH" \
      -H "X-Atlassian-Token: no-check" \
      -F "file=@$IMG" \
      "$JIRA_SERVER/rest/api/3/issue/$TICKET_ID/attachments")
    HTTP_CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)
    if [[ "$HTTP_CODE" != "200" ]]; then
      echo "  WARNING: Failed to upload $FILENAME (HTTP $HTTP_CODE)" >&2
    fi
  done

  echo "  ✓ JIRA attachments uploaded"
fi

# ── Step 4: Post JIRA comment ────────────────────────────────────────────────
COMMENT_TXT="$EVIDENCE_DIR/comment.txt"
if [[ ! -f "$COMMENT_TXT" ]]; then
  echo "ERROR: $COMMENT_TXT not found — run generate-templates.py first" >&2
  exit 1
fi

echo ""
echo "==> Posting JIRA comment on $TICKET_ID..."

COMMENT_BODY=$(cat "$COMMENT_TXT")
COMMENT_JSON=$(python3 -c "import sys, json; print(json.dumps(sys.stdin.read()))" <<< "$COMMENT_BODY")

RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST \
  -H "Authorization: Basic $JIRA_AUTH" \
  -H "Content-Type: application/json" \
  "$JIRA_SERVER/rest/api/2/issue/$TICKET_ID/comment" \
  -d "{\"body\": $COMMENT_JSON}")
HTTP_CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)

if [[ "$HTTP_CODE" == "201" ]]; then
  echo "  ✓ JIRA comment posted"
else
  echo "  WARNING: JIRA comment returned HTTP $HTTP_CODE" >&2
  echo "$RESP" | grep -v "HTTP_CODE:" | head -3
fi

# ── Step 5: Move ticket to Code Review ──────────────────────────────────────
echo ""
echo "==> Moving $TICKET_ID to Code Review..."
jira issue move "$TICKET_ID" "Code Review" 2>&1 && echo "  ✓ Ticket moved to Code Review" || echo "  WARNING: Could not move ticket" >&2

echo ""
echo "==> Done!"
echo "    JIRA:   $JIRA_SERVER/browse/$TICKET_ID"
echo "    GitHub: https://github.com/$GH_REPO/pull/$PR_NUMBER"

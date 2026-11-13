#!/usr/bin/env bash
# post-evidence.sh — Upload evidence and post to JIRA + GitHub PR description
#
# Usage:
#   bash post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>
#
# Prerequisites:
#   - JIRA_API_TOKEN env var set
#   - a jira-cli config, resolved in this order (see "CONFIG RESOLUTION" below):
#       1. ${PROJECT_DIR}/.lisa/jira-cli/.config.yml  (written by the
#          setup-jira-cli SessionStart hook from the JIRA_* environment)
#       2. ~/.config/.jira/.config.yml                (a developer's own
#          `jira init` config; announced on stderr when it is used)
#   - gh CLI authenticated
#
# What it does:
#   1. Uploads evidence files to the configured GitHub evidence release
#      (default 'pr-assets'; see verification.completion.evidenceRelease) as
#      pr-<PR_NUMBER>-<file>, then confirms every one is listed there
#   2. Updates the GitHub PR description with evidence/comment.md
#   3. Uploads image evidence as JIRA attachments
#   4. Posts/updates the JIRA comment with evidence/comment.txt
#   5. Moves the JIRA ticket to the configured jira.workflow.review status
#      (skipped entirely when review is unconfigured — stays in claimed)

set -euo pipefail

TICKET_ID="${1:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"
EVIDENCE_DIR="${2:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"
PR_NUMBER="${3:?Usage: post-evidence.sh <TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>}"

# Every release asset is named pr-${PR_NUMBER}-<file>, so the number must be a
# canonical positive integer before anything is uploaded: an empty, signed or
# padded value would produce a name another pull request could also produce.
if [[ ! "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: PR_NUMBER must be a positive integer, got '$PR_NUMBER'" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG RESOLUTION
#
# The setup-jira-cli SessionStart hook writes ${PROJECT_DIR}/.lisa/jira-cli/
# .config.yml. Nothing read it — this script looked only at the developer's own
# ~/.config/.jira/.config.yml and exited 1 telling the operator to run
# `jira init`, so on a headless JIRA project the hook was an inert control.
# See CodySwannGT/lisa#2767.
#
# PROJECT_DIR is resolved with the same rule as the hook that writes the file,
# deliberately character-for-character: CLAUDE_PROJECT_DIR (the harness's own
# declaration of the root, inert on harnesses that never set it), then the git
# toplevel, then pwd. A session launched from a subdirectory otherwise reads a
# directory it never wrote — the #2768 defect, on the read side.
#
# Nothing here writes to ~/.config/.jira. That file is a developer's personal
# jira-cli state; it is read as a fallback and never created or modified.
#
# NOTE: the `.lisa.config.json` reads in Step 5 below are still resolved from
# the process working directory. That is pre-existing and out of scope here.
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "${PROJECT_DIR}" || ! -d "${PROJECT_DIR}" ]]; then
  PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi
PROJECT_JIRA_CONFIG="${PROJECT_DIR}/.lisa/jira-cli/.config.yml"
HOME_JIRA_CONFIG="${HOME}/.config/.jira/.config.yml"

if [[ -f "$PROJECT_JIRA_CONFIG" ]]; then
  JIRA_CONFIG="$PROJECT_JIRA_CONFIG"
elif [[ -f "$HOME_JIRA_CONFIG" ]]; then
  # Announced, never silent. A silent fall-through to the developer's own file
  # is precisely how the Lisa-written config stayed unconsumed without anyone
  # noticing, and on a headless runner there is no such file to fall back to.
  echo "NOTE: no Lisa-written jira-cli config at $PROJECT_JIRA_CONFIG" >&2
  echo "      falling back to the developer config at $HOME_JIRA_CONFIG" >&2
  JIRA_CONFIG="$HOME_JIRA_CONFIG"
else
  echo "ERROR: jira-cli config not found." >&2
  echo "  Lisa-written config (expected): $PROJECT_JIRA_CONFIG" >&2
  echo "  developer config (fallback):    $HOME_JIRA_CONFIG" >&2
  echo "  Fix: export JIRA_SERVER, JIRA_LOGIN (and JIRA_INSTALLATION," >&2
  echo "  JIRA_PROJECT) and start a new session so the setup-jira-cli hook" >&2
  echo "  writes the project config — or run 'jira init' locally." >&2
  exit 1
fi
JIRA_SERVER=$(sed -n 's/^server:[[:space:]]*//p' "$JIRA_CONFIG")
JIRA_USER=$(grep '^login:' "$JIRA_CONFIG" | awk '{print $2}')
# Validate before constructing credentials; use only the approved HTTPS origin.
JIRA_SERVER=$(python3 - "$JIRA_SERVER" <<'PY_ORIGIN'
import ipaddress
import re
import sys
from urllib.parse import urlsplit

raw = sys.argv[1]
try:
    if not raw or any(c <= " " or c >= "\x7f" for c in raw):
        raise ValueError()
    url = urlsplit(raw)
    if (url.scheme != "https" or "@" in url.netloc or "?" in raw
            or "#" in raw or url.path not in ("", "/") or not url.hostname):
        raise ValueError()
    host = url.hostname
    if url.netloc.startswith("["):
        host = f"[{ipaddress.IPv6Address(host).compressed}]"
    elif not re.fullmatch(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*", host):
        raise ValueError()
    port = url.port
    if port == 0:
        raise ValueError()
    suffix = f":{port}" if port is not None and port != 443 else ""
    print(f"https://{host}{suffix}")
except ValueError:
    sys.exit("ERROR: JIRA_SERVER must be a bare HTTPS origin without userinfo, path, query or fragment.")
PY_ORIGIN
)

GH_REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
# The evidence release comes from the one resolver every writer shares, so a
# project's `verification.completion.evidenceRelease` (for example the rotating
# `pr-assets-{YYYY-MM}`) moves this upload too. GitHub caps a release at 1000
# assets; a hardcoded `pr-assets` filled up and every upload then failed with a
# raw HTTP 422 (CodySwannGT/lisa#4692). `--ensure` creates the release when it
# is absent and, when it is nearly full, rolls over to the next overflow
# release (`<release>-2`, `-3`, …) and prints that one (CodySwannGT/lisa#4838).
# It refuses, in plain words, only when a pinned release is full, every
# overflow release is full, the release name is too long to take an overflow
# suffix, or the release cannot be created. generate-templates.py asks the same `--ensure`, so its links
# name the release uploaded here. A host whose Lisa predates the resolver keeps
# the legacy release.
#
# LISA_EVIDENCE_RELEASE, when set, pins the release for this run so the links
# generate-templates.py wrote match these uploads. The resolver still checks
# that name and the release's capacity; it reads the variable itself.
RELEASE_TAG="${LISA_EVIDENCE_RELEASE:-pr-assets}"
WORK_ITEM_CLI="${PROJECT_DIR}/scripts/lisa-work-item.mjs"
if [[ -f "$WORK_ITEM_CLI" ]]; then
  if ! RELEASE_TAG=$(cd "$PROJECT_DIR" && node "$WORK_ITEM_CLI" evidence-release --ensure); then
    echo "ERROR: the GitHub evidence release is not usable (see the message above); no evidence was uploaded." >&2
    exit 1
  fi
fi

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

# Bash 3.2 treats an empty array as unset under nounset.
ALL_EVIDENCE=(${SCREENSHOTS[@]+"${SCREENSHOTS[@]}"} ${TEXT_EVIDENCE[@]+"${TEXT_EVIDENCE[@]}"})

if [[ ${#ALL_EVIDENCE[@]} -eq 0 ]]; then
  echo "ERROR: No numbered evidence files found in $EVIDENCE_DIR (expected NN-*.png, NN-*.txt, or NN-*.json)" >&2
  exit 1
fi

echo "Found ${#SCREENSHOTS[@]} screenshots and ${#TEXT_EVIDENCE[@]} text evidence files to upload"

# GitHub rewrites special characters (spaces, brackets, non-ASCII) in release
# asset names, so a link built from the local name would point at an asset that
# does not exist under that name. Refuse such names before anything is uploaded.
for FILE in "${ALL_EVIDENCE[@]}"; do
  if [[ ! "$(basename "$FILE")" =~ ^[0-9]{2}-[A-Za-z0-9._-]+\.(png|txt|json)$ ]]; then
    echo "ERROR: evidence file name '$(basename "$FILE")' is not release-safe." >&2
    echo "  Rename it to NN-name.ext using only letters, digits, '.', '_' and '-'" >&2
    echo "  (e.g. '01-search step.png' -> '01-search-step.png'), then re-run generate-templates.py." >&2
    exit 1
  fi
done

# The description's links are checked before uploading and again against the
# release after uploading, so it must exist before anything is uploaded.
COMMENT_MD="$EVIDENCE_DIR/comment.md"
if [[ ! -f "$COMMENT_MD" ]]; then
  echo "ERROR: $COMMENT_MD not found — run generate-templates.py first" >&2
  exit 1
fi

# Print every Markdown link or image target in comment.md, one per line. Every
# Markdown target form counts:
#   inline      ](url)  ](url "title")  ](<url>)  ](<url> "title")
#   reference   [ref]: url  [ref]: <url> "title"   (up to 3 leading spaces)
# Only link targets count: text evidence inlined into comment.md may quote a
# release URL as plain text, and that must not fail the run.
comment_links() {
  { grep -oE '\]\(<?[^)<>[:space:]]+' "$COMMENT_MD" || true; } | sed -E 's/^\]\(<?//'
  { grep -oE '^ {0,3}\[[^]]+\]:[[:space:]]*<?[^<>[:space:]]+' "$COMMENT_MD" || true; } |
    sed -E 's/^ {0,3}\[[^]]+\]:[[:space:]]*<?//'
}

# A link to THIS pull request's own pr-${PR_NUMBER}- asset in a different
# release of this repository means the templates were generated against one
# release and this run uploads to another (a roll-over to `<release>-2` in
# between, CodySwannGT/lisa#4838): the link would 404, so refuse it. The check
# runs before anything is uploaded, so a refused run leaves no copies behind in
# a release the operator then re-pins away from (CodySwannGT/lisa#4856).
# Any other cross-release link (another PR's evidence, or an older release's
# asset linked on purpose) passes through untouched: regenerating the
# templates cannot remove a hand-written link, so refusing it would loop.
RELEASE_PREFIX="github.com/${GH_REPO}/releases/download/"
CROSS_RELEASE_LINKS=0
while IFS= read -r LINK; do
  [[ "$LINK" == *"$RELEASE_PREFIX"* ]] || continue
  LINK_TAG="${LINK#*"$RELEASE_PREFIX"}"
  LINK_TAG="${LINK_TAG%%/*}"
  [[ "$LINK_TAG" != "$RELEASE_TAG" ]] || continue
  [[ "${LINK##*/}" == "pr-${PR_NUMBER}-"* ]] || continue
  echo "ERROR: $COMMENT_MD links $LINK in release '$LINK_TAG', but this run uploads to release '$RELEASE_TAG'. Regenerate the templates with LISA_EVIDENCE_RELEASE=$RELEASE_TAG and re-run this script with the same LISA_EVIDENCE_RELEASE=$RELEASE_TAG. If this link was written by hand, remove it or re-upload the asset to '$RELEASE_TAG'." >&2
  CROSS_RELEASE_LINKS=1
done < <(comment_links)
if [[ $CROSS_RELEASE_LINKS -ne 0 ]]; then
  echo "No evidence was uploaded." >&2
  exit 1
fi

# Compute JIRA auth early (used in steps 3 and 4)
JIRA_AUTH=$(printf '%s' "$JIRA_USER:$JIRA_API_TOKEN" | base64 | tr -d '\n')

# ── Step 1: Upload to the GitHub evidence release ───────────────────────────
echo ""
echo "==> Uploading to GitHub release '$RELEASE_TAG'..."

# Every pull request shares this one release, and --clobber deletes a
# same-named asset before uploading. Bare NN- names collided across pull
# requests, so a later upload destroyed an earlier one's evidence
# (CodySwannGT/lisa#4639). Each asset is therefore uploaded as
# pr-${PR_NUMBER}-<file>: --clobber can then replace only this pull request's
# own earlier upload. Local evidence files keep their NN- names; the scoped
# copies live in a private directory removed on exit.
UPLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$UPLOAD_DIR"' EXIT
UPLOADED_ASSETS=()
for FILE in "${ALL_EVIDENCE[@]}"; do
  ASSET_NAME="pr-${PR_NUMBER}-$(basename "$FILE")"
  cp "$FILE" "$UPLOAD_DIR/$ASSET_NAME"
  echo "  ↑ $ASSET_NAME"
  gh release upload "$RELEASE_TAG" "$UPLOAD_DIR/$ASSET_NAME" --repo "$GH_REPO" --clobber
  UPLOADED_ASSETS+=("$ASSET_NAME")
done

# The description links these names, so confirm each one is really in the
# release before pointing anything at it.
RELEASE_ASSETS=$(gh release view "$RELEASE_TAG" --repo "$GH_REPO" --json assets --jq '.assets[].name')
MISSING_ASSETS=0
for ASSET_NAME in "${UPLOADED_ASSETS[@]}"; do
  if ! grep -qxF "$ASSET_NAME" <<< "$RELEASE_ASSETS"; then
    echo "ERROR: $ASSET_NAME is missing from release '$RELEASE_TAG' after upload" >&2
    MISSING_ASSETS=1
  fi
done
if [[ $MISSING_ASSETS -ne 0 ]]; then
  exit 1
fi

echo "  ✓ GitHub release assets uploaded"

# Every Markdown link or image target that points into the release must name
# an asset THIS run uploaded, and therefore one the check above just found in
# the release. A bare or other-PR name would show some other pull request's
# evidence, and a pr-<n>- asset left over from an earlier run would show
# evidence this run did not produce. Links into other releases were already
# checked before uploading.
THIS_RUN_ASSETS=$(printf '%s\n' "${UPLOADED_ASSETS[@]}")
BAD_LINKS=0
while IFS= read -r LINK; do
  # Only this repository's release counts: another repository's release of the
  # same name holds assets this run never uploaded.
  [[ "$LINK" == *"${RELEASE_PREFIX}${RELEASE_TAG}/"* ]] || continue
  LINK_NAME="${LINK##*/}"
  if [[ "$LINK_NAME" != "pr-${PR_NUMBER}-"* ]]; then
    echo "ERROR: $COMMENT_MD links $LINK, which is not scoped to PR #$PR_NUMBER (expected pr-${PR_NUMBER}-<file>)" >&2
    BAD_LINKS=1
  elif ! grep -qxF "$LINK_NAME" <<< "$THIS_RUN_ASSETS"; then
    echo "ERROR: $COMMENT_MD links $LINK, which this run did not upload to release '$RELEASE_TAG'" >&2
    BAD_LINKS=1
  fi
done < <(comment_links)
if [[ $BAD_LINKS -ne 0 ]]; then
  exit 1
fi

# ── Step 2: Update GitHub PR description with evidence ──────────────────────
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

# ── Step 5: Move ticket to the configured review status (if any) ────────────
# A transition may target only a status named in .lisa.config.json jira.workflow.
# `review` is OPTIONAL: when it is not configured, the build lifecycle stays in
# `claimed` until `done` — do NOT invent a transition. (See config-resolution.md.)
REVIEW=""
if [ -f .lisa.config.json ]; then
  _cfg=$(jq -r '.jira.workflow.review // .jira.workflow.code_review // empty' .lisa.config.json 2>/dev/null)
  [ -n "$_cfg" ] && REVIEW="$_cfg"
fi
if [ -f .lisa.config.local.json ]; then
  _local=$(jq -r '.jira.workflow.review // .jira.workflow.code_review // empty' .lisa.config.local.json 2>/dev/null)
  [ -n "$_local" ] && REVIEW="$_local"
fi
echo ""
if [ -n "$REVIEW" ]; then
  echo "==> Moving $TICKET_ID to $REVIEW..."
  # --config pins jira-cli to the same file this script parsed above.
  # jira-cli resolves --config > JIRA_CONFIG_FILE > ~/.config/.jira/
  # .config.yml, and a --config path that does not exist fails closed
  # rather than falling back (measured against jira-cli v1.7.0). The flag
  # needs no environment export, so this works identically on every
  # harness — see the harness note in the setup-jira-cli hook.
  jira --config "$JIRA_CONFIG" issue move "$TICKET_ID" "$REVIEW" 2>&1 && echo "  ✓ Ticket moved to $REVIEW" || echo "  WARNING: Could not move ticket to $REVIEW (not a valid transition?); leaving in current status" >&2
else
  echo "==> No jira.workflow.review configured; leaving $TICKET_ID in its current (claimed) status per config-resolution."
fi

echo ""
echo "==> Done!"
echo "    JIRA:   $JIRA_SERVER/browse/$TICKET_ID"
echo "    GitHub: https://github.com/$GH_REPO/pull/$PR_NUMBER"

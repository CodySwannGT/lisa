/**
 * The fake tracker transports the work-item harness puts on PATH.
 *
 * Split out of `tests/support/work-item-cli.ts` when that file reached its
 * `max-lines` ceiling (CodySwannGT/lisa#5035): `max-lines` counts lines inside
 * a template literal as code, since a `#` comment in embedded shell is string
 * content to eslint, so these two scripts were most of its weight. Each is the
 * shell body `executable()` writes after its shebang and `set -eu`, and each
 * reads its answers from the environment, so a case changes what the tracker
 * says by setting a variable rather than by rewriting a script.
 * @module tests/support/work-item-fake-transports
 */

/** The fake `gh`: issue, pull request, comment and timeline reads. */
export const GH_SCRIPT = `
if [ -n "\${FAKE_GH_LOG:-}" ]; then printf '%s\\n' "$*" >> "$FAKE_GH_LOG"; fi
case "\${1:-}" in
  --version) printf 'gh version %s (2026-01-01)\\n' "\${FAKE_GH_VERSION:-2.80.0}"; exit 0 ;;
esac
case "\${1:-} \${2:-}" in
  "issue view")
    [ "\${FAKE_GH_ISSUE_FAIL:-0}" != "1" ] || { echo "\${FAKE_GH_STDERR:-gone}" >&2; exit 1; }
    # Stage successive answers so completion can verify a fresh tracker read.
    # Use the same counter convention as the curl fake.
    ISSUE_JSON=$FAKE_GH_ISSUE_JSON
    if [ -n "\${FAKE_GH_ISSUE_COUNT_FILE:-}" ]; then
      ISSUE_COUNT=0
      [ ! -f "$FAKE_GH_ISSUE_COUNT_FILE" ] || ISSUE_COUNT=$(cat "$FAKE_GH_ISSUE_COUNT_FILE")
      case "$ISSUE_COUNT" in
        0) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_1:-$ISSUE_JSON} ;;
        1) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_2:-$ISSUE_JSON} ;;
        *) ISSUE_JSON=\${FAKE_GH_ISSUE_JSON_3:-$ISSUE_JSON} ;;
      esac
      printf '%s\\n' "$((ISSUE_COUNT + 1))" > "$FAKE_GH_ISSUE_COUNT_FILE"
    fi
    printf '%s\\n' "$ISSUE_JSON" ;;
  "issue list") case " $* " in *" --label status:ready "*) READY_LANE="\${FAKE_GH_LIST_STATUS_READY_JSON:-}" ;; *) READY_LANE="" ;; esac; printf '%s\\n' "\${READY_LANE:-\${FAKE_GH_LIST_JSON:-[]}}" ;;
  "issue edit") printf 'edited\\n' ;;
  "issue close") printf 'closed\\n' ;;
  "api graphql") printf '%s\\n' "$FAKE_GH_HIERARCHY_JSON" ;;
  "pr view")
    [ "\${FAKE_GH_PR_MISSING:-0}" != "1" ] || exit 1
    printf '%s\\n' "$FAKE_GH_PR_JSON" ;;
  "repo view") printf '%s\\n' '{"nameWithOwner":"acme/code"}' ;;
  "api --paginate")
    [ "\${4:-}" = "--jq" ] || exit 70
    "${process.execPath}" -e 'const comments = JSON.parse(process.env.FAKE_GH_COMMENTS_JSON || "[]"); console.log(JSON.stringify({ sourceCount: comments.length, comments: comments.filter(comment => comment.body.includes("[lisa-pr-link]")) }));' ;;
  "api --method") printf '%s\\n' '{"id":1}' ;;
  *)
    case "$*" in
      # Per-issue timelines, so a sweep over several items can give a different
      # answer for each. Without this every issue looks equally drifted and
      # "closes ONLY the drifted ones" is unassertable.
      *issues/43/timeline*) printf '%s\\n' "\${FAKE_GH_TIMELINE_43_JSON:-[]}" ;;
      *timeline*) printf '%s\\n' "\${FAKE_GH_TIMELINE_JSON:-[]}" ;;
      # The pulls read: gh api repos/OWNER/NAME/pulls/N --jq .base.ref, which
      # answers the branch a merged pull request landed on and so decides which
      # lifecycle role it earned. Per-pull-request, so a case can stage a stack
      # merge and a production merge against the same item.
      # Plain \${VAR-default}, NOT \${VAR:-default}: a case that stages an EMPTY
      # base is staging a real answer — a base the read could not resolve — and
      # the colon form would silently replace it with the default, so the
      # unresolvable-base case would test the resolvable one.
      *pulls/8*) printf '%s\\n' "\${FAKE_GH_PR_BASE_8-main}" ;;
      *pulls/*) printf '%s\\n' "\${FAKE_GH_PR_BASE-main}" ;;
      *) echo "unexpected gh invocation: $*" >&2; exit 70 ;;
    esac ;;
esac`;

/**
 * The fake `curl`, for the Jira and Linear transports.
 *
 * The default is assigned on its own line rather than written
 * `"${FAKE_CURL_JSON:-{}}"`. That form does NOT mean "default to {}": the
 * expansion ends at the first `}`, so the default is `{` and a stray `}` is
 * appended to every answer the fake gives — including the ones a case set
 * explicitly. A fixture staging `{"data":{"issue":null}}` was answered with a
 * trailing brace and the guard reported "malformed JSON", which is a fault in
 * the harness wearing the tracker's clothes.
 */
export const CURL_SCRIPT =
  // Consume stdin before exiting so a writer cannot race into EPIPE.
  `cat > /dev/null
[ "\${FAKE_CURL_FAIL:-0}" != "1" ] || exit 1
JSON=\${FAKE_CURL_JSON:-}
if [ -n "\${FAKE_CURL_COUNT_FILE:-}" ]; then
  COUNT=0
  [ ! -f "$FAKE_CURL_COUNT_FILE" ] || COUNT=$(cat "$FAKE_CURL_COUNT_FILE")
  case "$COUNT" in
    0) JSON=\${FAKE_CURL_JSON_1:-$JSON} ;;
    1) JSON=\${FAKE_CURL_JSON_2:-$JSON} ;;
    *) JSON=\${FAKE_CURL_JSON_3:-$JSON} ;;
  esac
  printf '%s\\n' "$((COUNT + 1))" > "$FAKE_CURL_COUNT_FILE"
fi
[ -n "$JSON" ] || JSON='{}'
printf '%s\\n' "$JSON"`;

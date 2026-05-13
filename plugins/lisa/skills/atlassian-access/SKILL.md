---
name: atlassian-access
description: "Vendor-neutral access layer for Atlassian (JIRA + Confluence). Every jira-* and confluence-* skill MUST delegate through this skill rather than calling Atlassian directly. Resolves a substrate per operation in this order: (1) acli if installed and its active profile matches the configured site, (2) Atlassian MCP if authenticated and the configured cloudId is in its accessible resources, (3) curl + API-token Basic auth. Verifies the active connection matches `.lisa.config.json` before every operation — substrates authenticated as a different Atlassian account are skipped, not used."
allowed-tools: ["Bash", "Read", "Skill"]
---

# Atlassian Access: $ARGUMENTS

Single chokepoint for all Atlassian operations. Routes each op to a substrate, enforces connection match, returns structured result. Caller skills (`jira-*`, `confluence-*`) MUST go through this — they MUST NOT invoke `acli` directly, call Atlassian MCP tools directly, or curl the Atlassian REST API themselves.

## Invocation contract

The caller passes one operation plus its arguments. Operations are listed in the dispatch table below. The skill returns either the structured operation result (JSON when the substrate provides it) or a clear error.

```
operation: read-ticket  key: PROJ-123
operation: write-ticket payload: {...}
operation: transition   key: PROJ-123  to: "In Review"
operation: comment      key: PROJ-123  body: "..."
operation: search-issues jql: "project = SE AND status = Open"
operation: read-page    id: 12345
operation: write-page   payload: {...}
```

## Workflow

### Step 1 — Substrate selection (per operation)

Read config:

```bash
SITE=$(jq -r '.atlassian.site // empty' .lisa.config.json)
CLOUDID=$(jq -r '.atlassian.cloudId // empty' .lisa.config.json)
EMAIL=$(jq -r '.atlassian.email // empty' .lisa.config.local.json 2>/dev/null)
[ -z "$CLOUDID" ] && { echo "Error: atlassian.cloudId not set. Run /lisa:setup:atlassian." >&2; exit 1; }
```

Probe each tier in order; the first that's ready AND identity-matches is the substrate for this operation. Identity-match is verified before any operation; substrates authenticated as a different Atlassian account are skipped, not used.

```bash
substrate=""

# Tier 1: acli
if command -v acli >/dev/null 2>&1 && acli auth status >/dev/null 2>&1; then
  current_site=$(acli auth status 2>/dev/null | awk '/^  Site:/{print $2}')
  if [ "$current_site" = "$SITE" ]; then
    substrate="acli"
  else
    # acli installed but pointing at a different site. Try switching profiles.
    if acli auth switch --site "$SITE" ${EMAIL:+--email "$EMAIL"} >/dev/null 2>&1; then
      substrate="acli"
    fi
  fi
fi

# Tier 2: Atlassian MCP (if acli not ready OR the operation isn't acli-covered)
if [ -z "$substrate" ] || [ "$OP_REQUIRES" = "non-acli" ]; then
  # Probe via mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources.
  # (Pseudo-code; actual call is the MCP tool invocation, not a bash command.)
  # If the MCP returns a list and $CLOUDID is in it, MCP is identity-matched.
  # If the MCP is unauthenticated or $CLOUDID is NOT in the list, MCP is skipped.
  if mcp_atlassian_authenticated_and_matches_cloudid "$CLOUDID"; then
    : ${substrate:=mcp}
    # Mark MCP as available even if acli already won tier 1 — used for ops acli can't do.
    mcp_available=true
  fi
fi

# Tier 3: curl + API token (headless / multi-account / scoped-token path)
read_atlassian_token() {
  local email="$1"
  [ -n "$ATLASSIAN_API_TOKEN" ] && { echo "$ATLASSIAN_API_TOKEN"; return; }
  local slug=$(echo "$email" | tr '[:upper:]@.' '[:lower:]__')
  local varname="ATLASSIAN_API_TOKEN_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  case "$(uname -s)" in
    Darwin)  security find-generic-password -s lisa-atlassian -a "$email" -w 2>/dev/null ;;
    Linux)   command -v secret-tool >/dev/null && secret-tool lookup service lisa-atlassian account "$email" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*) cmdkey /list:"lisa-atlassian-${email}" 2>/dev/null | grep Password | awk '{print $NF}' ;;
  esac
}
TOKEN=$(read_atlassian_token "$EMAIL")
[ -n "$TOKEN" ] && curl_available=true && : ${substrate:=curl}

# Fail loudly if nothing works.
if [ -z "$substrate" ]; then
  cat >&2 <<EOF
Error: no Atlassian access substrate available for site $SITE.
Attempted:
  acli   — $(command -v acli >/dev/null && echo "installed but identity mismatch or unauthenticated" || echo "not installed")
  MCP    — not authenticated OR cloudId $CLOUDID not in accessible resources
  curl   — no ATLASSIAN_API_TOKEN found for $EMAIL
Run /lisa:setup:atlassian to provision one.
EOF
  exit 1
fi
```

Operation dispatch then uses `$substrate` for the primary route. If the operation has no `acli` adapter and `$substrate=acli`, fall through to `$mcp_available` then `$curl_available` for the actual call. The fall-through stops at the first available tier that can perform the operation.

### Step 2 — Connection-match check

The active connection MUST point at the cloudId/site declared in `.lisa.config.json`. Step 1's substrate selection already verifies this implicitly (substrates that don't match are skipped). This step is the explicit assertion before any operation runs — defensive in case the substrate state changed since selection.

Read configured site:

```bash
cloudid=$(jq -r '.atlassian.cloudId // empty' .lisa.config.json)
site=$(jq -r '.atlassian.site // empty' .lisa.config.json)   # optional human-readable site URL
email=$(jq -r '.atlassian.email // empty' .lisa.config.json) # optional, for multi-account disambiguation

if [ -z "$cloudid" ]; then
  echo "Error: atlassian.cloudId not set in .lisa.config.json. Run /lisa:setup:atlassian." >&2
  exit 1
fi
```

**CLI mode check**:

```bash
# Compare active acli profile against config.
current=$(acli auth status --json 2>/dev/null)
current_site=$(echo "$current" | jq -r '.site // empty')
current_email=$(echo "$current" | jq -r '.email // empty')

if [ -n "$site" ] && [ "$current_site" != "$site" ]; then
  # Profile mismatch — switch.
  acli auth switch --site "$site" ${email:+--email "$email"}
fi
```

If `acli auth switch` fails because no matching profile exists, surface the error verbatim and instruct the caller to run `/lisa:setup:atlassian` to add the profile.

**curl mode check** (when the chosen op routes to curl):

```bash
# Validate the active ATLASSIAN_API_TOKEN points at the configured account by
# hitting /rest/api/3/myself and comparing emailAddress.
AUTH=$(printf '%s:%s' "$email" "$ATLASSIAN_API_TOKEN" | base64)
myself=$(curl -s -H "Authorization: Basic $AUTH" \
  "https://${site}/rest/api/3/myself")
me_email=$(echo "$myself" | jq -r '.emailAddress // empty')

if [ -z "$me_email" ]; then
  echo "Error: ATLASSIAN_API_TOKEN failed authentication against $site. Run /lisa:setup:atlassian to re-issue." >&2
  exit 1
fi
if [ "$me_email" != "$email" ]; then
  echo "Error: ATLASSIAN_API_TOKEN belongs to '$me_email', but .lisa.config.local.json declares '$email'. Multi-account misconfiguration." >&2
  exit 1
fi
```

If validation fails, never silently proceed — abort and instruct the user to fix env.

### Step 3 — Operation dispatch

Substrate column meanings:

- **`acli`**: routes through `acli`. Preferred when available and identity-matched.
- **`MCP`**: routes through the Atlassian MCP. Preferred when acli can't do the op and the MCP is identity-matched (cloudId in `getAccessibleAtlassianResources`).
- **`curl`**: routes through curl + Basic auth + `ATLASSIAN_API_TOKEN`. Used when neither acli nor MCP is available.
- Multiple cells filled means tier ordering applies — try acli, then MCP, then curl, taking the first that has an adapter for the op AND is identity-matched.
- One cell means only that substrate can perform the op.

`<SITE>` = `.atlassian.site` (e.g. `propswap.atlassian.net`). `<CLOUDID>` = `.atlassian.cloudId`. `<AUTH>` = `Basic $(printf '%s:%s' "$email" "$ATLASSIAN_API_TOKEN" | base64)`. JIRA paths use `/rest/api/3/...`; Confluence uses `/wiki/rest/api/...` (v1) or `/api/v2/...` (v2).

| Operation | acli adapter | MCP adapter | curl adapter |
|---|---|---|---|
| **JIRA ops** | | | |
| `read-ticket key:<K>` | `acli jira workitem view <K> --json` | `mcp__plugin_atlassian_atlassian__getJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>` |
| `write-ticket payload:<P>` (create) | `acli jira workitem create --from-json <P>` | `mcp__plugin_atlassian_atlassian__createJiraIssue` | `POST https://<SITE>/rest/api/3/issue` body=`<P>` |
| `write-ticket payload:<P>` (edit) | `acli jira workitem edit <K> --from-json <P>` | `mcp__plugin_atlassian_atlassian__editJiraIssue` | `PUT https://<SITE>/rest/api/3/issue/<K>` body=`<P>` |
| `transition key:<K> to:<S>` | `acli jira workitem transition --key <K> --status "<S>" --yes` | `mcp__plugin_atlassian_atlassian__transitionJiraIssue` | resolve transition id then `POST .../issue/<K>/transitions` |
| `transitions key:<K>` | (not exposed) | `mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>/transitions` |
| `comment key:<K> body:<B>` | `acli jira workitem comment add --key <K> --body "<B>"` | `mcp__plugin_atlassian_atlassian__addCommentToJiraIssue` | `POST https://<SITE>/rest/api/3/issue/<K>/comment` |
| `link from:<K> to:<K2> type:<T>` | `acli jira workitem link create --inward <K> --outward <K2> --type "<T>"` | `mcp__plugin_atlassian_atlassian__createJiraIssueLink` | `POST https://<SITE>/rest/api/3/issueLink` |
| `remote-links key:<K>` | (not exposed) | `mcp__plugin_atlassian_atlassian__getJiraIssueRemoteIssueLinks` | `GET https://<SITE>/rest/api/3/issue/<K>/remotelink` |
| `search-issues jql:<J>` | `acli jira workitem search --jql "<J>" --json` | `mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` | `POST https://<SITE>/rest/api/3/search/jql` |
| `list-projects` | `acli jira project list --paginate --json` | `mcp__plugin_atlassian_atlassian__getVisibleJiraProjects` | `GET https://<SITE>/rest/api/3/project/search` |
| `issue-type-metadata project:<K>` | `acli jira project view --key <K> --include-all --json` | `mcp__plugin_atlassian_atlassian__getJiraProjectIssueTypesMetadata` | `GET https://<SITE>/rest/api/3/issuetype/project?projectId=<id>` |
| **Confluence ops** | | | |
| `read-page id:<I>` | `acli confluence page view --id <I> --json` | `mcp__plugin_atlassian_atlassian__getConfluencePage` | `GET https://api.atlassian.com/ex/confluence/<CLOUDID>/wiki/rest/api/content/<I>` |
| `read-page-descendants id:<I>` | — | `mcp__plugin_atlassian_atlassian__getConfluencePageDescendants` | `GET .../content/<I>/descendant/page` |
| `read-page-comments id:<I> kind:<footer\|inline>` | — | `mcp__plugin_atlassian_atlassian__getConfluencePageFooterComments` / `getConfluencePageInlineComments` | `GET .../content/<I>/child/comment?location=<kind>` |
| `read-comment-children id:<C>` | — | `mcp__plugin_atlassian_atlassian__getConfluenceCommentChildren` | `GET .../content/<C>/child/comment` |
| `write-page payload:<P>` (create) | — | `mcp__plugin_atlassian_atlassian__createConfluencePage` | `POST .../wiki/rest/api/content` body=`<P>` |
| `write-page payload:<P>` (edit) | — | `mcp__plugin_atlassian_atlassian__updateConfluencePage` | `PUT .../content/<I>` body must include `version.number` bumped |
| `label-page id:<I> add:<L1,L2> remove:<L3,L4>` | — | (no v2 label-write endpoint on MCP) | (Atlassian gap; not used by lisa — see "Confluence PRD lifecycle" rule) |
| `comment-page id:<I> kind:<footer\|inline> body:<B>` | — | `mcp__plugin_atlassian_atlassian__createConfluenceFooterComment` / `createConfluenceInlineComment` | `POST .../content` body has `type=comment` |
| `search-pages cql:<Q>` | — | `mcp__plugin_atlassian_atlassian__searchConfluenceUsingCql` | `GET .../content/search?cql=<Q>` |
| `list-spaces` | `acli confluence space list --type global --json` | `mcp__plugin_atlassian_atlassian__getConfluenceSpaces` | `GET .../wiki/rest/api/space` |
| **Common ops** | | | |
| `list-sites` | `acli auth status --json` | `mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources` | `GET https://api.atlassian.com/oauth/token/accessible-resources` |

**Confluence v1 vs v2:** every Confluence curl path above uses **v1** (`/wiki/rest/api/...`). v1 is deprecated by Atlassian but as of writing remains functional for API-token Basic auth. The v2 API (`/api/v2/...`) requires *granular* OAuth scopes that aren't issued to Basic-auth API tokens consistently — so v1 is the safer path for now. When Atlassian fully retires v1, this table must move to v2 (the dispatch is the only thing that changes; the substrate-selection logic is unaffected).

**acli flag note:** acli's `--output` flag does not exist; the correct flag is `--json`. List commands require `--paginate` or `--limit` (no implicit fetch-all). Several documented adapters are nominal — verify against `acli <subcmd> --help` before relying on them. When acli's adapter is broken or missing for a specific op, fall through to MCP (if identity-matched) then curl per the tier ordering.

Operations not in this table are unsupported — add an adapter row before using them. Adapters MUST return a structured response (parse `acli`'s `--json`; jq-process curl's raw JSON).

### Payload conventions

- `write-ticket` payload: full JSON spec when creating; partial JSON (only changed fields, with `key` to identify) when editing. Adapters detect create vs edit by presence of `key`.
- `write-page` payload: supports a label-only mutation form — `{ "id": "<I>", "labels": { "add": [...], "remove": [...] } }` — so callers transitioning PRD lifecycle labels do not need to resend the page body. Full create/update payloads also accepted.
- `comment-page` `kind: inline` requires `anchor` (the highlighted text the comment attaches to). `kind: footer` ignores `anchor`.

### Step 4 — Return result

Emit either:

- The structured operation result (JSON object), wrapped in a `<result>` block for caller parsing, OR
- An error message prefixed with `Error:` and a remediation hint. Exit non-zero. Include the HTTP status code (curl) or acli exit code so callers can route on it.

Do not paraphrase substrate output beyond JSON normalization.

## Invariants

- Caller skills never invoke `acli` or `curl` against Atlassian directly. They only invoke this skill.
- Substrate is decided once per skill invocation and never switches mid-operation.
- Connection match is mandatory. Operations that bypass it (because "the user obviously meant the configured site") are forbidden.
- Profile mutations (`acli auth switch`) are allowed when acli is the active substrate. The curl substrate never mutates the token — if `ATLASSIAN_API_TOKEN` doesn't match the configured account, fail loud rather than silently substituting.
- `.lisa.config.local.json` overrides `.lisa.config.json` per-key — the same precedence rule as every other consumer of project config.

## Headless behavior

In a headless / non-interactive context (no TTY, `CI=true`, or `-p` mode), the MCP tier is unavailable (its OAuth flow needs a browser). The substrate ladder collapses to: acli (if pre-authenticated, e.g., a CI image baked with a service-account token) → curl + `ATLASSIAN_API_TOKEN`. Never block on interactive prompts. If both fail readiness checks, exit non-zero with a deterministic error.

---
name: lisa-atlassian-access
description: "Vendor-neutral access layer for…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Atlassian Access: $ARGUMENTS

Single chokepoint for all Atlassian operations. Routes each op to a substrate, enforces connection match, returns structured result. Caller skills (`jira-*`, `confluence-*`) MUST go through this — they MUST NOT invoke `acli` directly, call Atlassian MCP tools directly, or curl the Atlassian REST API themselves.

## Invocation contract

The caller passes one operation plus its arguments. Operations are listed in the dispatch table below. The skill returns either the structured operation result (JSON when the substrate provides it) or a clear error.

```text
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

Probe each tier in order; the first that's ready AND identity-matches is the substrate for this operation. The ordering is the shared `credential-substrate-precedence` contract — the configured-provider token substrate leads for **reads and writes alike**, with acli and the MCP as identity-matched fallbacks — not an Atlassian-local choice. Identity-match is verified before any operation; substrates authenticated as a different Atlassian account are switched to the configured profile when one exists, then skipped only if the switch fails or re-verification still mismatches.

```bash
substrate=""

# Tier 1: curl + API token — the configured-provider substrate, resolved through
# lisa-secrets-access. Leads for every operation because it is per-invocation-bound:
# the cloudId-scoped gateway URL and the token's own account carry the tenant inside
# the request, so no ambient machine-global state can redirect it. acli (one global
# active account) and the MCP (browser OAuth session) are ambient-bound and therefore
# TOCTOU-exposed — see credential-substrate-precedence, "tenant safety".
read_atlassian_token() {
  local email="$1"
  [ -n "$ATLASSIAN_API_TOKEN" ] && { echo "$ATLASSIAN_API_TOKEN"; return; }
  local slug=$(echo "$email" | tr '[:upper:]@.' '[:lower:]__')
  local varname="ATLASSIAN_API_TOKEN_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  # Preferred path: the single secrets chokepoint. It owns the one-store rule
  # and the surface ladder, so anything it can answer must not be read out of an
  # OS keychain here — a second reader is how the same credential ends up living
  # in two places and drifting.
  #
  # Ordered across trusted machine-managed substrates, ending at the installed
  # package. Checkout-local paths are deliberately absent: a familiar generated
  # destination is still repository-controlled executable code. The plugin
  # rungs are the floor: `resolve-secret.mjs` ships beside this skill, so a rung
  # pointing at it is reachable from anywhere the plugin itself is installed.
  # Without one, a consumer repository that vendors none of the leading paths
  # never reaches a resolver at all — the ladder exits without having asked
  # anything, which is what pushed agents into improvising their own credential
  # lookups. This LADDER is identical in every skill that resolves a credential
  # and `credential-resolver-ladder` fails if any copy diverges. Only what
  # happens AFTER the ladder may differ between them.
  # Executable resolvers are a code boundary. Checkout-local copies are mutable
  # repository content, so use only machine-managed plugin/package locations.
  local candidates=()
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    candidates+=("$CLAUDE_PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    candidates+=("$PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  # Last rung deliberately needs no environment variable: an agent that was
  # never handed a plugin root still has the installed package to fall back on.
  candidates+=(node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs)

  local resolver
  local tried=()
  for resolver in "${candidates[@]}"; do
    tried+=("$resolver")
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get ATLASSIAN_API_TOKEN 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      # Empty/error means this substrate had no answer; try the next trusted one.
    fi
  done
  # Legacy fallback: the OS keychain written by the guided /lisa:setup:atlassian
  # flow, for projects that have not adopted a credentials provider. Reached only
  # when the chokepoint is absent or has no entry.
  #
  # This rung is REMOVED ON 2026-11-01 — a dated migration ramp, not a standing
  # exemption (see credential-substrate-precedence, "Legacy OS-keychain fallback
  # — removal date"). A keychain entry is machine-local ambient state no headless
  # surface can reach, so a project resting on it has no working tier 1 in cron,
  # CI, or a cloud session. Re-run /lisa:setup:atlassian before that date to
  # store ATLASSIAN_API_TOKEN through the chokepoint instead.
  local from_keychain=""
  case "$(uname -s)" in
    Darwin)  from_keychain=$(security find-generic-password -s lisa-atlassian -a "$email" -w 2>/dev/null) ;;
    Linux)   command -v secret-tool >/dev/null && \
             from_keychain=$(secret-tool lookup service lisa-atlassian account "$email" 2>/dev/null) ;;
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      from_keychain=$(LISA_CRED_TARGET="lisa-atlassian-${email}" powershell.exe -NoProfile -NonInteractive -Command '
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LisaCred {
  [StructLayout(LayoutKind.Sequential)]
  private struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
  [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) { return null; }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) { return String.Empty; }
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}
"@
[LisaCred]::Read($env:LISA_CRED_TARGET)' 2>/dev/null | tr -d '\r') ;;
  esac
  [ -n "$from_keychain" ] && { echo "$from_keychain"; return; }

  # Name every path. A bare `return 1` sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths and store coordinates only — never any
  # resolved value, on any path.
  echo "Error: could not resolve ATLASSIAN_API_TOKEN through lisa-secrets-access or the legacy keychain." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  echo "  <OS keychain> service=lisa-atlassian account=<configured>" >&2
  return 1
}
TOKEN=$(read_atlassian_token "$EMAIL")
if [ -n "$TOKEN" ]; then
  # Identity-match before use: /rest/api/3/myself must report the configured account
  # (Step 2). A present-but-wrong token fails the gate loudly instead of quietly
  # deferring to an acli profile or MCP session authenticated somewhere else — that
  # silent success is the bug class the precedence contract exists to surface.
  if atlassian_token_matches_config "$TOKEN" "$EMAIL" "$CLOUDID"; then
    curl_available=true
    substrate="curl"
  else
    echo "Warning: ATLASSIAN_API_TOKEN does not match the configured account/site. Skipping curl tier." >&2
  fi
fi

# Tier 2: acli — identity-matched fallback. Used when no token is available, or for
# operations with no curl adapter. Never the primary path for JIRA writes when token
# auth is available: acli stores one machine-global active account and workitem writes
# cannot pin a cloudId per invocation, so switch-then-write is a TOCTOU risk in
# multi-account or concurrent sessions. When a write does land here it is the *guarded*
# fallback documented in the dispatch table (assert, write, re-read, assert, roll back).
if command -v acli >/dev/null 2>&1 && acli auth status >/dev/null 2>&1; then
  current_site=$(acli auth status 2>/dev/null | awk '/^  Site:/{print $2}')
  if [ "$current_site" != "$SITE" ]; then
    # acli installed but pointing at a different site. Try switching profiles.
    acli auth switch --site "$SITE" ${EMAIL:+--email "$EMAIL"} >/dev/null 2>&1 || true
    current_site=$(acli auth status 2>/dev/null | awk '/^  Site:/{print $2}')
  fi
  if [ "$current_site" = "$SITE" ]; then
    acli_available=true
    # Mark acli available even if curl already won tier 1 — used for ops curl can't do.
    : ${substrate:=acli}
  fi
fi

# Tier 3: Atlassian MCP — first-class interactive fallback, for when neither tier above
# is available or covers the operation (e.g. an op with no curl and no acli adapter).
# Probe via mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources.
# (Pseudo-code; actual call is the MCP tool invocation, not a bash command.)
# If the MCP returns a list and $CLOUDID is in it, MCP is identity-matched.
# If the MCP is unauthenticated or $CLOUDID is NOT in the list, MCP is skipped.
if mcp_atlassian_authenticated_and_matches_cloudid "$CLOUDID"; then
  : ${substrate:=mcp}
  # Mark MCP as available even if an earlier tier won — used for ops they can't do.
  mcp_available=true
fi

# Fail loudly with actionable remediation if nothing works.
if [ -z "$substrate" ]; then
  # Detect plugin enablement state for the suggestion.
  plugin_enabled_global=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' ~/.claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_project=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' .claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_local=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' .claude/settings.local.json 2>/dev/null || echo "false")

  cat >&2 <<EOF
Error: no Atlassian access substrate available for site $SITE.

Attempted (in credential-substrate-precedence order):
  curl   — no ATLASSIAN_API_TOKEN found for $EMAIL (env, slug-suffixed env, or keychain) OR the token does not match the configured account/site
  acli   — $(command -v acli >/dev/null && echo "installed but identity mismatch or unauthenticated" || echo "not installed")
  MCP    — $([ "$plugin_enabled_global" = "true" ] || [ "$plugin_enabled_project" = "true" ] || [ "$plugin_enabled_local" = "true" ] && echo "plugin enabled but not authenticated or cloudId $CLOUDID not in accessible resources" || echo "plugin not enabled in any settings.json scope")

Remediation paths (the first is the contract's primary path):

1. Provision an API token — works headless, in CI, in subagents, and in
   multi-account setups, and is the substrate this project resolves first.

     Run /lisa:setup:atlassian — guided flow with clipboard-piped keychain store.

2. Install acli and authenticate (identity-matched fallback for multi-account developers).

     brew tap atlassian/homebrew-acli && brew install acli
     acli auth login   # OAuth as the account matching $EMAIL

3. Install the Atlassian MCP plugin (local scope — per-developer, gitignored).
   The supported fallback when no credentials provider is configured.

   Run in your terminal:

     jq '.enabledPlugins["atlassian@claude-plugins-official"] = true' \\
       .claude/settings.local.json 2>/dev/null > /tmp/s && \\
       mv /tmp/s .claude/settings.local.json || \\
       echo '{"enabledPlugins":{"atlassian@claude-plugins-official":true}}' > .claude/settings.local.json

   Then restart Claude Code (or run /restart-mcp) to load the plugin, and
   invoke 'mcp__plugin_atlassian_atlassian__authenticate' to complete OAuth.

EOF
  exit 1
fi
```

Operation dispatch then uses `$substrate` for the primary route. If the operation has no adapter for the selected substrate, fall through in contract order — `$curl_available`, then `$acli_available`, then `$mcp_available` — skipping the tier already tried. The fall-through stops at the first available tier that can perform the operation. A tier that failed identity-match is never in the fall-through set.

### Step 2 — Connection-match check

The active connection MUST point at the cloudId/site declared in `.lisa.config.json`. Identity-match is mandatory on **every** substrate, tier 1 included (`credential-substrate-precedence`); the "curl mode check" below *is* the tier-1 gate referenced as `atlassian_token_matches_config` in Step 1. Step 1's substrate selection already validates the token account and tries to switch mismatched acli profiles before selection. This step repeats the assertion before any operation runs — defensive in case the substrate state changed since selection.

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
  # Profile mismatch — switch, then re-verify. Do not trust the switch exit
  # status alone because acli's active account is machine-global state.
  acli auth switch --site "$site" ${email:+--email "$email"}
  current=$(acli auth status --json 2>/dev/null)
  current_site=$(echo "$current" | jq -r '.site // empty')
  current_email=$(echo "$current" | jq -r '.email // empty')
fi

if [ -n "$site" ] && [ "$current_site" != "$site" ]; then
  echo "Error: acli active site is '$current_site', but .lisa.config.json requires '$site'. Run /lisa:setup:atlassian to add or repair the matching profile." >&2
  exit 1
fi

if [ -n "$email" ] && [ -n "$current_email" ] && [ "$current_email" != "$email" ]; then
  echo "Error: acli active account does not match the configured Atlassian account. Run /lisa:setup:atlassian to add or repair the matching profile." >&2
  exit 1
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
  echo "Error: ATLASSIAN_API_TOKEN identity does not match the configured Atlassian account. Multi-account misconfiguration; re-run /lisa:setup:atlassian." >&2
  exit 1
fi
```

If validation fails, never silently proceed — abort and instruct the user to fix env.

### Step 2.5 — JIRA description normalization

For `write-ticket` create/edit operations, normalize any Lisa-authored JIRA description before dispatching to a substrate. JIRA Cloud stores descriptions as Atlassian Document Format (ADF). `acli` does not convert Markdown or JIRA wiki markup to ADF; if plain text is passed to `--description` / `--description-file`, JIRA stores one literal paragraph containing strings like `## Repository` or `h2. Repository`. That breaks `jira-validate-ticket` heading checks and renders poorly for humans.

Use the shared converter at `scripts/markdown-to-adf.mjs` from this skill for every write path that carries a string description:

```bash
normalize_jira_description_payload() {
  local payload_file="$1"
  local converter="$(dirname "$0")/scripts/markdown-to-adf.mjs"

  jq -e '.fields.description | type == "string"' "$payload_file" >/dev/null 2>&1 || return 0

  local markdown_file adf_file
  markdown_file=$(mktemp)
  adf_file=$(mktemp)
  jq -r '.fields.description' "$payload_file" > "$markdown_file"
  node "$converter" < "$markdown_file" > "$adf_file"
  jq --slurpfile adf "$adf_file" '.fields.description = $adf[0]' "$payload_file" > "$payload_file.tmp"
  mv "$payload_file.tmp" "$payload_file"
}
```

Rules:

- Convert Markdown headings (`#` / `##` / `###`) and JIRA wiki headings (`h1.` / `h2.` / `h3.`) to ADF `heading` nodes.
- Convert fenced code blocks, bullet lists, numbered lists, paragraphs, inline code, and bold text to their ADF equivalents.
- Run this for acli, curl, and MCP writes unless the caller already supplied an ADF object (`description.type == "doc"`). Do not double-convert existing ADF.
- For acli, pass the normalized JSON through `--from-json`; do not use `--description` or `--description-file` with raw Markdown/wiki text.

### Step 3 — Operation dispatch

Substrate column meanings (ordering per `credential-substrate-precedence`):

- **`curl`**: routes through curl + Basic auth + `ATLASSIAN_API_TOKEN` — the configured-provider substrate. Preferred for every operation, read or write, whenever the token is present and identity-matched.
- **`acli`**: routes through `acli`. Identity-matched fallback — used when no token is available or the op has no curl adapter. For JIRA writes it is the *guarded* fallback (see the tenant-safety rule below).
- **`MCP`**: routes through the Atlassian MCP. First-class fallback for ops neither tier above covers, when identity-matched (cloudId in `getAccessibleAtlassianResources`).
- Multiple cells filled means tier ordering applies — try curl, then acli, then MCP, taking the first that has an adapter for the op AND is identity-matched.
- One cell means only that substrate can perform the op.

`<SITE>` = `.atlassian.site` (e.g. `acme.atlassian.net`). `<CLOUDID>` = `.atlassian.cloudId`. `<AUTH>` = `Basic $(printf '%s:%s' "$email" "$ATLASSIAN_API_TOKEN" | base64)`. JIRA curl writes use the cloudId-bound Atlassian gateway `https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/...`; JIRA curl reads may use either that gateway or `https://<SITE>/rest/api/3/...` after the token account check. Confluence uses `/wiki/rest/api/...` (v1) or `/api/v2/...` (v2).

| Operation | acli adapter | MCP adapter | curl adapter |
|---|---|---|---|
| **JIRA ops** | | | |
| `read-ticket key:<K>` | `acli jira workitem view <K> --fields '*all' --json` | `mcp__plugin_atlassian_atlassian__getJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>?fields=*all` |
| `write-ticket payload:<P>` (create) | guarded fallback only: `acli jira workitem create --from-json <P>` + response tenant assertion | `mcp__plugin_atlassian_atlassian__createJiraIssue` | `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue` body=`<P>` |
| `write-ticket payload:<P>` (edit) | guarded fallback only: `acli jira workitem edit <K> --from-json <P>` + response tenant assertion | `mcp__plugin_atlassian_atlassian__editJiraIssue` | `PUT https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue/<K>` body=`<P>` |
| `transition key:<K> to:<S>` | guarded fallback only: `acli jira workitem transition --key <K> --status "<S>" --yes` + post-read tenant assertion | `mcp__plugin_atlassian_atlassian__transitionJiraIssue` | resolve transition id then `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue/<K>/transitions` |
| `transitions key:<K>` — **false friend:** available transitions from current status, **NOT** past history; for history use `changelog` | (not exposed) | `mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>/transitions` |
| `changelog key:<K>` (read; ordered past status transitions) | (not exposed) | (not exposed) | `GET https://<SITE>/rest/api/3/issue/<K>?expand=changelog` |
| `comment key:<K> body:<B>` | guarded fallback only: `acli jira workitem comment add --key <K> --body "<B>"` + post-read tenant assertion | `mcp__plugin_atlassian_atlassian__addCommentToJiraIssue` | `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue/<K>/comment` |
| `link from:<K> to:<K2> type:<T>` | guarded fallback only: `acli jira workitem link create --in <K> --out <K2> --type "<T>" --yes` + direction and tenant assertion (see direction note) | `mcp__plugin_atlassian_atlassian__createJiraIssueLink` | `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issueLink` |
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

**acli flag note:** acli's `--output` flag does not exist; the correct flag is `--json`. List commands require `--paginate` or `--limit` (no implicit fetch-all). `acli jira workitem view` defaults to a restricted field set (`key,issuetype,summary,status,assignee,description`), so `read-ticket` MUST pass `--fields '*all'` or an explicit equivalent that includes every downstream dependency: parent, subtasks, issue links, components, labels, priority, status, issue type, summary, description, fix versions, affected versions, attachments, comments, estimates, sprint/story-point fields, and project-required custom fields. Never rely on the default view fields; they hide parent/components/labels and corrupt leaf-only, relationship-search, build-ready, and required-custom-field gates. Several documented adapters are nominal — verify against `acli <subcmd> --help` before relying on them. When acli's adapter is broken or missing for a specific op, fall through to MCP (if identity-matched) then curl per the tier ordering.

**JIRA write tenant-safety rule** — the Atlassian instance of the shared guarded-fallback protocol in `credential-substrate-precedence` (which states the general rule: prefer the per-invocation-bound substrate over the ambient-bound one, for reads and writes alike; the rationale is not restated here). Create, edit, transition, comment, and link are write operations. They MUST use the curl adapter whenever token auth is available because the URL includes `<CLOUDID>` and cannot be redirected by the user-global acli active account. If the flow must fall back to acli for a write, it is a guarded fallback, not the normal path:

1. Switch and assert the active `acli auth status` site/email matches config immediately before the write.
2. Execute the write.
3. Read the affected issue(s) immediately after the write.
4. Assert each response belongs to the configured tenant by checking one of: response `self` URL host equals `<SITE>`, response `self` URL path includes `/ex/jira/<CLOUDID>/`, or response metadata reports `<CLOUDID>`.
5. If the assertion fails, stop, report a cross-tenant write hazard, and best-effort roll back the write when there is a safe reversal: delete a newly created issue, remove a newly created comment/link, or revert a reversible field edit. Never continue as if the write succeeded.

Do not treat a successful `acli auth switch` or pre-write `auth status` as sufficient for tenant safety. Another process can mutate the global acli active account between the check and the write.

**acli link-create direction is invertible — flags and verification:** acli has no `--inward`/`--outward` flags; the real flags are `--in` and `--out` (confirm with `acli jira workitem link create --help`). For a `Blocks` link, **`--in` is the blocker and `--out` is the blocked** issue, i.e. `--in <X> --out <Y> --type Blocks` resolves to "X blocks Y" (Y `is blocked by` X). The lisa op `link from:<K> to:<K2> type:<T>` means "K ⟨T⟩ K2", so the blocker `from` maps to `--in` and the blocked `to` maps to `--out` (as in the adapter above). The acli success banner only echoes the `--in`/`--out` values you passed — it does NOT confirm the resolved semantic direction, so a reversed link reports success and looks fine. **After every `link` write, re-read the affected issues via `read-ticket` (which already requests `--fields '*all'`) and confirm `issuelinks[].type` + `inwardIssue`/`outwardIssue` resolve to the intended `blocks` / `is blocked by` direction.** Skipping this can silently reverse an entire epic's dependency graph — e.g. cutover tickets recorded as *blocking* the prerequisites that should block them.

**JIRA terminal-resolution note:** when a caller marks a transition as terminal per `leaf-only-lifecycle`, the substrate must not treat a Done-named status as sufficient by name alone. After `transition key:<K> to:<S>`, re-read the issue and verify `statusCategory = Done`; if the workflow requires a resolution, verify `resolution` is set. If the transition screen requires a resolution value, pass the configured default resolution when available; otherwise return a setup error so the build-intake skill can report the workflow gap instead of silently leaving an unresolved ticket in a Done-looking status.

Operations not in this table are unsupported — add an adapter row before using them. Adapters MUST return a structured response (parse `acli`'s `--json`; jq-process curl's raw JSON).

### Payload conventions

- `write-ticket` payload: full JSON spec when creating; partial JSON (only changed fields, with `key` to identify) when editing. Adapters detect create vs edit by presence of `key`.
- `write-page` payload: supports a label-only mutation form — `{ "id": "<I>", "labels": { "add": [...], "remove": [...] } }` — so callers transitioning PRD lifecycle labels do not need to resend the page body. Full create/update payloads also accepted.
- `comment-page` `kind: inline` requires `anchor` (the highlighted text the comment attaches to). `kind: footer` ignores `anchor`.

### `changelog` — transition history (read-only)

`changelog key:<K>` returns the ordered past status transitions of a JIRA issue — the raw material for rejection detection (an issue that reached `review`/`done`-ward and is now back in `ready`). It is distinct from `transitions`, which is a false friend: `transitions` lists the *available* next transitions from the current status, never past ones. `read-ticket` uses `fields=*all`, which does **not** include the changelog — the expansion must be requested explicitly with `?expand=changelog`.

- **Substrate.** The only substrate that exposes the changelog is JIRA REST via the `?expand=changelog` query parameter (a read, so the `<SITE>` gateway is allowed after the token account check). Neither `acli jira workitem view` (a field-projection tool; the changelog is an `expand`, not a field) nor the Atlassian MCP surfaces a changelog expansion, so both are marked `(not exposed)` — do not invent a separate transport, and do not try to reconstruct history from `transitions`.
- **Shape.** Walk `changelog.histories[].items[]` and keep entries where `field == "status"`; for each emit `{ from, to, when, author }` — `items[].fromString` → `items[].toString`, `histories[].created` (ISO timestamp), `histories[].author.displayName`/`accountId`. Preserve JIRA's oldest→newest ordering.
- **Empty is valid.** An issue that never transitioned returns an **empty** history — an empty history is a valid result, not an error. Callers treat empty as "never left its initial status".
- **Pagination / truncation.** The issue-resource changelog (`?expand=changelog`) truncates busy issues (`changelog.maxResults`/`total`/`startAt`). When `total` exceeds what the issue resource returned, page the dedicated endpoint `GET https://<SITE>/rest/api/3/issue/<K>/changelog?startAt=<n>` until `startAt + maxResults >= total`, preserving order across pages. A silently truncated history is a correctness bug for detection.
- **Graceful degrade — never block the build.** A failed changelog fetch (network, auth, missing substrate) returns the substrate contract's `Error:` result. Callers MUST treat that as **unknown** history and proceed — a history read failure never blocks the build.

### Step 4 — Return result

Emit either:

- The structured operation result (JSON object), wrapped in a `<result>` block for caller parsing, OR
- An error message prefixed with `Error:` and a remediation hint. Exit non-zero. Include the HTTP status code (curl) or acli exit code so callers can route on it.

Do not paraphrase substrate output beyond JSON normalization.

## Invariants

- Caller skills never invoke `acli` or `curl` against Atlassian directly. They only invoke this skill.
- Tier order is the shared `credential-substrate-precedence` contract — token curl first (reads **and** writes), then acli, then the Atlassian MCP. Do not restate or locally override the ordering here.
- acli and the Atlassian MCP remain first-class **fallbacks**, not removed tiers: every adapter stays in the dispatch table, and a project with no credentials provider is fully functional on them.
- Substrate is decided once per skill invocation and never switches mid-operation.
- Connection match is mandatory on every tier, including the token tier. Operations that bypass it (because "the user obviously meant the configured site") are forbidden. A present-but-wrong token fails the gate rather than deferring to another substrate.
- Profile mutations (`acli auth switch`) are allowed when acli is the active substrate. The curl substrate never mutates the token — if `ATLASSIAN_API_TOKEN` doesn't match the configured account, fail loud rather than silently substituting.
- JIRA writes are cloudId-bound by default. `acli` write adapters are fallback-only and must perform post-write tenant assertions plus safe rollback on mismatch.
- `.lisa.config.local.json` overrides `.lisa.config.json` per-key — the same precedence rule as every other consumer of project config.

## Headless behavior

In a headless / non-interactive context, the MCP tier is unavailable (its OAuth flow needs a browser). The ladder collapses to: curl + `ATLASSIAN_API_TOKEN` → acli (if pre-authenticated, e.g., a CI image baked with a service-account token). Because curl is already tier 1 interactively, headless and interactive sessions take the **same primary path** — that is the "headless parity" arm of `credential-substrate-precedence`, and it is why a credential problem reproduces on a laptop instead of only in cron. Never block on interactive prompts. If both fail readiness checks, exit non-zero with a deterministic error.

Treat all four of these as headless:

- no TTY
- `CI=true`
- `-p` mode
- **a subagent / teammate session** — measured (#2148): a subagent sees only the OAuth bootstrap stubs (`…__authenticate`, `…__complete_authentication`), never the data tools, and a direct call returns `No such tool available` rather than an auth error. The request never leaves the harness. This is not a general MCP block — other MCP servers work fine from a subagent — it is specific to servers whose OAuth completed in the lead. Crucially **acli works normally in a subagent**, so the ladder already has a working tier; it just has to skip MCP to reach it.

Detecting the subagent case: Lisa's Claude hooks already mark it — `SubagentStart` writes `"${STATE_DIR}/${SESSION_ID}.subagent"`, consumed by `enforce-verification-gate.sh` and `enforce-team-first.sh`. Where that flag is unavailable, probing the MCP tier and finding only `authenticate`-shaped tools is the same signal: treat it as unavailable and fall through rather than attempting a call that cannot succeed.

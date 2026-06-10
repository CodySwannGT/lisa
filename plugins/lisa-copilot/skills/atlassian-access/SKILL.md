---
name: atlassian-access
description: "Vendor-neutral access layer for Atlassian (JIRA + Confluence). Every jira-* and confluence-* skill MUST delegate through this skill rather than calling Atlassian directly. Resolves a substrate per operation, binding JIRA writes to the configured cloudId via Atlassian REST whenever token auth is available and using acli only for reads or as a guarded fallback. For non-write acli operations, acli is used when installed and switchable to a profile matching the configured site; mismatched active profiles are skipped only after switch plus re-verification fails."
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

Probe each tier in order; the first that's ready AND identity-matches is the substrate for this operation. Identity-match is verified before any operation; substrates authenticated as a different Atlassian account are switched to the configured profile when one exists, then skipped only if the switch fails or re-verification still mismatches.

```bash
substrate=""

# Tier 1: acli for reads and non-write operations only.
#
# Do not choose acli for JIRA writes when curl/token auth is available. acli stores
# one machine-global active account and workitem writes cannot pin a cloudId per
# invocation, so switch-then-write is a TOCTOU risk in multi-account or concurrent
# sessions. Write operations prefer the cloudId-scoped REST URL below.
if [ "$OP_KIND" != "jira-write" ] && command -v acli >/dev/null 2>&1 && acli auth status >/dev/null 2>&1; then
  current_site=$(acli auth status 2>/dev/null | awk '/^  Site:/{print $2}')
  if [ "$current_site" != "$SITE" ]; then
    # acli installed but pointing at a different site. Try switching profiles.
    acli auth switch --site "$SITE" ${EMAIL:+--email "$EMAIL"} >/dev/null 2>&1 || true
    current_site=$(acli auth status 2>/dev/null | awk '/^  Site:/{print $2}')
  fi
  if [ "$current_site" = "$SITE" ]; then
    substrate="acli"
  fi
fi

# Tier 2: Atlassian MCP (if acli not ready OR the operation isn't acli-covered)
# $OP_REQUIRES is a conceptual variable set by the dispatch table to "non-acli" for
# operations that have no acli adapter (e.g. read-page-descendants). It is not a real
# shell variable initialized here — the condition is illustrative pseudo-code.
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
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      LISA_CRED_TARGET="lisa-atlassian-${email}" powershell.exe -NoProfile -NonInteractive -Command '
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
[LisaCred]::Read($env:LISA_CRED_TARGET)' 2>/dev/null | tr -d '\r' ;;
  esac
}
TOKEN=$(read_atlassian_token "$EMAIL")
[ -n "$TOKEN" ] && curl_available=true && {
  if [ "$OP_KIND" = "jira-write" ]; then
    substrate="curl"
  else
    : ${substrate:=curl}
  fi
}

# Fail loudly with actionable remediation if nothing works.
if [ -z "$substrate" ]; then
  # Detect plugin enablement state for the suggestion.
  plugin_enabled_global=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' ~/.claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_project=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' .claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_local=$(jq -r '.enabledPlugins["atlassian@claude-plugins-official"] // false' .claude/settings.local.json 2>/dev/null || echo "false")

  cat >&2 <<EOF
Error: no Atlassian access substrate available for site $SITE.

Attempted:
  acli   — $(command -v acli >/dev/null && echo "installed but identity mismatch or unauthenticated" || echo "not installed")
  MCP    — $([ "$plugin_enabled_global" = "true" ] || [ "$plugin_enabled_project" = "true" ] || [ "$plugin_enabled_local" = "true" ] && echo "plugin enabled but not authenticated or cloudId $CLOUDID not in accessible resources" || echo "plugin not enabled in any settings.json scope")
  curl   — no ATLASSIAN_API_TOKEN found for $EMAIL (env, slug-suffixed env, or keychain)

Remediation paths (pick one):

1. Install the Atlassian MCP plugin (local scope — per-developer, gitignored).
   This is the simplest path for single-account developers.

   Run in your terminal:

     jq '.enabledPlugins["atlassian@claude-plugins-official"] = true' \\
       .claude/settings.local.json 2>/dev/null > /tmp/s && \\
       mv /tmp/s .claude/settings.local.json || \\
       echo '{"enabledPlugins":{"atlassian@claude-plugins-official":true}}' > .claude/settings.local.json

   Then restart Claude Code (or run /restart-mcp) to load the plugin, and
   invoke 'mcp__plugin_atlassian_atlassian__authenticate' to complete OAuth.

2. Install acli and authenticate (best for multi-account developers).

     brew tap atlassian/homebrew-acli && brew install acli
     acli auth login   # OAuth as the account matching $EMAIL

3. Provision an API token (headless / CI / scoped-token environments).

     Run /lisa:setup:atlassian — guided flow with clipboard-piped keychain store.

EOF
  exit 1
fi
```

Operation dispatch then uses `$substrate` for the primary route. If the operation has no `acli` adapter and `$substrate=acli`, fall through to `$mcp_available` then `$curl_available` for the actual call. The fall-through stops at the first available tier that can perform the operation.

### Step 2 — Connection-match check

The active connection MUST point at the cloudId/site declared in `.lisa.config.json`. Step 1's substrate selection already tries to switch mismatched acli profiles and verifies the result before selection. This step repeats the assertion before any operation runs — defensive in case the substrate state changed since selection.

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
  echo "Error: acli active account is '$current_email', but .lisa.config.json requires '$email'. Run /lisa:setup:atlassian to add or repair the matching profile." >&2
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
  echo "Error: ATLASSIAN_API_TOKEN belongs to '$me_email', but .lisa.config.local.json declares '$email'. Multi-account misconfiguration." >&2
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

Substrate column meanings:

- **`acli`**: routes through `acli`. Preferred when available and identity-matched.
- **`MCP`**: routes through the Atlassian MCP. Preferred when acli can't do the op and the MCP is identity-matched (cloudId in `getAccessibleAtlassianResources`).
- **`curl`**: routes through curl + Basic auth + `ATLASSIAN_API_TOKEN`. Used when neither acli nor MCP is available.
- Multiple cells filled means tier ordering applies — try acli, then MCP, then curl, taking the first that has an adapter for the op AND is identity-matched.
- One cell means only that substrate can perform the op.

`<SITE>` = `.atlassian.site` (e.g. `propswap.atlassian.net`). `<CLOUDID>` = `.atlassian.cloudId`. `<AUTH>` = `Basic $(printf '%s:%s' "$email" "$ATLASSIAN_API_TOKEN" | base64)`. JIRA curl writes use the cloudId-bound Atlassian gateway `https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/...`; JIRA curl reads may use either that gateway or `https://<SITE>/rest/api/3/...` after the token account check. Confluence uses `/wiki/rest/api/...` (v1) or `/api/v2/...` (v2).

| Operation | acli adapter | MCP adapter | curl adapter |
|---|---|---|---|
| **JIRA ops** | | | |
| `read-ticket key:<K>` | `acli jira workitem view <K> --fields '*all' --json` | `mcp__plugin_atlassian_atlassian__getJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>?fields=*all` |
| `write-ticket payload:<P>` (create) | guarded fallback only: `acli jira workitem create --from-json <P>` + response tenant assertion | `mcp__plugin_atlassian_atlassian__createJiraIssue` | `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue` body=`<P>` |
| `write-ticket payload:<P>` (edit) | guarded fallback only: `acli jira workitem edit <K> --from-json <P>` + response tenant assertion | `mcp__plugin_atlassian_atlassian__editJiraIssue` | `PUT https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue/<K>` body=`<P>` |
| `transition key:<K> to:<S>` | guarded fallback only: `acli jira workitem transition --key <K> --status "<S>" --yes` + post-read tenant assertion | `mcp__plugin_atlassian_atlassian__transitionJiraIssue` | resolve transition id then `POST https://api.atlassian.com/ex/jira/<CLOUDID>/rest/api/3/issue/<K>/transitions` |
| `transitions key:<K>` | (not exposed) | `mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue` | `GET https://<SITE>/rest/api/3/issue/<K>/transitions` |
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

**JIRA write tenant-safety rule:** create, edit, transition, comment, and link are write operations. They MUST prefer the curl adapter whenever token auth is available because the URL includes `<CLOUDID>` and cannot be redirected by the user-global acli active account. If the flow must fall back to acli for a write, it is a guarded fallback, not the normal path:

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
- JIRA writes are cloudId-bound by default. `acli` write adapters are fallback-only and must perform post-write tenant assertions plus safe rollback on mismatch.
- `.lisa.config.local.json` overrides `.lisa.config.json` per-key — the same precedence rule as every other consumer of project config.

## Headless behavior

In a headless / non-interactive context (no TTY, `CI=true`, or `-p` mode), the MCP tier is unavailable (its OAuth flow needs a browser). The substrate ladder collapses to: acli (if pre-authenticated, e.g., a CI image baked with a service-account token) → curl + `ATLASSIAN_API_TOKEN`. Never block on interactive prompts. If both fail readiness checks, exit non-zero with a deterministic error.

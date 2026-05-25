---
name: notion-access
description: "Vendor-neutral access layer for Notion. Every notion-* skill MUST delegate through this skill rather than invoking the Notion REST API or any Notion MCP directly. Resolves a substrate per operation in this order: (1) Notion MCP if authenticated and the configured prdDatabaseId is fetchable through it (identity-match), (2) curl + Bearer auth + internal-integration token. Verifies the active connection matches `.lisa.config.json` before every operation — substrates authenticated as a different Notion workspace are skipped, not used."
allowed-tools: ["Bash", "Read", "Skill"]
---

# Notion Access: $ARGUMENTS

Single chokepoint for all Notion operations. Routes each op to a substrate, enforces connection match, returns structured result. Caller skills (`notion-*`) MUST go through this — they MUST NOT call the Notion REST API or any `mcp__*notion*` tools directly.

## Invocation contract

```text
operation: read-page         id: <uuid>
operation: create-page       parent_database_id: <uuid> properties: {...} [children: [...]]  # create a new page (e.g. a PRD row) in a database; children is optional
operation: write-page        payload: {...}        # update page properties
operation: archive-page      id: <uuid>
operation: query-database    id: <uuid> filter: {...} sort: {...}
operation: read-database     id: <uuid>
operation: append-blocks     page_id: <uuid> children: [...]
operation: search            query: "..." [filter: { object: "page" }]
operation: list-users
operation: get-self
```

The skill returns either the structured operation result (JSON) or an error message prefixed with `Error:` and a remediation hint.

## Workflow

### Step 1 — Substrate selection (per operation)

Read config:

```bash
WORKSPACE=$(jq -r '.notion.workspaceId // empty' .lisa.config.json)
DB_ID=$(jq -r '.notion.prdDatabaseId // empty' .lisa.config.json)
[ -z "$WORKSPACE" ] && { echo "Error: notion.workspaceId not set. Run /lisa:setup:notion." >&2; exit 1; }
[ -z "$DB_ID" ]     && { echo "Error: notion.prdDatabaseId not set. Run /lisa:setup:notion." >&2; exit 1; }
```

Probe each tier in order; the first that's ready AND identity-matches is the substrate for this operation. Identity-match is verified before any operation; substrates authenticated as a different workspace are skipped, not used.

```bash
substrate=""

# Tier 1: Notion MCP (identity-matched by fetching the configured PRD database)
# Pseudo-code; actual call is the MCP tool invocation.
# Try to fetch DB_ID through the MCP. Success → MCP is authed to the right workspace.
# 404 / object_not_found → MCP is authed elsewhere (or unauthenticated). Skip.
if mcp_notion_can_fetch_database "$DB_ID"; then
  substrate="mcp"
fi

# Tier 2: curl + API token
read_notion_token() {
  local workspace="$1"
  [ -n "$NOTION_API_TOKEN" ] && { echo "$NOTION_API_TOKEN"; return; }
  local slug=$(echo "$workspace" | tr '[:upper:]-' '[:lower:]_')
  local varname="NOTION_API_TOKEN_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  case "$(uname -s)" in
    Darwin)  security find-generic-password -s lisa-notion -a "$workspace" -w 2>/dev/null ;;
    Linux)   command -v secret-tool >/dev/null && \
             secret-tool lookup service lisa-notion account "$workspace" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      LISA_CRED_TARGET="lisa-notion-${workspace}" powershell.exe -NoProfile -NonInteractive -Command '
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
TOKEN=$(read_notion_token "$WORKSPACE")
if [ -n "$TOKEN" ]; then
  # Verify token belongs to the configured workspace.
  me=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28" \
              "https://api.notion.com/v1/users/me")
  me_workspace=$(echo "$me" | jq -r '.bot.workspace_name // .bot.workspace_id // empty')
  if [ -n "$me_workspace" ] && [ "$me_workspace" = "$WORKSPACE" ]; then
    : ${substrate:=curl}
  elif [ -n "$me_workspace" ]; then
    echo "Warning: Notion token belongs to workspace '$me_workspace' but config declares '$WORKSPACE'. Skipping curl tier." >&2
  fi
fi

# Fail loudly with actionable remediation if nothing works.
if [ -z "$substrate" ]; then
  # Detect plugin enablement state for the suggestion.
  plugin_enabled_global=$(jq -r '.enabledPlugins["notion@claude-plugins-official"] // false' ~/.claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_project=$(jq -r '.enabledPlugins["notion@claude-plugins-official"] // false' .claude/settings.json 2>/dev/null || echo "false")
  plugin_enabled_local=$(jq -r '.enabledPlugins["notion@claude-plugins-official"] // false' .claude/settings.local.json 2>/dev/null || echo "false")

  cat >&2 <<EOF
Error: no Notion access substrate available for workspace '$WORKSPACE'.

Attempted:
  MCP    — $([ "$plugin_enabled_global" = "true" ] || [ "$plugin_enabled_project" = "true" ] || [ "$plugin_enabled_local" = "true" ] && echo "plugin enabled but not authenticated or cannot fetch configured prdDatabaseId" || echo "plugin not enabled in any settings.json scope")
  curl   — no NOTION_API_TOKEN found for $WORKSPACE (env, slug-suffixed env, or keychain) OR token belongs to a different workspace

Remediation paths (pick one):

1. Install the Notion MCP plugin (local scope — per-developer, gitignored).
   This is the simplest path for single-workspace developers.

   Run in your terminal:

     jq '.enabledPlugins["notion@claude-plugins-official"] = true' \\
       .claude/settings.local.json 2>/dev/null > /tmp/s && \\
       mv /tmp/s .claude/settings.local.json || \\
       echo '{"enabledPlugins":{"notion@claude-plugins-official":true}}' > .claude/settings.local.json

   Then restart Claude Code (or run /restart-mcp) to load the plugin, and
   invoke 'mcp__plugin_notion_notion__authenticate' to complete OAuth.
   Also share the configured prdDatabaseId with the integration via
   the page's '•••' menu → Connections.

2. Provision an internal-integration API token (headless / CI / multi-workspace).

     Run /lisa:setup:notion — guided flow with clipboard-piped keychain store.

EOF
  exit 1
fi
```

### Step 2 — Connection-match assertion

The substrate selection in Step 1 already verifies identity. This step is the explicit re-assertion before any operation runs — defensive in case substrate state changed since selection. For the curl tier, re-validate token-to-workspace pairing if more than a few minutes elapsed.

The workspace identifier stored in config is whatever stable string the user picked at setup time — typically `bot.workspace_name` (human-readable) for simplicity. If the workspace has been renamed in Notion, `setup-notion` re-detects and re-stores; the access skill surfaces the mismatch instead of silently authing as the wrong workspace.

### Step 3 — Operation dispatch

When `$substrate=mcp`, route through Notion MCP tools. When `$substrate=curl`, hit the Notion REST API directly. All curl calls use `https://api.notion.com/v1/<path>`, `Notion-Version: 2022-06-28`, `Authorization: Bearer $TOKEN`.

Substrate columns: try the column matching `$substrate` first. If that column is `—` for the requested operation (no adapter), fall through to the other substrate if it's also available. If neither has an adapter, the operation is unsupported.

| Operation | MCP adapter | curl adapter |
|---|---|---|
| **Pages** | | |
| `read-page id:<I>` | `mcp__claude_ai_Notion__notion-fetch` | `GET /v1/pages/<I>` |
| `create-page parent_database_id:<D> properties:<P> [children:<arr>]` | `mcp__claude_ai_Notion__notion-create-pages` | `POST /v1/pages` body `{ "parent": { "database_id": "<D>" }, "properties": <P>, "children": <arr?> }` |
| `write-page payload:<P>` | `mcp__claude_ai_Notion__notion-update-page` | `PATCH /v1/pages/<I>` body `{ "properties": {...}, "archived": true/false }` |
| `archive-page id:<I>` | `mcp__claude_ai_Notion__notion-update-page` (with `archived: true`) | `PATCH /v1/pages/<I>` body `{ "archived": true }` |
| `append-blocks page_id:<P> children:<arr>` | (no direct equivalent) | `PATCH /v1/blocks/<P>/children` body `{ "children": <arr> }` |
| **Databases** | | |
| `read-database id:<I>` | `mcp__claude_ai_Notion__notion-fetch` | `GET /v1/databases/<I>` |
| `query-database id:<I> filter:<F> sort:<S>` | `mcp__claude_ai_Notion__notion-search` (with collection scope) | `POST /v1/databases/<I>/query` body `{ "filter": <F>, "sorts": <S>, "page_size": <N> }` |
| **Comments** | | |
| `list-comments block_id:<I>` | (MCP lacks a generic list-comments tool) | `GET /v1/comments?block_id=<I>` |
| `create-comment page_id:<I> rich_text:<arr>` | `mcp__claude_ai_Notion__notion-create-comment` (page-level) | `POST /v1/comments` body `{ "parent": { "page_id": "<I>" }, "rich_text": <arr> }` |
| `create-comment-on-block block_id:<I> rich_text:<arr>` | `mcp__claude_ai_Notion__notion-create-comment` (with block anchor) | `POST /v1/comments` body `{ "parent": { "block_id": "<I>" }, "rich_text": <arr> }` |
| **Search & users** | | |
| `search query:<Q> [filter:<F>]` | `mcp__claude_ai_Notion__notion-search` | `POST /v1/search` body `{ "query": "<Q>", "filter": <F or null> }` |
| `list-users` | — | `GET /v1/users` |
| `get-self` | — | `GET /v1/users/me` |

Operations not in this table are unsupported — add an adapter row before invoking. Adapters MUST return parsed JSON; never raw HTTP responses.

### Step 4 — Return result

Wrap the JSON response in a `<result>` block for caller parsing. On HTTP non-2xx, prefix the error message with `Error:` and surface the HTTP status code plus Notion's response body verbatim.

```bash
exec_op() {
  local method="$1" path="$2" body="${3:-}"
  local args=( -s -X "$method"
    -H "Authorization: Bearer $TOKEN"
    -H "Notion-Version: 2022-06-28" )
  [ -n "$body" ] && args+=( -H "Content-Type: application/json" --data-binary "$body" )
  local code=$(curl "${args[@]}" -o /tmp/notion-resp -w "%{http_code}" \
    "https://api.notion.com/v1${path}")
  if [ "${code:0:1}" != "2" ]; then
    echo "Error: Notion API $method $path returned HTTP $code" >&2
    cat /tmp/notion-resp >&2
    return 1
  fi
  cat /tmp/notion-resp
}
```

## Invariants

- Caller skills never call `curl https://api.notion.com/...` or any `mcp__*notion*` tool directly. They invoke this skill via the Skill tool with an operation name and arguments.
- Substrate is selected per skill invocation following the tier ladder. The first tier that's available AND identity-matches `notion.workspaceId` wins.
- The connection-match check is mandatory at every tier. Skipping it (because "the user obviously meant this workspace") is forbidden — silent cross-workspace operations are exactly the multi-account hazard this design exists to prevent.
- API tokens never mutate. If the configured workspace's token is wrong or missing, fail loudly and tell the user to run `/lisa:setup:notion`.
- `Notion-Version` is pinned to `2022-06-28` — the version every existing notion-* skill targets. Bumping it is a coordinated change across the access skill and all callers.

## Headless behavior

In a headless / non-interactive context (no TTY, `CI=true`, or `-p` mode), the MCP tier is unavailable (its OAuth flow needs a browser). The ladder collapses to curl + `NOTION_API_TOKEN`. Same skill code runs identically; only the substrate changes.

## Per-page sharing prerequisite

Notion integrations only see pages that have been **explicitly shared** with them. If `read-page` or `query-database` returns a 404 or `object_not_found` error and the configured workspace is correct, the cause is almost always that the page/database wasn't shared with the integration. Surface this in the error message:

> Page <id> not visible to the integration. Open the page in Notion → "..." menu → Connections → add the lisa integration.

Do not paper over with a retry. Sharing is a one-time human action per database (or per page if the user prefers page-level sharing); failures here mean the user needs to act.

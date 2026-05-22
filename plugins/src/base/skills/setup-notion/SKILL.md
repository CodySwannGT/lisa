---
name: setup-notion
description: "Configure Notion as the PRD source for this project. Walks the user through creating an internal integration in the target workspace, sharing the PRD database with it, stores the resulting `ntn_*` token in OS keychain (multi-workspace-safe — keyed by workspaceId), validates against the Notion API, and writes `notion.workspaceId`, `notion.prdDatabaseId`, and `notion.values` into `.lisa.config.json`. Idempotent — re-runs update the existing section rather than duplicating it. Offers to set top-level `source: \"notion\"`."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Setup Notion: $ARGUMENTS

Provision Notion access for this project. After this skill runs, `.lisa.config.json` contains `notion.workspaceId` and `notion.prdDatabaseId`, and the OS keychain has a `lisa-notion` entry keyed by the workspaceId.

## Workflow

### Step 0 — Pick a setup path

Ask via `AskUserQuestion`:

> How do you want lisa to talk to Notion for this project?
>
> 1. **MCP-only (simplest)** — authenticate the Notion MCP once via browser OAuth; lisa uses it for every operation. Best for: single-workspace developers on a personal laptop. New developers onboard with one OAuth flow, no token sharing, no rotation pain when someone leaves. Skip the rest of this setup.
> 2. **MCP + internal-integration token (recommended for teams)** — MCP for interactive dev, internal-integration token in keychain for headless / CI / multi-workspace. Continue through token-create steps.
> 3. **Token-only (headless / CI)** — store a workspace-scoped internal-integration token in the OS keychain; lisa uses curl for everything. Best for: CI pipelines, headless containers. Continue through token-create steps.

If the user picks (1) and the MCP is already authenticated to the right workspace (verify by attempting to fetch the configured `prdDatabaseId` via the MCP — success means identity match), write only `notion.workspaceId`, `notion.prdDatabaseId`, and `notion.statusProperty` into `.lisa.config.json` and skip to Step 8 (top-level source offer). If the MCP isn't authed yet, instruct the user to run `mcp__claude_ai_Notion__authenticate` (or the plugin equivalent) and complete the OAuth flow, then re-verify. The PRD database still needs to be shared with the OAuth-granted access — Notion's per-page sharing model applies to OAuth identities the same way it does to internal-integration tokens.

If the user picks (2) or (3), continue through the rest of the steps; the token gets stored in addition to (or instead of) the MCP session.

### Step 1 — Open the Notion integration page

```bash
case "$(uname -s)" in
  Darwin) open "https://www.notion.so/profile/integrations" ;;
  Linux)  xdg-open "https://www.notion.so/profile/integrations" 2>/dev/null ;;
  MINGW*|MSYS*|CYGWIN*) start "https://www.notion.so/profile/integrations" ;;
esac
```

Print instructions for the user:

```
1. Click "New integration".
2. Name it: lisa-<project-name>  (e.g., lisa-gemini, lisa-acme — pick something descriptive).
3. Associated workspace: pick the workspace your PRDs live in.
4. Type: "Internal integration".
5. Capabilities: leave defaults (Read content, Update content, Insert content). No comment / user-info capabilities needed.
6. Click Save.
7. On the integration's detail page, click "Show" next to "Internal Integration Token".
8. Copy the token — starts with `ntn_`. Atlassian-style scoped tokens have a `=<CRC>` suffix; Notion's do NOT, but tokens are still 50+ chars. Watch for clipboard-truncation in some terminals.
```

### Step 2 — Identify the workspace

The user picks a stable identifier for this workspace. Two options:

- **Workspace name** (human-readable, e.g., `Gemini Sports`). Easy to recognize, can be ambiguous if a workspace is renamed in Notion. Recommended.
- **Workspace UUID** (returned by Notion's API). Stable but opaque.

Default to the workspace name. After the user stores the token (Step 4), Step 5's `/users/me` call surfaces the actual `bot.workspace_name`; if it differs from what the user typed (capitalization, trailing whitespace), prompt to confirm.

```bash
WORKSPACE=$(jq -r '.notion.workspaceId // empty' .lisa.config.json 2>/dev/null)
if [ -z "$WORKSPACE" ]; then
  # Prompt the user — accept any non-empty string. They pick the slug; we just store it.
  read -p "Workspace identifier (any stable slug, e.g. 'gemini-sports'): " WORKSPACE
fi
```

### Step 3 — Share the PRD database with the integration

This is **non-optional**. Notion's permission model is share-based — the integration cannot see any pages or databases until the user explicitly grants access.

Print instructions:

```
1. In Notion, navigate to your PRD database (or the parent page containing it).
2. Click the "..." menu in the top right of the database.
3. Click "Connections".
4. Find "lisa-<project>" in the list and click "Connect".
5. Confirm any prompts about granting access.

The connection cascades to all child pages of the database by default. New PRDs added under the database automatically inherit access.
```

If `--database=<uuid>` was passed in `$ARGUMENTS`, use it; otherwise prompt:

```bash
DATABASE_ID=$(jq -r '.notion.prdDatabaseId // empty' .lisa.config.json 2>/dev/null)
if [ -z "$DATABASE_ID" ]; then
  cat <<EOF
Paste the PRD database URL or ID:
  - URL form: https://notion.so/<workspace>/<database-id>?v=...
  - ID form:  32-char UUID with or without dashes
EOF
  read -p "Database: " DB_INPUT
  # Extract UUID from URL if needed.
  DATABASE_ID=$(echo "$DB_INPUT" | grep -oE '[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}' | head -1)
  if [ -z "$DATABASE_ID" ]; then
    echo "Error: could not extract a UUID from '$DB_INPUT'." >&2
    exit 1
  fi
fi
```

### Step 4 — Store the token via OS keychain (token never enters chat)

Same security posture as `setup-atlassian`. Print a platform-specific clipboard-pipe command for the user to run **in their own terminal**:

```bash
case "$(uname -s)" in
  Darwin)
    cat <<EOF
1. Copy the integration token from the Notion page.
2. Run this single line in your terminal (leading space keeps it out of zsh history):

    security delete-generic-password -s lisa-notion -a "$WORKSPACE" 2>/dev/null;  TOK="\$(pbpaste)"; security add-generic-password -U -s lisa-notion -a "$WORKSPACE" -w "\$TOK"; unset TOK

The token is piped from clipboard straight to keychain — never enters the prompt or chat.
EOF
    ;;
  Linux)
    if command -v secret-tool >/dev/null 2>&1; then
      if   command -v wl-paste >/dev/null 2>&1; then CLIP=wl-paste
      elif command -v xclip    >/dev/null 2>&1; then CLIP="xclip -selection clipboard -o"
      elif command -v xsel     >/dev/null 2>&1; then CLIP="xsel --clipboard --output"
      else CLIP="cat"
      fi
      cat <<EOF
1. Copy the integration token.
2. Run this in your terminal:

   secret-tool clear service lisa-notion account "$WORKSPACE" 2>/dev/null; printf '%s' "\$($CLIP)" | secret-tool store --label="Lisa Notion ($WORKSPACE)" service lisa-notion account "$WORKSPACE"

(If no clipboard tool is installed: the command reads from stdin — paste, Ctrl-D.)
EOF
    else
      cat <<EOF
libsecret / secret-tool not installed. Options:
  1. Install: sudo apt install libsecret-tools  (then re-run /lisa:setup:notion).
  2. Env-var fallback (headless / CI / Docker):
       export NOTION_API_TOKEN_$(echo "$WORKSPACE" | tr '[:upper:]-' '[:lower:]_')="<paste-token>"
     Plaintext on disk — only acceptable on ephemeral / CI environments.
EOF
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    cat <<EOF
PowerShell:

  \$tok = Get-Clipboard; cmdkey /generic:"lisa-notion-$WORKSPACE" /user:"$WORKSPACE" /pass:"\$tok"; Remove-Variable tok
EOF
    ;;
esac
```

**Never accept the token via chat or stdin into this skill.** Wait for the user to confirm storage.

### Step 5 — Verify the token + workspace match

Use the same lookup ladder `notion-access` uses:

```bash
read_notion_token() {
  local workspace="$1"
  [ -n "$NOTION_API_TOKEN" ] && { echo "$NOTION_API_TOKEN"; return; }
  local slug=$(echo "$workspace" | tr '[:upper:]-' '[:lower:]_')
  local varname="NOTION_API_TOKEN_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  case "$(uname -s)" in
    Darwin)  security find-generic-password -s lisa-notion -a "$workspace" -w 2>/dev/null ;;
    Linux)   command -v secret-tool >/dev/null && secret-tool lookup service lisa-notion account "$workspace" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*) cmdkey /list:"lisa-notion-${workspace}" 2>/dev/null | grep Password | awk '{print $NF}' ;;
  esac
}

TOKEN=$(read_notion_token "$WORKSPACE")
if [ -z "$TOKEN" ]; then
  echo "Error: token not retrievable after store. Re-run Step 4." >&2
  exit 1
fi

# Notion tokens — sanity length check. Internal-integration tokens are ~50+ chars; if drastically shorter, a paste truncation happened.
if [ ${#TOKEN} -lt 40 ]; then
  echo "Warning: token is ${#TOKEN} chars — Notion tokens are typically 50+. Possible truncation." >&2
fi

ME=$(curl -s -H "Authorization: Bearer $TOKEN" \
            -H "Notion-Version: 2022-06-28" \
            "https://api.notion.com/v1/users/me")
ME_WORKSPACE=$(echo "$ME" | jq -r '.bot.workspace_name // empty')

if [ -z "$ME_WORKSPACE" ]; then
  echo "Error: token failed Notion /users/me probe. Response: $ME" >&2
  exit 1
fi

# If the user typed a workspace name that differs from what Notion returns, prompt to align.
if [ "$ME_WORKSPACE" != "$WORKSPACE" ]; then
  cat <<EOF
The token belongs to workspace '$ME_WORKSPACE', but you provided '$WORKSPACE' as the identifier.
Use the Notion-returned name for consistency? (recommended — connection-match check uses this string)
EOF
  # AskUserQuestion: replace WORKSPACE with $ME_WORKSPACE? recommended yes
fi

# Verify database visibility too (Notion's share model means the token sees only what's been shared).
DB_PROBE=$(curl -s -o /tmp/setup-notion-db -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/databases/$DATABASE_ID")
if [ "$DB_PROBE" != "200" ]; then
  cat >&2 <<EOF
Error: integration cannot see database $DATABASE_ID (HTTP $DB_PROBE).
The most likely cause is that you skipped Step 3 — sharing the database with the integration.
Open the database in Notion → "..." → Connections → add 'lisa-<project>' → retry.
EOF
  exit 1
fi

echo "Token validated. Workspace: $ME_WORKSPACE. Database visible."
```

### Step 6 — Detect lifecycle value names

Read the database schema and find the `Status` property's value list. Compare to lisa defaults and prompt for overrides if names differ.

```bash
DB_SCHEMA=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Notion-Version: 2022-06-28" \
  "https://api.notion.com/v1/databases/$DATABASE_ID")
STATUS_PROP=$(jq -r '.properties | to_entries[] | select(.value.type == "status" or .value.type == "select") | .key' <<<"$DB_SCHEMA" | head -1)
STATUS_VALUES=$(jq -r --arg p "$STATUS_PROP" '.properties[$p] | (.status.options // .select.options) | .[].name' <<<"$DB_SCHEMA")
```

For each lisa role (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`), check if its default name (`Draft`, `Ready`, etc.) appears in `$STATUS_VALUES`. If a role's default is missing but a similar-looking value exists, prompt the user to map it via `AskUserQuestion`. If a role has no plausible match, prompt to either create the value in Notion or accept that the lifecycle stage is unrepresented.

Collect overrides as a partial values map. Only write keys that differ from defaults.

### Step 7 — Write `.lisa.config.json`

```bash
jq --arg ws "$WORKSPACE" --arg db "$DATABASE_ID" --arg sp "$STATUS_PROP" --argjson values "$VALUES_JSON" '
  .notion = ((.notion // {})
    | .workspaceId = $ws
    | .prdDatabaseId = $db
    | (if $sp != "" then .statusProperty = $sp else . end)
    | (if $values != {} then .values = $values else . end))
' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

`VALUES_JSON` is `{}` if all roles use the default names; otherwise contains only the overrides.

### Step 8 — Offer to set top-level `source`

If `.source` is unset or differs from `"notion"`, ask via `AskUserQuestion`:

> Notion is configured. Set top-level `source: "notion"` so `/lisa:intake` (with no args) scans this database for PRDs?

If yes:

```bash
jq '.source = "notion"' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

### Step 9 — Verify

```bash
jq -e '.notion.workspaceId and .notion.prdDatabaseId' .lisa.config.json >/dev/null
echo "Token validated (${#TOKEN} chars). Workspace: $ME_WORKSPACE. Database: $DATABASE_ID."
```

Report success with the resolved workspace, database, status property name, and value overrides (if any). Direct the user to `/lisa:intake` to test.

## Idempotency

- Re-running this skill replaces fields in the `notion` section without disturbing others. The keychain entry update in Step 4 is the user's manual action — they re-run the same `security` / `secret-tool` / `cmdkey` command.
- If `notion.workspaceId` and `notion.prdDatabaseId` already exist in config, skip the prompts in Steps 2–3 and go straight to verification.

## Rules

- Never write the token to `.lisa.config.json`. Tokens stay in keychain or env.
- Never accept a token via this skill's stdin. Always go through the platform's clipboard-pipe pattern so the value never enters the LLM context.
- Never auto-create the Notion integration via API — Notion offers no programmatic creation flow, and adding one would require building lisa as a public OAuth app (out of scope here).
- Never proceed past Step 5 with an unverified token + workspace. Silent cross-workspace operations are exactly the multi-account hazard this design exists to prevent.
- If the user has multiple Notion accounts, each project's `.lisa.config.local.json` `notion.workspaceId` is the sole disambiguator. There is no "active workspace" concept on the Notion side — the token IS the workspace binding.

---
name: setup-linear
description: "Configure Linear as the destination tracker and/or the PRD source for this project. Verifies Linear access (MCP OAuth or a personal API key in OS keychain), resolves the workspace slug and team key, scaffolds the build-queue issue-label namespace (`status:*`) when Linear is the tracker and/or the PRD-lifecycle project-label namespace (`prd-*` + issue-level sentinel) when Linear is the PRD source, writes the `linear` section into `.lisa.config.json`, and offers to set top-level `tracker: \"linear\"` and/or `source: \"linear\"`. Idempotent — re-running updates the existing section and reuses existing labels. No /lisa:setup:atlassian prerequisite."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion", "mcp__linear-server__authenticate", "mcp__linear-server__complete_authentication", "mcp__linear-server__list_teams", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label", "mcp__linear-server__list_project_labels", "mcp__linear-server__create_project_label"]
---

# Setup Linear: $ARGUMENTS

Make Linear a tracker, a PRD source, or both for this project. After this skill, `.lisa.config.json` contains `linear.workspace` (+ `linear.teamKey` when Linear is the tracker), the team carries the lifecycle label namespaces lisa needs, and (optionally) `tracker` / `source` point at Linear.

Linear's data model splits labels into two **kinds** that matter here: **issue labels** (drive the build queue, `status:*`) and **project labels** (drive the PRD lifecycle, `prd-*`). They are distinct namespaces in Linear and are NOT interchangeable — the build lifecycle lives on Issues, the PRD lifecycle lives on Projects. The sentinel feedback marker is an **issue** label even though it belongs to the PRD flow (Linear's MCP has no project-level comments — see `linear-prd-intake`).

## Workflow

### Step 0 — Pick a setup path AND what Linear is for

Ask two things via `AskUserQuestion`.

**Access path:**

> How should lisa talk to Linear for this project?
>
> 1. **MCP-only (simplest)** — authenticate the Linear MCP once via browser OAuth; lisa uses it for every operation. Best for single-workspace developers on a personal laptop.
> 2. **MCP + API key (recommended for teams)** — MCP for interactive dev, a personal API key in keychain for headless / CI. Continue through key-store steps.
> 3. **API-key-only (headless / CI)** — store a personal API key in the OS keychain; lisa uses curl against the Linear GraphQL API. Best for pipelines / containers.

**Role** (multiSelect):

> What should lisa use Linear for?
>
> 1. **Destination tracker** — lisa writes Epics→Projects, Stories→Issues, Sub-tasks→Sub-issues; the build queue runs off the `status:*` issue-label namespace. Sets `tracker: "linear"`. (Requires a team key.)
> 2. **PRD source** — humans flag Linear **projects** with `prd-ready`; `/lisa:intake` scans and ticketes them off the `prd-*` project-label namespace. Sets `source: "linear"`.

The role answer drives Step 3 (which label namespaces to scaffold) and whether `teamKey` is required (tracker → yes).

### Step 1 — Establish Linear access

#### MCP path (1 or 2)

Verify the Linear MCP is authenticated to the right workspace by listing teams:

```text
mcp__linear-server__list_teams({})
```

If it errors / returns nothing, run `mcp__linear-server__authenticate` and have the user complete OAuth in the browser, then `mcp__linear-server__complete_authentication`, then re-list. A non-empty team list confirms the MCP is authed to a readable workspace.

#### API-key path (2 or 3)

Linear personal API keys are created at **Linear → Settings → Security & access → Personal API keys** (or `https://linear.app/<workspace>/settings/account/security`). Store the key in the OS keychain keyed by the workspace slug, using the clipboard-pipe pattern (key never enters chat), mirroring `setup-notion`:

```bash
case "$(uname -s)" in
  Darwin)
    cat <<EOF
1. Copy the Linear API key (starts with 'lin_api_').
2. Run this single line (leading space keeps it out of zsh history):

    security delete-generic-password -s lisa-linear -a "$WORKSPACE" 2>/dev/null;  TOK="\$(pbpaste)"; security add-generic-password -U -s lisa-linear -a "$WORKSPACE" -w "\$TOK"; unset TOK
EOF
    ;;
  Linux)
    cat <<EOF
secret-tool clear service lisa-linear account "$WORKSPACE" 2>/dev/null; printf '%s' "\$(wl-paste 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null)" | secret-tool store --label="Lisa Linear ($WORKSPACE)" service lisa-linear account "$WORKSPACE"
(no clipboard tool? the command reads stdin — paste, then Ctrl-D. Or env-var fallback: export LINEAR_API_KEY_$(echo "$WORKSPACE" | tr '[:upper:]-' '[:lower:]_')="<key>")
EOF
    ;;
  MINGW*|MSYS*|CYGWIN*)
    cat <<EOF
PowerShell: \$tok = Get-Clipboard; cmdkey /generic:"lisa-linear-$WORKSPACE" /user:"$WORKSPACE" /pass:"\$tok"; Remove-Variable tok
EOF
    ;;
esac
```

**Never accept the key via this skill's chat or stdin.** After the user confirms storage, retrieve via the lookup ladder (env → workspace-suffixed env → keychain) and validate against the GraphQL API:

```bash
read_linear_key() {  # $1=workspace slug
  local ws="$1"
  [ -n "$LINEAR_API_KEY" ] && { echo "$LINEAR_API_KEY"; return; }
  local slug; slug=$(echo "$ws" | tr '[:upper:]-' '[:lower:]_')
  local varname="LINEAR_API_KEY_${slug}"
  [ -n "${!varname}" ] && { echo "${!varname}"; return; }
  case "$(uname -s)" in
    Darwin)  security find-generic-password -s lisa-linear -a "$ws" -w 2>/dev/null ;;
    Linux)   command -v secret-tool >/dev/null && secret-tool lookup service lisa-linear account "$ws" 2>/dev/null ;;
    MINGW*|MSYS*|CYGWIN*) cmdkey /list:"lisa-linear-${ws}" 2>/dev/null | grep Password | awk '{print $NF}' ;;
  esac
}

KEY=$(read_linear_key "$WORKSPACE")
[ -z "$KEY" ] && { echo "Error: key not retrievable from any source. Re-run the store step." >&2; exit 1; }

# Validate: viewer query. Personal API keys go in the Authorization header verbatim (no 'Bearer').
VIEWER=$(curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $KEY" -H "Content-Type: application/json" \
  -d '{"query":"{ viewer { id name } organization { urlKey name } }"}')
if ! echo "$VIEWER" | jq -e '.data.viewer.id' >/dev/null 2>&1; then
  echo "Error: API key failed the Linear viewer probe. Response: $VIEWER" >&2
  exit 1
fi
echo "Linear key validated. Org: $(echo "$VIEWER" | jq -r '.data.organization.urlKey')"
```

### Step 2 — Resolve workspace slug + team key

- **Workspace slug**: honor `--workspace=<slug>`. Otherwise derive from the validated identity — the GraphQL `organization.urlKey` (API path) or the team list's workspace (MCP path). Confirm with the user; this slug is the keychain `account` key and the multi-workspace disambiguator.
- **Team key** (required when Linear is the **tracker**): honor `--team=<KEY>`. Otherwise enumerate teams via `mcp__linear-server__list_teams({})` (or the GraphQL `teams` query) and present them via `AskUserQuestion` (label = team key, description = team name) for the user to pick the team that owns lisa's destination Issues. If Linear is source-only, `teamKey` is optional — skip unless the user wants to pin a team scope.

### Step 3 — Scaffold the lifecycle label namespaces

Read role → label with the default-fallback ladder the intake skills use, so scaffolded labels match exactly what they query.

```bash
read_role() {  # $1=namespace (build|prd) $2=role $3=default
  local ns="$1" role="$2" default="$3" local_v global_v
  local_v=$(jq -r ".linear.labels.${ns}.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.labels.${ns}.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
```

#### 3a. Build-queue labels — ISSUE labels (only if Linear is the tracker)

Probe with `mcp__linear-server__list_issue_labels` (scoped to the team). For each role's resolved name, create it via `mcp__linear-server__create_issue_label` only if absent. The `done` role is env-keyed — create all three defaults; collapse to a single string in config later if the project's terminal state is env-independent.

| Role | Default | 
|------|---------|
| `ready` | `status:ready` |
| `claimed` | `status:in-progress` |
| `review` | `status:code-review` |
| `blocked` | `status:blocked` |
| `done.dev` | `status:on-dev` |
| `done.staging` | `status:on-stg` |
| `done.production` | `status:done` |

#### 3b. PRD-lifecycle labels — PROJECT labels (only if Linear is the PRD source)

Probe with `mcp__linear-server__list_project_labels`. Create missing ones via `mcp__linear-server__create_project_label`. These are a **separate label kind** from issue labels — creating an issue label of the same name will NOT work for the PRD flow.

| Role | Default | Kind |
|------|---------|------|
| `draft` | `prd-draft` | project label |
| `ready` | `prd-ready` | project label |
| `in_review` | `prd-in-review` | project label |
| `blocked` | `prd-blocked` | project label |
| `ticketed` | `prd-ticketed` | project label |
| `shipped` | `prd-shipped` | project label |
| `sentinel` | `prd-intake-feedback` | **issue** label (marks the sentinel feedback issue — create via `create_issue_label`) |

#### 3c. Handle name collisions / renames

If the team already uses a differently-named label for a role, do not create a duplicate — present the existing labels via `AskUserQuestion`, map the role to the existing label, and record the mapping as a config override (Step 4).

### Step 4 — Write `.lisa.config.json`

`linear.workspace` (and `linear.teamKey` when tracker) are project-wide → committed. Write **only label keys that differ from defaults**.

```bash
touch .lisa.config.json
[ -s .lisa.config.json ] || echo '{}' > .lisa.config.json

jq --arg ws "$WORKSPACE" \
   '.linear = ((.linear // {}) | .workspace = $ws)' \
   .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# teamKey only when Linear is the tracker (or the user pinned a team scope).
if [ -n "$TEAM_KEY" ]; then
  jq --arg tk "$TEAM_KEY" '.linear.teamKey = $tk' \
     .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
fi

# Conditionally write label overrides (only non-default role names).
if [ -n "$LABEL_OVERRIDES_JSON" ] && [ "$LABEL_OVERRIDES_JSON" != "{}" ]; then
  jq --argjson o "$LABEL_OVERRIDES_JSON" \
     '.linear.labels = ((.linear.labels // {}) * $o)' \
     .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
fi
```

No secrets in config — the API key stays in keychain / `LINEAR_API_KEY`, the MCP session in its own store.

### Step 5 — Offer to set top-level `tracker` / `source`

For each role selected in Step 0, offer the matching top-level flag (skip if already pointing at Linear).

If **tracker** selected and `.tracker` ≠ `"linear"`: ask "Set top-level `tracker: \"linear\"` so vendor-neutral skills write Issues here?" → `jq '.tracker = "linear"'`.

If **source** selected and `.source` ≠ `"linear"`: ask "Set top-level `source: \"linear\"` so `/lisa:intake` (no args) scans this workspace for `prd-ready` projects?" → `jq '.source = "linear"'`.

Both are project-wide — never set without explicit confirmation.

### Step 6 — Verify

```bash
jq -e '.linear.workspace' .lisa.config.json >/dev/null
# If tracker: also require teamKey.
[ "$(jq -r '.tracker // empty' .lisa.config.json)" = "linear" ] && jq -e '.linear.teamKey' .lisa.config.json >/dev/null
```

Confirm the scaffolded labels are present (`list_issue_labels` for `status:*` + the sentinel; `list_project_labels` for `prd-*`). Report success with the resolved workspace, team key (if any), which namespaces were scaffolded (created vs. already existed), any non-default overrides, and whether `tracker` / `source` were set. Direct the user to `/lisa:intake` to test.

## Idempotency

- Re-running merges the `linear` section's fields rather than appending — `jq` merge throughout.
- Label creation is find-or-create per kind; existing labels are left untouched, so re-runs never churn human-customized labels.
- Re-running does not re-prompt for `tracker` / `source` if they already point at Linear. The keychain store in Step 1 is the user's manual action — they re-run the same `security` / `secret-tool` / `cmdkey` command.

## Rules

- Never write the API key to `.lisa.config.json`. It stays in keychain or `LINEAR_API_KEY`.
- Never accept the API key via this skill's stdin/chat — always the platform clipboard-pipe pattern, so the value never enters the LLM context.
- Never conflate the two label kinds: build labels are **issue** labels, PRD labels are **project** labels. The sentinel is an issue label. Creating the wrong kind silently breaks the corresponding intake flow.
- Never create a duplicate label for a role that already has a (differently-named) label — map and record an override instead.
- Never set `tracker` / `source` without explicit confirmation — they're project-wide switches.
- Never invent a workspace slug or team key. Derive from the validated identity / team list and confirm; if resolution fails, ask the user.

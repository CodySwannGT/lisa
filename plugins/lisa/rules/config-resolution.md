# Config Resolution

Lisa is vendor-agnostic. PRDs can be sourced from Notion, Confluence, Linear, GitHub Issues, or JIRA. Tickets can be written to JIRA, GitHub Issues, or Linear. Per-project configuration lives in `.lisa.config.json` at the repo root, with optional `.lisa.config.local.json` overriding on a per-key basis.

This rule is the single source of truth for the `.lisa.config.json` schema, the resolution algorithm, and the dispatch tables every vendor-neutral skill follows.

## File location and precedence

Read configuration from the repo root in this order:

1. `.lisa.config.local.json` — gitignored, per-developer overrides (e.g., a developer running with a different destination tracker for one branch).
2. `.lisa.config.json` — committed, project-wide settings.

Local overrides global on a **per-key basis**: missing keys in `.lisa.config.local.json` fall through to `.lisa.config.json`. Use `jq` from Bash for all reads — never hand-parse JSON.

A typical Bash read:

```bash
local_value=$(jq -r '.tracker // empty' .lisa.config.local.json 2>/dev/null)
global_value=$(jq -r '.tracker // empty' .lisa.config.json 2>/dev/null)
tracker="${local_value:-${global_value}}"
if [ -z "$tracker" ]; then
  echo "Error: 'tracker' not set in .lisa.config.json. Run /lisa:setup:jira (or :github, :linear) to configure." >&2
  exit 1
fi
```

`tracker` is **required** — there is no implicit default. Projects must declare their destination explicitly via one of the `/lisa:setup:*` skills.

## Schema

```json
{
  "tracker": "jira",
  "source":  "notion",

  "atlassian":  { "cloudId": "<uuid>", "site": "<host>" },
  "jira": {
    "project": "<KEY>",
    "workflow": {
      "ready":   "Ready",
      "claimed": "In Progress",
      "review":  "Code Review",
      "blocked": "Blocked",
      "done":    { "dev": "On Dev", "staging": "On Stg", "production": "Done" }
    }
  },
  "confluence": {
    "spaceKey": "<KEY>",
    "parentPageId": "<id>",
    "parents": {
      "draft":     "<page-id>",
      "ready":     "<page-id>",
      "in_review": "<page-id>",
      "blocked":   "<page-id>",
      "ticketed":  "<page-id>",
      "shipped":   "<page-id>"
    },
    "dashboardPageId": "<page-id>",
    "feedbackPageId":  "<page-id>"
  },
  "github": {
    "org": "<org-or-user>",
    "repo": "<repo>",
    "labels": {
      "build": {
        "ready":   "status:ready",
        "claimed": "status:in-progress",
        "review":  "status:code-review",
        "blocked": "status:blocked",
        "done":    { "dev": "status:on-dev", "staging": "status:on-stg", "production": "status:done" }
      },
      "prd": {
        "draft": "prd-draft",
        "ready": "prd-ready", "in_review": "prd-in-review",
        "blocked": "prd-blocked", "ticketed": "prd-ticketed",
        "shipped": "prd-shipped",
        "sentinel": "prd-intake-feedback"
      }
    }
  },
  "notion": {
    "workspaceId":    "<workspace-uuid-or-human-slug>",
    "prdDatabaseId":  "<uuid>",
    "statusProperty": "Status",
    "values": {
      "draft": "Draft", "ready": "Ready", "in_review": "In Review",
      "blocked": "Blocked", "ticketed": "Ticketed", "shipped": "Shipped"
    }
  },
  "linear": {
    "workspace": "<workspace-slug>",
    "teamKey": "<TEAM>",
    "labels": {
      "build": {
        "ready":   "status:ready",
        "claimed": "status:in-progress",
        "review":  "status:code-review",
        "blocked": "status:blocked",
        "done":    { "dev": "status:on-dev", "staging": "status:on-stg", "production": "status:done" }
      },
      "prd": {
        "draft": "prd-draft",
        "ready": "prd-ready", "in_review": "prd-in-review",
        "blocked": "prd-blocked", "ticketed": "prd-ticketed",
        "shipped": "prd-shipped",
        "sentinel": "prd-intake-feedback"
      }
    }
  },

  "deploy": {
    "branches": {
      "dev":        "dev",
      "staging":    "staging",
      "production": "main"
    }
  }
}
```

### Top-level fields

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `tracker` | **yes** | — | Destination for ticket writes. One of `"jira"`, `"github"`, `"linear"`. Missing → fail with instruction to run the matching `/lisa:setup:*` skill. |
| `source` | no | — | Default PRD source for batch skills (`/lisa:intake`) and arg-less single-PRD skills. One of `"notion"`, `"confluence"`, `"linear"`, `"github"`, `"jira"`. Explicit URLs/keys passed to a skill always win over `source`; this is a default, not a lock. |

### Vendor sections

Each vendor section is **conditionally required**: required only when that vendor is referenced as `tracker`, as `source`, or by an explicit invocation. Skills validate their own required keys at entry and stop with a clear error if missing — never invent values.

#### `atlassian`

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `atlassian.cloudId` | `tracker = "jira"`, `source = "jira"`, `source = "confluence"`, or any `confluence-*` / `jira-*` skill is invoked | **committed** (`.lisa.config.json`) | Atlassian Cloud site UUID. Same for every developer on the project. Resolve once via `curl https://<site>/_edge/tenant_info` or `getAccessibleAtlassianResources`. Shared between JIRA and Confluence (same Atlassian site). |
| `atlassian.site` | same as above | **committed** | Human-readable site URL (e.g. `propswap.atlassian.net`). Same for every developer. |
| `atlassian.email` | when the developer's machine has multiple Atlassian accounts that can access the configured site | **local** (`.lisa.config.local.json`) | Per-developer. `--site` alone cannot disambiguate which acli profile to switch to when two accounts both have access to the same site (e.g., a personal account and a work account both invited to a customer's site). The setup skill writes this to the local override file, NEVER the committed file. |

#### `jira`

| Field | Required when | Notes |
|-------|---------------|-------|
| `jira.project` | `tracker = "jira"` or any `jira-*` skill is invoked | JIRA project key (e.g. `SE`, `ENG`). |

#### `confluence`

| Field | Required when | Notes |
|-------|---------------|-------|
| `confluence.spaceKey` | `source = "confluence"` and `parentPageId` is not set | Confluence space key (e.g. `ENG`). |
| `confluence.parentPageId` | `source = "confluence"` and `spaceKey` is not set | Confluence parent page ID. Either `spaceKey` or `parentPageId` must be set; both is allowed (parent page ID narrows the scope). |

#### `github`

| Field | Required when | Notes |
|-------|---------------|-------|
| `github.org` | `tracker = "github"` or `source = "github"` or any `github-*` skill is invoked | GitHub organization or user name. |
| `github.repo` | same as above | GitHub repository name. |

When `tracker = "github"` AND `source = "github"` (self-host), both reads and writes hit the same GitHub repo. Label namespaces are kept separate so the two flows don't collide — see "Self-host edge case" below.

#### `notion`

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `notion.workspaceId` | `source = "notion"` | **committed** | Workspace identifier (Notion workspace UUID, or a stable human slug the user picks at setup). Same for every developer on the project. Used as the keychain `account` value when looking up the Notion API token, so each project's `notion-access` finds the right per-workspace token. |
| `notion.prdDatabaseId` | `source = "notion"` | **committed** | Notion database ID (UUID, dashes optional). The database is the PRD queue. Same for every developer on the project. |
| `notion.statusProperty` | `source = "notion"` | **committed** | Name of the database property that drives the lifecycle. Defaults to `"Status"` if absent. |
| `notion.values` | optional | **committed** | Map of role → Notion status-value name (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`). Defaults match the role names in title case. Override here if your Notion DB uses different value names. |

#### `linear`

| Field | Required when | Notes |
|-------|---------------|-------|
| `linear.workspace` | `tracker = "linear"`, `source = "linear"`, or any `linear-*` skill is invoked | Linear workspace slug (e.g. `acme`). |
| `linear.teamKey` | `tracker = "linear"` | Linear team key (e.g. `ENG`). The team owns the destination Issues. For source mode, projects are workspace-scoped or team-scoped per the URL passed. |

## Workflow & vocabulary roles

Every lifecycle skill operates on a fixed set of **roles** (`ready`, `claimed`, `done`, etc.), not concrete status/label strings. The role → string mapping lives in the per-vendor section above, with defaults that match the legacy hardcoded names. A project that uses different names overrides the relevant key; everything else inherits.

### Roles

**Build lifecycle** (work items):

| Role | What it means | JIRA default | GitHub/Linear default |
|---|---|---|---|
| `ready` | Human signal "this is buildable; agent may claim" | `Ready` (status) | `status:ready` (label) |
| `claimed` | Agent has picked the item up | `In Progress` (status) | `status:in-progress` (label) |
| `review` | Build complete, in code review | `Code Review` (status) | `status:code-review` (label) |
| `blocked` | Agent stopped on triage ambiguities or external blocker | `Blocked` (status) | `status:blocked` (label) |
| `done` | Terminal state for this work, **env-keyed** | map of env → status | map of env → label |

`review` is required for label-driven systems (GitHub, Linear) because that's how the agent signals "PR opened, awaiting human review." For JIRA, `review` is optional — projects that keep the ticket in `claimed` until terminal can omit it and lifecycle skills will skip the intermediate transition.

`blocked` is what every vendor agent flips to when triage finds unresolved ambiguities or the build path is blocked by something the agent can't resolve. Different from `claimed` because it explicitly signals "human attention required."

**PRD lifecycle** (specifications):

| Role | What it means | Notion default | Confluence/GitHub/Linear default |
|---|---|---|---|
| `draft` | Author drafting; agent ignores until promoted to `ready` | `Draft` (status) | `prd-draft` (GitHub/Linear label); parent-page lookup (Confluence) |
| `ready` | "Ready for ticketing"; agent claims | `Ready` (status) | `prd-ready` (label) |
| `in_review` | Agent has claimed and is validating | `In Review` (status) | `prd-in-review` (label) |
| `blocked` | Validation failed; clarifying-comments posted | `Blocked` (status) | `prd-blocked` (label) |
| `ticketed` | Validated and tickets created | `Ticketed` (status) | `prd-ticketed` (label) |
| `shipped` | All child tickets shipped | `Shipped` (status) | `prd-shipped` (label) |
| `sentinel` | (PRD-intake feedback issue marker, GitHub/Linear self-host only) | — | `prd-intake-feedback` |

### Env-keyed `done`

The `done` role is special: the terminal status/label depends on which environment a PR was merged into. A hotfix to staging ends at `On Stg`; a production hotfix ends at `Done`. So `done` is a **map** keyed by env name (`dev`, `staging`, `production`).

Skills that transition to `done` MUST resolve the env first:

1. **Explicit caller arg** (`target_env=staging`) — always wins.
2. **Branch inference** — derive from the PR's base branch via `deploy.branches`. Reverse-lookup: if base branch is `staging`, env is `staging`.
3. **Failure** — if neither resolves and `done` is a map, fail loudly. Never pick arbitrarily.

If a project's terminal state is the same regardless of env, set `done` to a string instead of a map (lifecycle skills accept either shape).

The true terminal `done` value is also the only value that triggers provider-native closure / resolution per `leaf-only-lifecycle`:

- If `done` is a string, that value is terminal.
- If `done` is an env-keyed map, the production / final environment's value is terminal. The conventional key is `production`; project-specific final env names must be explicit in deploy config or the lifecycle skill must fail rather than guessing.
- Intermediate env values (`dev`, `staging`, or configured equivalents) are deployment waypoints. Applying them must not close / resolve / complete the native tracker item.

### What's configurable, what's not

- **Status / label NAMES** are configurable per project — that's the point of the vocabulary maps.
- **Role SEMANTICS and TRANSITIONS** are not. The build lifecycle is always `ready → claimed → done` (with optional `review` for label-driven systems). The PRD lifecycle is always `ready → in_review → (blocked | ticketed) → shipped`. Lisa skills hardcode these transitions because they encode the design intent of the framework, not the project's preferences.
- **Extra statuses/labels** the project uses outside these roles are fine — lisa never touches them.

### Defaults vs. requirements

Vocabulary maps are **optional** in `.lisa.config.json`. Missing keys inherit the defaults shown in the schema above. The setup skills probe the project's actual workflow / labels at setup time and either:

- Confirm the default name exists → proceed silently.
- Confirm a different name exists (e.g., `Resolved` instead of `Done`) → prompt the user to either rename in the tracker or override the key in config.
- Find nothing matching → stop and ask the user to (a) create the missing status/label in the tracker, or (b) provide the actual name to write into config.

## Resolution algorithm

Every `tracker-*` shim and every vendor-neutral caller follows this:

1. Read `.lisa.config.local.json` first (if present), then `.lisa.config.json`. Local overrides global on a per-key basis. Use `jq` — never hand-parse JSON.
2. Extract the `tracker` field. If missing or null, stop and report: `"'tracker' is not set in .lisa.config.json. Run /lisa:setup:jira (or :github, :linear) to configure."`
3. Dispatch:
   - `tracker = "jira"` → delegate to the matching `jira-*` skill. Validate `atlassian.cloudId` and `jira.project` are present.
   - `tracker = "github"` → delegate to the matching `github-*` skill. Validate `github.org` and `github.repo` are present.
   - `tracker = "linear"` → delegate to the matching `linear-*` skill. Validate `linear.workspace` and `linear.teamKey` are present.
4. Any other value: stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`

For batch skills that consume `source`:

1. If `$ARGUMENTS` contains an explicit URL or key, parse the source vendor from it (always wins).
2. If `$ARGUMENTS` is the bare token `notion` / `confluence` / `linear` / `github` / `jira`, the source is that vendor; resolve location from the corresponding config section.
3. If `$ARGUMENTS` is empty, fall back to `source` from config; if that's also empty, stop and report `"No source specified and no 'source' field in .lisa.config.json."`

## Skill mapping

The shim → vendor mapping is fixed:

| Shim | jira tracker | github tracker | linear tracker |
|------|--------------|----------------|----------------|
| `lisa:tracker-write` | `lisa:jira-write-ticket` | `lisa:github-write-issue` | `lisa:linear-write-issue` |
| `lisa:tracker-validate` | `lisa:jira-validate-ticket` | `lisa:github-validate-issue` | `lisa:linear-validate-issue` |
| `lisa:tracker-verify` | `lisa:jira-verify` | `lisa:github-verify` | `lisa:linear-verify` |
| `lisa:tracker-read` | `lisa:jira-read-ticket` | `lisa:github-read-issue` | `lisa:linear-read-issue` |
| `lisa:tracker-evidence` | `lisa:jira-evidence` | `lisa:github-evidence` | `lisa:linear-evidence` |
| `lisa:tracker-sync` | `lisa:jira-sync` | `lisa:github-sync` | `lisa:linear-sync` |
| `lisa:tracker-add-journey` | `lisa:jira-add-journey` | `lisa:github-add-journey` | `lisa:linear-add-journey` |
| `lisa:tracker-journey` | `lisa:jira-journey` | `lisa:github-journey` | `lisa:linear-journey` |
| `lisa:tracker-create` | `lisa:jira-create` | `lisa:github-create` | `lisa:linear-create` |
| `lisa:tracker-build-intake` | `lisa:jira-build-intake` | `lisa:github-build-intake` | `lisa:linear-build-intake` |

The `tracker-source-artifacts` skill (formerly `tracker-source-artifacts`) is read-only and vendor-neutral — it has no shim and is invoked directly by every `*-to-tracker` skill and every destination write skill (`jira-write-ticket`, `github-write-issue`, `linear-write-issue`).

## Caller responsibilities

- **PRD-source skills** (`notion-to-tracker`, `confluence-to-tracker`, `linear-to-tracker`, `github-to-tracker`) MUST invoke `tracker-write` and `tracker-validate` — never `jira-write-ticket` / `github-write-issue` / `linear-write-issue` directly. This is what makes a project's destination switchable via config.
- **Lifecycle skills** (`implement`, `verify`, `monitor`) MUST invoke `tracker-read`, `tracker-evidence`, `tracker-sync` for ticket interaction — never the vendor-specific equivalents.
- **Per-vendor PRD intake skills** (`notion-prd-intake`, `confluence-prd-intake`, `linear-prd-intake`, `github-prd-intake`) compose the PRD-source skills (which in turn invoke the shims) — they do not need to read `tracker` themselves.
- **Vendor-specific destination skills** (`jira-*`, `github-*`, `linear-*`) read their own vendor config section directly. They do NOT consult `tracker` — they are the targets of dispatch, not the dispatchers.

## Linear destination semantics (best practices)

Linear's data model differs from JIRA / GitHub. The destination mapping follows Linear's recommended patterns:

| Concept (JIRA / GitHub) | Linear equivalent | Linear MCP write |
|---|---|---|
| Epic | **Project** (with milestones, target dates, lead, state) | `save_project` |
| Story | **Issue** with `projectId` set, no `parentId` | `save_issue` |
| Sub-task | **Sub-issue** with `parentId` = Story issue ID | `save_issue` |
| Fix version | Linear **ProjectMilestone** (native, dated) | `save_project` (milestones array) |
| Priority | Native `priority` field (0=No, 1=Urgent, 2=High, 3=Medium, 4=Low) | issue field |
| Estimate / story points | Native `estimate` field | issue field |
| Status workflow | **Labels** (`status:ready`, `status:in-progress`, `status:on-dev`, `status:done`) — portable across teams | issue labels |
| Component | Label prefix `component:` | issue labels |
| Issue links (blocks / relates / duplicates) | Native Linear relations | `save_issue_relation` |

`linear-write-issue` is **polymorphic**: dispatches internally on `issue_type` (Epic → `save_project`, Story / Sub-task → `save_issue`). Parity with `jira-write-ticket` / `github-write-issue` is preserved at the shim level.

Initiatives (Linear's cross-Project rollup) are NOT used — they're intended for cross-quarter, cross-team groupings rarely appropriate for an Epic. If a project ever needs Initiative-level grouping, that's a future extension to this rule.

## Self-host edge case (GitHub PRDs → GitHub destination)

When `github-to-tracker` is invoked AND `tracker = "github"`, both reads and writes hit the same GitHub repo. Label namespaces are kept separate so the two flows don't collide:

- PRD-source labels: `prd-draft`, `prd-ready`, `prd-in-review`, `prd-blocked`, `prd-ticketed`, `prd-shipped` — owned by `github-prd-intake` and the human PM.
- Build-queue labels: `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done` — owned by `github-build-intake` and `github-agent`.
- Sentinel issue label: `prd-intake-feedback` — owned by `github-prd-intake`.

Never overload one label across both lifecycles.

The same separation applies for Linear self-host (`source = "linear"` AND `tracker = "linear"`): project-level labels (`prd-*`) drive the PRD lifecycle; issue-level labels (`status:*`) drive the build lifecycle; the sentinel feedback issue carries the issue-level `prd-intake-feedback` label.

## Notion access (substrate ladder)

`notion-access` selects a substrate per operation in this order:

1. **Notion MCP** — used when authenticated and its identity covers `notion.workspaceId`. Identity-match is verified by attempting to fetch `notion.prdDatabaseId` through the MCP; success means the MCP is authed to the correct workspace. If the MCP is authed elsewhere or unauthenticated, this tier is skipped.
2. **curl + API token** — used when MCP isn't viable. Token is read via the standard lookup ladder (env → workspace-suffixed env → keychain → `tokenSource`).
3. Fail with a clear diagnostic.

(No CLI tier — Notion has no first-party CLI; community wrappers aren't taken as a dependency.)

**Identity-match is mandatory.** A Notion MCP authed to the wrong workspace must be skipped, not used. `notion-access` verifies the configured `prdDatabaseId` is fetchable through the MCP before any operation; failure routes to the next tier.

**Token type**: Notion **internal-integration tokens** (`ntn_*` prefix). Created at notion.so/profile/integrations or workspace settings → Connections → New integration. Each token is **bound to one workspace** by construction. There is no v1/v2 scope mess like Atlassian — the token's access is uniform across whichever pages have been explicitly shared with the integration.

**Multi-account / multi-workspace**: same approach as Atlassian. The keychain entry is keyed by the workspace identifier (workspace id or human slug) declared in `.lisa.config.json` `notion.workspaceId`. Different projects targeting different Notion workspaces resolve to different keychain entries, no collision.

**Per-page access**: Notion's integration model requires each PRD page (or the parent database) to be explicitly **shared** with the integration before the API can see it. `setup-notion` prompts the user to share the PRD database with the freshly-created integration; downstream lifecycle skills assume the share has happened and fail loudly if a page isn't visible.

**Token storage and lookup ladder** (mirrors `atlassian-access`):

```bash
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
```

**Schema additions** to `notion` section:

```json
"notion": {
  "workspaceId":     "<uuid-or-human-slug>",
  "prdDatabaseId":   "<uuid>",
  "statusProperty":  "Status",
  "values":          { "draft": "Draft", "ready": "Ready", ... }
}
```

`workspaceId` is the connection-match key. The notion-access skill calls `GET /v1/users/me` with the token and verifies the returned `bot.workspace_name` (or workspace id when Notion exposes it) matches the configured value before allowing operations to proceed.

## Confluence PRD lifecycle uses parent pages, not labels

GitHub and Linear PRD lifecycles use labels (`prd-ready` / `prd-in-review` / etc.). **Confluence does not** — it uses parent pages instead. Each lifecycle role maps to a parent page; a PRD's current state is determined by which parent it's a child of; transitions are `PUT /wiki/api/v2/pages/{id}` with a new `parentId`.

**Why this asymmetry exists**: scoped API tokens (the only secure form Atlassian offers) cannot write labels on Confluence pages. The v1 label endpoint `POST /wiki/rest/api/content/{id}/label` rejects scoped-token granular scopes with 401 "scope does not match"; the v2 Label API group has no POST endpoint at all (see open bug `CONFCLOUD-76866`). Until Atlassian ships v2 label writes, labels are read-only via scoped tokens. Parent-id transitions, by contrast, are first-class in v2 and work with `write:page:confluence` scope.

**`confluence.parents` map**: each role's parent page id is stored in `.lisa.config.json` after `setup-confluence` creates the lifecycle scaffolding. Skills that need to discover the current state of a PRD read its `parentId` and reverse-lookup in `confluence.parents`. Skills that need to transition update the page's `parentId` to the new role's value.

**Native UX benefit**: parent-page state shows up automatically in Confluence's left-sidebar page tree — users see PRDs grouped by state without ever opening the Dashboard page. The Dashboard is still produced, but as a `Children Display`-macro aggregation rather than `Content by Label`.

## Atlassian access (substrate ladder)

`atlassian-access` selects a substrate per operation in this order:

1. **acli** — preferred when installed and authenticated, and when its active profile's site matches `atlassian.site` from config. `atlassian-access` calls `acli auth status` and compares the returned site/email to config before routing.
2. **Atlassian MCP** — used when acli is unavailable for an op (e.g., Confluence page writes — acli has no `confluence page` write surface), or when acli isn't installed at all. Before routing, `atlassian-access` calls `getAccessibleAtlassianResources` and verifies `atlassian.cloudId` is in the returned list. If the configured cloudId isn't visible to the MCP's authed identity, the MCP tier is skipped.
3. **curl + API token** — used when neither acli nor MCP is viable (headless, multi-account where MCP is authed elsewhere, scoped-token-only deployments). Token is read via the standard lookup ladder (env → email-suffixed env → keychain → `tokenSource`).
4. Fail with a clear diagnostic listing what was attempted.

**Identity-match is mandatory at every tier.** A substrate that's authenticated as the *wrong* Atlassian account is more dangerous than no substrate — it silently performs operations against the wrong workspace. `atlassian-access` verifies identity before every operation and skips substrates that don't match.

**Why curl is still needed**: acli's Confluence surface only covers `space` and `page view`. v1 page-write endpoints accept scoped tokens but return 410 Gone (deprecated); v2 endpoints require granular OAuth scopes acli doesn't request. API tokens via Basic auth bypass this with full user scope, so curl is the headless-friendly path for ops neither acli nor MCP can do.

## Invariants

- Project tracker selection is **persistent** within a project — always read from config, never infer from the shape of `$ARGUMENTS`. If a developer wants a different destination for one run, they edit `.lisa.config.local.json`.
- **Developer-specific fields (e.g., `atlassian.email`) live in `.lisa.config.local.json`, never in the committed file.** The committed file describes the project (which site, which tracker, which space); the local file describes the developer's identity (which account, which profile, which override). Setup skills MUST write developer-specific fields to the local override and shared fields to the committed file.
- A vendor-neutral skill never embeds vendor-specific terminology in its prompts (no "JIRA ticket key", "epic parent" — use "tracker key", "parent issue"). The vendor skill is responsible for translating its inputs.
- The shim layer is intentionally thin — its only job is dispatch. Gate logic, validation rules, and field schemas all live in the vendor skills.
- Secrets stay in env (`ATLASSIAN_API_TOKEN`, `NOTION_API_TOKEN`, `LINEAR_API_KEY`, `GH_TOKEN`). Configuration in `.lisa.config.json` is non-secret only — IDs, keys, slugs, project codes.
- **`ATLASSIAN_API_TOKEN`** is required when the project uses JIRA or Confluence and any operation that acli doesn't cover (Confluence page writes, label edits, etc. — see `atlassian-access` skill's dispatch table). It's per-developer and per-project (different projects under different Atlassian accounts get different tokens). Setup-atlassian guides token generation and persists it to a gitignored `.envrc` (direnv) or `.env.lisa` (manual source); CI sets it directly as a pipeline secret. The token MUST belong to the account whose email is declared in `.lisa.config.local.json` `atlassian.email` — `atlassian-access` validates the pairing on first use of the curl substrate.
- E2E test config (`E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL`) stays in env for now — not tracker-related and frequently per-environment.

## Migration from the previous schema

The pre-expansion `.lisa.config.json` had only `tracker` and `github.{org,repo}`, and a missing `tracker` defaulted to `"jira"`. That default has been removed — `tracker` is now required.

To migrate a project to the new requirements:

1. Run `/lisa:setup:atlassian` (or `/lisa:setup:github`, `/lisa:setup:linear`) — installs the vendor MCP if needed, authenticates, and writes the vendor section.
2. Run `/lisa:setup:jira` (or matching) — writes `jira.project` and prompts to set top-level `tracker`.
3. Optionally run `/lisa:setup:confluence` / `/lisa:setup:notion` / etc. for source vendors — writes their sections and prompts to set top-level `source`.

Projects that previously relied on the `"jira"` default will now fail loudly at the next vendor-neutral skill invocation; the error message points the user at the right setup skill.

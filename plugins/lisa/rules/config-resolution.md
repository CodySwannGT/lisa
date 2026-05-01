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
tracker="${local_value:-${global_value:-jira}}"
```

## Schema

```json
{
  "tracker": "jira",
  "source":  "notion",

  "atlassian":  { "cloudId": "<uuid>" },
  "jira":       { "project": "<KEY>" },
  "confluence": { "spaceKey": "<KEY>", "parentPageId": "<id>" },
  "github":     { "org": "<org-or-user>", "repo": "<repo>" },
  "notion":     { "prdDatabaseId": "<uuid>", "statusProperty": "Status", "readyValue": "Ready" },
  "linear":     { "workspace": "<workspace-slug>", "teamKey": "<TEAM>" }
}
```

### Top-level fields

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `tracker` | no | `"jira"` | Destination for ticket writes. One of `"jira"`, `"github"`, `"linear"`. Missing key resolves to `"jira"` for back-compat. |
| `source` | no | — | Default PRD source for batch skills (`/lisa:intake`) and arg-less single-PRD skills. One of `"notion"`, `"confluence"`, `"linear"`, `"github"`, `"jira"`. Explicit URLs/keys passed to a skill always win over `source`; this is a default, not a lock. |

### Vendor sections

Each vendor section is **conditionally required**: required only when that vendor is referenced as `tracker`, as `source`, or by an explicit invocation. Skills validate their own required keys at entry and stop with a clear error if missing — never invent values.

#### `atlassian`

| Field | Required when | Notes |
|-------|---------------|-------|
| `atlassian.cloudId` | `tracker = "jira"`, `source = "jira"`, `source = "confluence"`, or any `confluence-*` / `jira-*` skill is invoked | Atlassian Cloud site UUID. Resolve once via the Atlassian MCP `getAccessibleAtlassianResources` and paste in. Shared between JIRA and Confluence (same Atlassian site). If a project ever needs separate sites for JIRA vs Confluence, override via `jira.cloudId` / `confluence.cloudId` (not currently implemented — file an issue). |

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

| Field | Required when | Notes |
|-------|---------------|-------|
| `notion.prdDatabaseId` | `source = "notion"` | Notion database ID (UUID, dashes optional). The database is the PRD queue. |
| `notion.statusProperty` | `source = "notion"` | Name of the database property that drives the lifecycle. Defaults to `"Status"` if absent. |
| `notion.readyValue` | `source = "notion"` | Status value that means "ready for ticketing". Defaults to `"Ready"` if absent. The full lifecycle (Ready → In Review → Blocked / Ticketed → Shipped) is hardcoded; only the entry-point value name is configurable for now. |

#### `linear`

| Field | Required when | Notes |
|-------|---------------|-------|
| `linear.workspace` | `tracker = "linear"`, `source = "linear"`, or any `linear-*` skill is invoked | Linear workspace slug (e.g. `acme`). |
| `linear.teamKey` | `tracker = "linear"` | Linear team key (e.g. `ENG`). The team owns the destination Issues. For source mode, projects are workspace-scoped or team-scoped per the URL passed. |

## Resolution algorithm

Every `tracker-*` shim and every vendor-neutral caller follows this:

1. Read `.lisa.config.local.json` first (if present), then `.lisa.config.json`. Local overrides global on a per-key basis. Use `jq` — never hand-parse JSON.
2. Extract the `tracker` field. If missing or null, default to `"jira"`.
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

## Invariants

- Project tracker selection is **persistent** within a project — always read from config, never infer from the shape of `$ARGUMENTS`. If a developer wants a different destination for one run, they edit `.lisa.config.local.json`.
- A vendor-neutral skill never embeds vendor-specific terminology in its prompts (no "JIRA ticket key", "epic parent" — use "tracker key", "parent issue"). The vendor skill is responsible for translating its inputs.
- The shim layer is intentionally thin — its only job is dispatch. Gate logic, validation rules, and field schemas all live in the vendor skills.
- Secrets stay in env (`JIRA_API_TOKEN`, `LINEAR_API_KEY`, `GH_TOKEN`, `NOTION_API_KEY`, `ATLASSIAN_API_TOKEN`). Configuration in `.lisa.config.json` is non-secret only — IDs, keys, slugs, project codes.
- E2E test config (`E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL`) stays in env for now — not tracker-related and frequently per-environment.

## Migration from the previous schema

The pre-expansion `.lisa.config.json` had only `tracker` and `github.{org,repo}`. Existing projects continue to work — the new fields are all conditionally required, and `tracker = "jira"` (the default) only requires `atlassian.cloudId` and `jira.project`, which were previously read from env (`JIRA_SERVER`, `JIRA_PROJECT`).

To migrate a project off env vars:

1. Add `atlassian.cloudId` (resolve via `getAccessibleAtlassianResources` once).
2. Add `jira.project` (was `JIRA_PROJECT`).
3. Drop `JIRA_SERVER` from env (replaced by `atlassian.cloudId`).
4. Optionally add `source` to set the default PRD source for batch skills.

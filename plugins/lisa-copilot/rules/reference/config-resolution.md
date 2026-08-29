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
    },
    "labels": {
      "human_needed": "Human Needed"
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
      "shipped":   "<page-id>",
      "verified":  "<page-id>"
    },
    "dashboardPageId": "<page-id>",
    "feedbackPageId":  "<page-id>"
  },
  "github": {
    "org": "<org-or-user>",
    "repo": "<repo>",
    "projects": {
      "v2": {
        "owner": {
          "kind": "organization",
          "slug": "<org-or-user>"
        },
        "number": 7,
        "required": false
      }
    },
    "labels": {
      "build": {
        "ready":   "status:ready",
        "claimed": "status:in-progress",
        "blocked": "status:blocked",
        "human_needed": "human-needed",
        "done":    { "dev": "status:on-dev", "staging": "status:on-stg", "production": "status:done" }
      },
      "prd": {
        "draft": "prd-draft",
        "ready": "prd-ready", "in_review": "prd-in-review",
        "blocked": "prd-blocked", "ticketed": "prd-ticketed",
        "shipped": "prd-shipped", "verified": "prd-verified",
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
      "blocked": "Blocked", "ticketed": "Ticketed", "shipped": "Shipped",
      "verified": "Verified"
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
        "human_needed": "human-needed",
        "done":    { "dev": "status:on-dev", "staging": "status:on-stg", "production": "status:done" }
      },
      "prd": {
        "draft": "prd-draft",
        "ready": "prd-ready", "in_review": "prd-in-review",
        "blocked": "prd-blocked", "ticketed": "prd-ticketed",
        "shipped": "prd-shipped", "verified": "prd-verified",
        "sentinel": "prd-intake-feedback"
      }
    }
  },

  "deploy": {
    "branches": {
      "dev":        "dev",
      "staging":    "staging",
      "production": "main"
    },
    "order": ["dev", "staging", "production"]
  },

  "usage": {
    "pricing": {
      "currency": "USD",
      "source": "openai-api-pricing",
      "snapshot": "2026-05-25",
      "models": {
        "openai/gpt-5": {
          "inputPer1M": 1.25,
          "cachedInputPer1M": 0.125,
          "outputPer1M": 10.0,
          "reasoningPer1M": 10.0
        }
      }
    }
  },

  "intake": {
    "assignee": "<vendor-user-id-or-login>",
    "repair": {
      "staleAfterHours": 2,
      "maxCandidates": 100
    }
  },

  "monitor": {
    "maxCandidates": 20,
    "gapTiers": "core",
    "backoffHours": 24,
    "thresholds": {
      "minEvents24h": 1,
      "errorRateSpikeMultiplier": 2,
      "p95LatencyMs": 1000,
      "faultRatePct": 5
    }
  }
}
```

### Top-level fields

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `tracker` | **yes** | — | Destination for ticket writes. One of `"jira"`, `"github"`, `"linear"`. Missing → fail with instruction to run the matching `/lisa:setup:*` skill. |
| `source` | no | — | Default PRD source for batch skills (`/lisa:intake`) and arg-less single-PRD skills. One of `"notion"`, `"confluence"`, `"linear"`, `"github"`, `"jira"`. Explicit URLs/keys passed to a skill always win over `source`; this is a default, not a lock. |
| ~~`projectRulesFile`~~ | — | — | **Retired.** Host-authored rules now live in the fixed, agent-neutral directory `.agents/rules/` — not a configurable file. An existing key is still parsed and preserved so installed projects keep applying, but nothing serves rules from it. See **Host rules** below. |
| `learnings.file` | no | `.lisa/PROJECT_LEARNINGS.md` | Safe repo-relative Markdown path for the machine-managed learnings ledger, overriding the `.lisa/` default. Rejected if it resolves inside any auto-loaded rules tree (`.claude/rules`, `.cursor/rules`, `.github/instructions`, `.agents/rules`) — the ledger must stay out of eager context. |
| `health.schedule` | no | `off` | Health cadence contract: `off`, `daily`, or `weekly`. `lisa sync` populates the default with `_lisaSync.populated` provenance and rejects values outside this closed vocabulary. Runtime results live only at the gitignored `.lisa/health/latest.json`, never in either config file. |
| `usage` | no | — | Optional token/cost pricing metadata consumed by the `usage-accounting` rule. Missing pricing never blocks a lifecycle flow; Lisa records token counts with `estimated_cost: null` when no trustworthy price source is configured. |
| `wiki` | no | — | Wiki location for the `wiki-knowledge-source` rule. Omit for a local in-repo wiki (`wiki/`). See **Wiki source** below. |

### Host rules (`.agents/rules/`)

Host-authored operating rules live in `.agents/rules/` — **fixed, not configurable**. One directory, every agent.

- **Not a native auto-load tree.** `.claude/rules`, `.cursor/rules`, and `.github/instructions` are; `.agents/rules` deliberately is not. Every agent reaches it through the single Lisa-managed pointer block in `AGENTS.md` (Claude via the `@AGENTS.md` import in `CLAUDE.md`), so no agent loads host rules twice.
- **Host-owned.** Lisa never writes rule bodies into `.agents/rules/`, and never edits or deletes a file there. Lisa's own rules originate in its plugins and arrive by their own route.
- **Not the learnings ledger.** `.agents/rules` is reserved in the auto-loaded-tree blocklist, so a `learnings.file` override can never resolve inside it.
- **Transition.** A project that still has the retired `.claude/rules/PROJECT_RULES.md` keeps it, untouched and authoritative. The pointer block names it so agents whose runtime does not auto-load `.claude/rules/` still find it. Moving that content is a human-gated decision, never an automated rewrite.

### Wiki source (`wiki`)

Declares **where this repo's LLM Wiki lives** so the query/ingest skills can resolve and (for a remote wiki) mirror it. `wiki.source` has two shapes — **local** (`path`) and **remote** (`url`) — and the block belongs in the **consumer** repo's `.lisa.config.json`, not in `wiki/lisa-wiki.config.json` (which describes a wiki from the inside and is unavailable until a remote wiki is mirrored — chicken-and-egg). The whole `wiki` block is optional; omit it and the resolver falls back to the in-repo `wiki/` convention.

```json
// local: an explicit path (optional — equivalent to the default convention)
"wiki": { "source": { "path": "wiki" } }

// remote: mirror a separate wiki repo
"wiki": {
  "source": {
    "url": "git@github.com:org/wiki.git",
    "ref": "main",
    "mirrorPath": ".lisa/wiki",
    "subdir": "wiki"
  },
  "ttlSeconds": 300
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `wiki.source.path` | no | `wiki` (via convention) | **Local** wiki root, relative to the repo. The explicit form of the in-repo default. Mutually exclusive with `url`. |
| `wiki.source.url` | no | — | Clone URL of a separate wiki repo. **Its presence selects REMOTE mode.** Mutually exclusive with `path`. |
| `wiki.source.ref` | no | remote HEAD | Branch/ref to mirror (remote only). |
| `wiki.source.mirrorPath` | no | `.lisa/wiki` | Where the gitignored mirror is materialized (remote only). `ensure-wiki` keeps this path gitignored automatically. |
| `wiki.source.subdir` | no | auto | Wiki root within the cloned repo (remote only). Auto-detected as `wiki/` if present, else the repo root. |
| `wiki.ttlSeconds` | no | `300` | Skip the refresh fetch if the mirror was synced more recently than this (remote only). |

`scripts/ensure-wiki.mjs` is the single resolver (`node scripts/ensure-wiki.mjs --json` → `{mode, wikiRoot, …}`). **LOCAL** mode (no `url`) is a no-op that resolves the wiki root in precedence order `wiki.source.path` → `wikiRoot` in `wiki/lisa-wiki.config.json` → `wiki`; **REMOTE** mode (`url` set) clones-if-missing, fast-forwards when stale, and is offline-tolerant (proceeds with the existing mirror and warns rather than blocking). Callers (`lisa-wiki-query`, `lisa-wiki-ingest`) invoke it as step 0 and never hardcode `wiki/`; the freshness guarantee is the tool's, not the caller's.

### Env → base branch

Implementation flows resolve their PR base from the work item's environment
evidence in the forward direction of `deploy.branches`.
For example, `{ "staging": "staging", "production": "main" }` means a staging
work item starts from `origin/staging` and opens its PR against `staging`. This
is the reverse/inverse of the env-keyed `done` inference that derives an
environment from a merged PR's base branch.

The field grammar records provenance durably: human-confirmed values are a bare
configured key or `Confirmed: <env>`; automated evidence is
`Inferred: <env> — evidence: <title|body|reproduction|hostname>`; an automated
fallback is `Assumption: <env> — remote default branch <branch>`. Human
fallback without a unique reverse-map is
`Assumption: remote default branch <branch>`. Human
confirmation replaces an automated annotation with a bare key or
`Confirmed: <env>`.

For legacy bare values created before this grammar, use managed draft markers
and current ticket content only; provider edit history is neither required nor
assumed. A managed marker proves automation and requires rewriting to
`Inferred:` or `Assumption:`. Without one, provenance remains unknown, so the
bare value is usable only if no conflicting evidence exists; a conflict stops
for confirmation.

Resolve it in this order: human-confirmed wins; validated `Inferred:` evidence
is next; otherwise accept one unambiguous exact `deploy.branches` key from the
human-authored title, body, and reproduction steps or a URL hostname. Exclude
the entire `Target Backend Environment` section and all other machine-authored
metadata/draft blocks from the evidence scan, so annotations never validate or
conflict with themselves. Evidence supersedes only
an `Assumption:`. Treat the reported bug environment as an example of this
all-work-type evidence rule, not a special case. Normalize only built-in
`prod` ↔ `production` when exactly one is configured; no other aliases exist.
Never infer from arbitrary branch text, URL paths/query strings, or substrings.
Multiple conflicting signals stop. With no signals, use the remote default
branch and record an assumption: include the environment only for a unique
reverse-map; otherwise use the branch-only form without inventing an environment
or blocking solely on the reverse-map.

Every selected environment must have a unique `deploy.branches` mapping and its
mapped branch must exist on the remote. If either validation fails, stop and
report it. Do not silently default to the integration branch.

For non-integration environment bugs, definition of done is two-step:

1. Fix, merge, deploy, and verify on the reported environment branch first.
2. Forward cherry-pick the verified fix down to the integration branch, usually
   via a linked follow-up PR or work item, so the next promotion does not
   regress the fix.

### Vendor sections

Each vendor section is **conditionally required**: required only when that vendor is referenced as `tracker`, as `source`, or by an explicit invocation. Skills validate their own required keys at entry and stop with a clear error if missing — never invent values.

#### `atlassian`

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `atlassian.cloudId` | `tracker = "jira"`, `source = "jira"`, `source = "confluence"`, or any `confluence-*` / `jira-*` skill is invoked | **committed** (`.lisa.config.json`) | Atlassian Cloud site UUID. Same for every developer on the project. Resolve once via `curl https://<site>/_edge/tenant_info` or `getAccessibleAtlassianResources`. Shared between JIRA and Confluence (same Atlassian site). |
| `atlassian.site` | same as above | **committed** | Human-readable site URL (e.g. `acme.atlassian.net`). Same for every developer. |
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
| `github.queueRepo` | no | Optional GitHub **build** queue repository, distinct from this repo's identity and PRD source. Store the canonical `owner/repo`. A short repo name is accepted at runtime and normalized to `github.org`. Explicit GitHub repo/URL arguments always win; otherwise GitHub build intake, build repair, build queue status, and scheduled ticket commands use this value, falling back to `github.org/github.repo` when absent. This never changes `repo:<name>` scoping, PRD intake, or automation naming, which remain tied to `repo` / `github.repo`. |
| `github.projects.v2.owner.kind` | GitHub Project coordination is enabled | Owner type for the shared ProjectV2. Supported values are `organization` and `user`. |
| `github.projects.v2.owner.slug` | GitHub Project coordination is enabled | Owner login for the shared ProjectV2. In v1 it MUST match the tracked repository namespace (`github.org`); cross-namespace coordination is rejected. |
| `github.projects.v2.number` | GitHub Project coordination is enabled | Human-facing ProjectV2 number from the GitHub UI / URL. Later utilities resolve the opaque node id from this owner + number pair. |
| `github.projects.v2.required` | no | Coordination strictness flag. Default `false` keeps Project membership best-effort; `true` makes Project membership failures block the write. Setup/doctor/runtime validation reads Project ownership + access and branches on this flag: best-effort failures warn, required-mode failures stop the write. |
| `github.environments` | no | Optional map of friendly environment name → deployment-environment declaration, provisioned by `/lisa:setup:github-repo` (`scripts/lisa-github-environments.sh`). Absent → no environments are touched. Each declared environment gets a deployment branch policy pinned to its branch. |
| `github.environments.<name>.branch` | no | Branch that deploys to this environment. Resolution order: this field → `deploy.branches[<name>]` → the environment name itself. |
| `github.environments.<name>.require_approval` | no | Default `false`. `true` provisions required reviewers on the environment and makes the stack `deploy.yml` templates pass `require_approval`/`approval_environment` to `release.yml`, pausing the run at the `release_approval` job until a reviewer approves. |
| `github.environments.<name>.reviewers` | `require_approval = true` | Array of GitHub usernames or `org/team-slug` entries (max 6) allowed to approve deployments. Mandatory with `require_approval` — an approval gate nobody can approve is refused at provision time. |
| `github.environments.<name>.prevent_self_review` | no | Default `false`. `true` stops the person who triggered the deployment from approving it themselves. |
| `github.environments.<name>.wait_timer` | no | Default `0`. Minutes to delay the deployment after approval. |

When `tracker = "github"` AND `source = "github"` (self-host), both reads and writes hit the same GitHub repo. Label namespaces are kept separate so the two flows don't collide — see "Self-host edge case" below.

When `github.queueRepo` points at an umbrella repository, build-queue **scans** happen there while the
current repository's identity remains `github.org/github.repo`. Resolve a GitHub queue in this
order for a build-mode scan: explicit `owner/repo` or GitHub URL argument, merged-config `github.queueRepo`, then
`github.org/github.repo`. Queue status must show both identity and queue; build counts and claims
remain filtered to `repo:<github.repo>`. Setup writes the canonical `owner/repo` form and omits the
key when the queue is the identity repo.

`github.projects.v2` is optional. When absent, GitHub issue / PR writes remain repository-local exactly as they work today. When present, the shared Project is a coordination view layered on top of real issues and pull requests; it does not replace lifecycle labels, comments, dependencies, or native issue / PR state as Lisa's durable source of truth.

When `github.projects.v2` is present, later setup/doctor and writer preflight validation MUST read the referenced Project's owner + access level before any membership write depends on it. The validation contract is:

- Resolve the Project from `owner.kind`, `owner.slug`, and `number`.
- Confirm the owner namespace still matches `github.org`; cross-namespace Project ownership is a configuration error.
- Confirm the authenticated identity can read the Project and has sufficient access for membership coordination.
- If `required = false`, surface Project-validation failures as warnings and continue repository-local issue / PR writes without Project membership.
- If `required = true`, surface the same failures as blocking errors and stop the write before mutating issue / PR membership.

#### `notion`

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `notion.workspaceId` | `source = "notion"` | **committed** | Workspace identifier (Notion workspace UUID, or a stable human slug the user picks at setup). Same for every developer on the project. Used as the keychain `account` value when looking up the Notion API token, so each project's `notion-access` finds the right per-workspace token. |
| `notion.prdDatabaseId` | `source = "notion"` | **committed** | Notion database ID (UUID, dashes optional). The database is the PRD queue. Same for every developer on the project. |
| `notion.statusProperty` | `source = "notion"` | **committed** | Name of the database property that drives the lifecycle. Defaults to `"Status"` if absent. |
| `notion.values` | optional | **committed** | Map of role → Notion status-value name (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`, `verified`). Defaults match the role names in title case. Override here if your Notion DB uses different value names. |

#### `linear`

| Field | Required when | Notes |
|-------|---------------|-------|
| `linear.workspace` | `tracker = "linear"`, `source = "linear"`, or any `linear-*` skill is invoked | Linear workspace slug (e.g. `acme`). |
| `linear.teamKey` | `tracker = "linear"` | Linear team key (e.g. `ENG`). The team owns the destination Issues. For source mode, projects are workspace-scoped or team-scoped per the URL passed. |
| `linear.workflow` | `tracker = "linear"` | Workflow **state** name per build lifecycle role — the Linear analogue of `jira.workflow`, not of `github.labels`. Defaults `{ ready: "Ready", claimed: "In Progress", blocked: "Blocked", done: { dev: "On Dev", staging: "On Stg", production: "Done" } }` — **no `review` key**, because it is optional and a default would be materialized into the project's config by `lisa sync`. **`ready` is a dedicated state, never the team's default** — see below. Resolve and verify with `/lisa:setup:linear`. |
| `linear.labels` | `tracker = "linear"` or `source = "linear"` | **Markers and the PRD lane only.** `build.human_needed` (default `human-needed`) and the `prd.*` map. The build lifecycle does **not** live here — see `linear.workflow`. |

##### Why Linear uses states, not labels

Linear Issues carry first-class workflow states with a machine-readable `type`
(`backlog` / `unstarted` / `started` / `completed` / `canceled`) — the same shape
JIRA statuses have. GitHub Issues has no such field (only open/closed), which is
why the GitHub adapter *must* use labels; that is a constraint of GitHub's data
model, not a Lisa preference, and Linear does not share it.

Driving Linear off labels left **two writers on one lifecycle**: Linear's own git
automations move `state` on merge while Lisa moved only labels. The two then
disagreed permanently on any merge that did not run through a Lisa flow, and the
env rungs (`On Dev` / `On Stg`) could never appear on a Linear board, cycle or
insight at all, because those group by state.

The historical objection was that per-team state NAMES vary and get renamed. That
is equally true of JIRA statuses, which Lisa keys on regardless, and Linear
additionally exposes the rename-proof `type` discriminator that the lifecycle
skills already use for terminal detection. Names live in config, so a project
that renames a state overrides one key.

#### `verification.browser.kane`

Kane CLI is an optional empirical-browser provider. It is never enabled by executable discovery
alone and never replaces native regression runners.

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `verification.browser.kane.enabled` | using Kane | **committed** | Must be literal `true`; absent/false means Lisa does not probe or select Kane. |
| `verification.browser.kane.version` | enabled | **committed** | Exact contract-tested version, currently `0.6.3`. Version ranges and implicit latest are rejected. |
| `verification.browser.kane.cloudUploadApproved` | enabled | **committed** | Exterior human approval that TestMu may receive objectives, screenshots, action logs, variables in scope, metadata, and packaged run artifacts from disposable test environments. |
| `verification.browser.kane.allowedEnvironments` | enabled | **committed** | Non-empty environment allow-list. `prod` and `production` are invalid regardless of other config. Each environment must also resolve to `exploration.environments.<name>.mutation = full` at run time. |
| `verification.browser.kane.projectId` | enabled | **committed** | Expected Test Manager project identifier. `lisa kane probe` verifies the active CLI config matches it. |
| `verification.browser.kane.folderId` | no | **committed** | Optional expected Test Manager folder identifier, also verified by the probe. |
| `verification.browser.kane.timeoutSeconds` | no | **committed** | Integer 1–600; defaults to 120. Lisa adds a small outer process-kill grace period. |

Credentials never live in Lisa config. Developer OAuth state remains in Kane's protected local
profile; CI uses its secret store and a dedicated service identity. Local config may override a
Kane key per the normal per-key precedence, but shared upload policy, allow-list, and Test Manager
target should be committed so teammates and automations see the same gate.

Use `/lisa:setup-kane` only at the exterior setup gate. Factory workflows invoke
`lisa-kane-browser`, which calls the Lisa adapter (`lisa kane probe/run`) rather than consuming the
vendor's global skill or `agents.md`.

#### `usage`

`usage` is optional. It carries non-secret pricing metadata Lisa may use when runtime token counts are trustworthy but runtime monetary cost is absent.

| Field | Required when | Where it lives | Notes |
|-------|---------------|----------------|-------|
| `usage.pricing.currency` | estimating cost from config | **committed** | ISO currency code paired with the configured rates (for example `USD`). |
| `usage.pricing.source` | estimating cost from config | **committed** | Human-readable source label for the configured pricing schedule (for example `openai-api-pricing`). This is metadata, not a URL requirement. |
| `usage.pricing.snapshot` | no | **committed** | Version/date/hash describing when the pricing schedule was captured. Use it to make estimated-cost provenance durable across later vendor price changes. |
| `usage.pricing.models` | estimating cost from config | **committed** | Map of `<provider>/<model>` to per-million-token rates. Lisa has **no built-in provider rates**; every estimated-cost model must be declared here explicitly. |

Each `usage.pricing.models["<provider>/<model>"]` value supports these numeric keys:

| Key | Required | Notes |
|-----|----------|-------|
| `inputPer1M` | yes | Price per 1M non-cached input tokens. |
| `cachedInputPer1M` | no | Price per 1M cached input tokens when the runtime exposes them separately. If absent, cached tokens cannot be priced and the entry falls back to `pricing_status=missing` unless the runtime already supplied cost. |
| `outputPer1M` | yes | Price per 1M output/completion tokens. |
| `reasoningPer1M` | no | Price per 1M reasoning/internal tokens when the provider bills them separately. If absent, treat reasoning tokens as unpriceable rather than folding them into another bucket. |

Resolution rules for estimated pricing:

- Resolve `usage.pricing.*` with the same per-key local-overrides-global precedence as every other config section.
- Estimates are allowed only when trustworthy token counts exist and a matching `usage.pricing.models["<provider>/<model>"]` entry supplies every rate needed for the exposed token buckets.
- Missing model entries or missing required bucket rates do **not** trigger built-in defaults. Preserve the token counts, leave `cost = null`, and emit `pricing_status = missing`.
- When an estimate is produced from config, write `pricing_source` as `config:<source>@<snapshot>` when both fields exist, `config:<source>` when only `source` exists, or `config` when neither metadata field is available.
- Runtime-observed monetary cost always wins over config estimates; config pricing is fallback-only.

## Workflow & vocabulary roles

Every lifecycle skill operates on a fixed set of **roles** (`ready`, `claimed`, `done`, etc.), not concrete status/label strings. The role → string mapping lives in the per-vendor section above, with defaults that match the legacy hardcoded names. A project that uses different names overrides the relevant key; everything else inherits.

### Roles

**Build lifecycle** (work items):

| Role | What it means | JIRA default | Linear default | GitHub default |
|---|---|---|---|---|
| `ready` | Human signal "this is buildable; agent may claim" | `Ready` (status) | `Ready` (state) | `status:ready` (label) |
| `claimed` | Agent has picked the item up | `In Progress` (status) | `In Progress` (state) | `status:in-progress` (label) |
| `review` | Optional post-build review hold, when a tracker/project still uses one | **no default** | **no default** | **no default** |
| `blocked` | Agent stopped on triage ambiguities or external blocker | `Blocked` (status) | `Blocked` (state) | `status:blocked` (label) |
| `done` | Terminal state for this work, **env-keyed** | map of env → status | map of env → state | map of env → label |

**JIRA and Linear resolve roles to native workflow statuses/states** (`jira.workflow`, `linear.workflow`); **GitHub resolves them to labels** (`github.labels.build`) because GitHub Issues has no workflow-state field at all. A role transition is therefore a *state move* on JIRA and Linear, and a *label swap* on GitHub. Skills operate on roles and never hardcode either form.

### R1 — an absent OPTIONAL role means SKIP, never a default

`ready`, `claimed`, `blocked` and `done` are **required**; omitting one is a setup defect and a skill must say so. `review`, the `qa.*` roles and `human_needed` are **optional and carry no built-in default on any vendor**. Omitting one means the project does not run that step, and every lifecycle skill skips the transition — the item simply stays in its current role.

A default on an optional role breaks this twice over. Vendor default maps are `defaultValue`s in `sync/registry`, so `lisa sync` **materializes** them into a project's `.lisa.config.json` — a project that deliberately omitted `review` finds it written back in. And as a resolution fallback, a default makes "unset" indistinguishable from "not customized", so no project can express *"we have no agent review step."*

Measured downstream: a project bound no `review` role — its policy was that a PR-open ticket stays in `claimed` until it reaches an environment — and agents moved two issues into a human-only review state regardless, because every layer that could have honoured the omission supplied a default instead.

GitHub has always been correct here (`BUILD_LABEL_DEFAULTS` seeds no `review`), and `lisa-jira-evidence/scripts/post-evidence.sh` has always implemented it correctly (`REVIEW=""`, explicit skip branch). The default maps for JIRA and Linear now agree with them.

### R2 — a fallback may inform a READ, never supply a WRITE target

Where a vendor exposes a fallback for a missing role — Linear resolves states by `type`, since Linear states carry one — it may be used to *read*. It must **never** supply a value to write.

Such a fallback selects by **board position**, not intent. On a board carrying more than one plausible state it returns whichever sits earliest, and the states that surface that way are precisely the human-only lanes a project kept out of its config on purpose. Measured on one board: with `blocked` and `claimed` already bound, the lowest-position unbound `started` state was a human-only review lane, and that is exactly where two issues landed.

`ready` has no fallback at all, in either direction — see below.

### The single resolver

Every skill resolves roles through `${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lifecycle-role.mjs`, never an inlined `read_role()` helper. Twelve skills previously inlined one and produced **eleven distinct implementations**; that copy-paste is what let the vendors drift apart on R1.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lifecycle-role.mjs" \
  --role <role> --vendor <jira|linear|github> --intent <read|write> [--env <env>]
```

Exit `0` with a value → configured. Exit `0` with **empty** output → an optional role is unset; skip the transition. Exit `2` → a required role is unset, or a write was refused a fallback value.

**`ready` must never resolve to the team's DEFAULT state.** `Todo` is where Linear puts a brand-new issue, so using it for `ready` inverts the gate: the lane stops meaning "a human flipped this to build-ready" and starts meaning "nobody has touched this". Measured on the first team migrated: 20 issues in the lane, only 8 ever explicitly marked ready. JIRA avoids this because `jira.workflow.ready` is a dedicated `Ready` status while a fresh ticket lands in the project default.

**That rule is enforced, not merely stated — a correct default is only half the fix.** The default is `Ready`, but any project can override `linear.workflow.ready`, and an override reproduces the inversion exactly. Two arms catch it, deliberately split by what each can see:

- **Static, always-on.** The queue-contract resolver refuses a `ready` naming a stock default created state (`Todo`, `To Do`, `Backlog`, `Triage`) and throws rather than resolving. It needs no network, so it runs everywhere, including offline and in CI. It cannot see a team that renamed its default.
- **Live, authoritative.** `/lisa:validate-tracker-mapping` compares the configured `ready` against the team's real `defaultIssueState` (surfaced as `isTeamDefault` on `lisa-linear-access operation: list-workflow-states`) and classifies a match as `INVERTED` — never `VALID`, and never auto-repaired, because nothing records what lane the human meant instead.

`INVERTED` is not a name-resolution failure; it is the opposite. The name resolves perfectly, which is precisely why every existence check passes while the gate runs backwards.

**Linear state resolution is `type`-aware.** When a configured name is missing, a lifecycle skill may fall back to the team's states by `type` — `claimed`/`review` → the lowest-position `started`, `blocked` → `started` or `unstarted`, terminal `done` → `completed` — but only to *read*. **`ready` has no fallback on purpose:** every candidate would be the team's default unstarted state, which is exactly the inversion described above. A missing `ready` state is reported, never guessed; it must never invent a state to write into. Missing states are a setup defect, repaired by `/lisa:setup:linear`, not papered over at runtime.

`blocked` is what every vendor agent flips to when triage finds unresolved ambiguities or the build path is blocked by something the agent can't resolve. Different from `claimed` because it explicitly signals "human attention required."

#### Build markers (additive labels, not lifecycle roles)

A **marker** is an additive label applied *alongside* a lifecycle role, not a state the item transitions *to*. Markers carry no rollup or transition semantics — they annotate an item that is already in some role, and the rollup reads them to say *which kind* of hold a `blocked` item is (`rollup-blocker-classification`). The build lifecycle defines two markers:

| Marker | What it means | JIRA default | GitHub/Linear default |
|---|---|---|---|
| `human_needed` | Applied with `blocked` when — **after the agent has drafted every authorable missing section via the `pre-flight-autofill` procedure** — the block still requires a human to confirm the drafted assumptions or supply something no agent can invent: real missing credentials, access/permissions, or an irreducible product/scoping decision. | `Human Needed` (label) | `human-needed` (label) |
| `spec_defect` | Applied with `blocked` when the thing holding the item is the item's **own specification** — an acceptance criterion that cannot be satisfied as written, a field naming an environment or surface the project does not have, a validation journey demanding something the project cannot produce. **Human-applied only.** No agent sets it, because judging a criterion unbuildable is a product call, and the agent that wrote a bad criterion is the least likely to know it did. | `Spec Defect` (label) | `blocked:spec-defect` (label) |

Markers are labels on **every** vendor, Linear included — that is the one place the Linear build lane still touches `linear.labels`.

Resolution keys:

- JIRA: `jira.labels.human_needed` (default `Human Needed`). Applied as a JIRA **label** — not a workflow status — because an item holds exactly one status but any number of labels. The `blocked` status still drives the lifecycle; `human_needed` is the additive marker on top of it.
- GitHub: `github.labels.build.human_needed` (default `human-needed`). Added next to the `blocked` label.
- Linear: `linear.labels.build.human_needed` (default `human-needed`). Applied as a Linear **label**, for the same reason as JIRA — an Issue holds exactly one workflow state but any number of labels, so an additive marker cannot be a state. The `blocked` **state** still drives the lifecycle; `human_needed` is the marker on top of it. This is the only build-lane key left in `linear.labels`.
- `spec_defect` resolves the same way on each vendor — `jira.labels.spec_defect` (default `Spec Defect`), `github.labels.build.spec_defect` and `linear.labels.build.spec_defect` (default `blocked:spec-defect`).

**When to apply it.** Apply `human_needed` only when a human must act before the item can move — the pre-flight gate failures that bounce a ticket back to its reporter are exactly this case, but **only after** the agent has run the `pre-flight-autofill` draft-then-block procedure (drafting the authorable gaps — acceptance criteria, validation journey, repository, relationship search, etc. — into the ticket as labeled assumptions). What then remains for the human is to **confirm those assumptions** or supply a genuinely human-only input (real missing credentials, an irreducible product/scoping decision). The marker means "a human must confirm or decide," not "a human must author from scratch."

**Why `spec_defect` is separate from `human_needed`.** Both name a hold a person must clear, but they are different asks and the rollup must not merge them. `human_needed` waits on an input from *outside* the item — a credential, an access grant, a product decision — and the item's own text is fine. `spec_defect` waits on the item's text being *rewritten*, and no external event will ever supply that. An item carrying `spec_defect` will sit forever until somebody edits it; that is exactly the class that accumulated silently when the rollup rendered both as plain `blocked` (issue #3045: 32 identical hold comments over six weeks on one Epic). Where both markers are present, `spec_defect` wins — it is the more specific record, and the only one carrying a judgment nothing else can supply.

**Nothing infers `spec_defect`.** It is never derived from prose, a title, or a failed gate. A `blocked` item carrying neither marker and no open `is blocked by` link classifies as **`unknown`**, and the rollup says so and asks a person to decide — an honest `unknown` beats a confident wrong answer, and auto-reclassifying would turn a human product call into a guess.

**When NOT to apply it.** Do **not** apply `human_needed` to a block that an automated cycle can clear on its own: a block whose `is blocked by` dependency is another tracked ticket that will build and close (for example a `repair-intake`-filed build-ready fix ticket for an unmergeable PR or a failed deploy), or any block waiting only on a retry. Those self-heal; flagging them for a human is noise. If such an item already carries a stale `human_needed` marker, clear it when the block becomes auto-recoverable.

The marker is **best-effort and additive**: it never replaces the `blocked` role and never gates a transition. A project that does not define the label name inherits the defaults above; a project that does not want the marker at all can leave the label absent in its tracker, in which case the add is a no-op the agent records and moves on.

**PRD lifecycle** (specifications):

| Role | What it means | Notion default | Confluence/GitHub/Linear default |
|---|---|---|---|
| `draft` | Author drafting; agent ignores until promoted to `ready` | `Draft` (status) | `prd-draft` (GitHub/Linear label); parent-page lookup (Confluence) |
| `ready` | "Ready for ticketing"; agent claims | `Ready` (status) | `prd-ready` (label) |
| `in_review` | Agent has claimed and is validating | `In Review` (status) | `prd-in-review` (label) |
| `blocked` | Validation failed; clarifying-comments posted | `Blocked` (status) | `prd-blocked` (label) |
| `ticketed` | Validated and tickets created | `Ticketed` (status) | `prd-ticketed` (label) |
| `shipped` | All child tickets shipped | `Shipped` (status) | `prd-shipped` (label) |
| `verified` | Shipped product empirically checked against the PRD | `Verified` (status) | `prd-verified` (label); parent-page lookup (Confluence) |
| `sentinel` | (PRD-intake feedback issue marker, GitHub/Linear self-host only) | — | `prd-intake-feedback` |

### PRD rollup behavior

PRD lifecycle completion is **derived** from the PRD's generated top-level work, not set independently — see the `prd-lifecycle-rollup` rule for the full contract (generated-top-level-work definition, per-vendor terminal-state predicate, the `shipped` transition, verified native closure, and the child-ref idempotency key). When all required generated top-level children are terminal, rollup transitions the PRD to its `shipped` role and leaves it open/active for `/lisa:verify-prd`. There is no project-configurable close-on-shipped flag: provider-native closure/archive/completion happens only after `/lisa:verify-prd` passes and moves the PRD to `verified`.

### Repair intake config (`intake.repair`)

`lisa-repair-intake` (the recovery counterpart to `lisa-intake`) reads two optional tuning keys
from the top-level `intake.repair` block. Both are **optional** — a missing block inherits the
documented defaults, so existing projects need no config change.

| Key | Required | Default | Notes |
|-----|----------|---------|-------|
| `intake.repair.staleAfterHours` | no | `2` | How long an in-progress item (build `claimed`, PRD `in_review`) may sit after its last state-changing transition into the in-progress role, or after the last human / PR-side forward-progress activity, before repair-intake treats it as stalled and resumes it. Automation self-comments and Lisa audit notes do not reset this clock. `blocked` items are judged on blocker/answer state, not this threshold. Overridable per-run via `stale_after=<dur>` in `$ARGUMENTS` (which always wins). The same value is the default backoff window for loop-prevention notes. |
| `intake.repair.maxCandidates` | no | `100` | Upper bound on how many stuck items repair-intake enumerates while searching for the first actionable one. Bounds scan cost. Overridable per-run via `max_candidates=<n>`. |

### Monitor audit config (`monitor`)

`lisa-monitor`'s audit-and-file arm reads an optional top-level `monitor` block. Every key is
**optional** — a missing block inherits the documented defaults, so existing projects need no
config change. The role SEMANTICS (what counts as an anomaly or gap, how findings become tickets)
are fixed like every other lifecycle behavior; only these thresholds and caps are tunable. Full
contract: the `observability-audit` rule.

| Key | Required | Default | Notes |
|-----|----------|---------|-------|
| `monitor.maxCandidates` | no | `20` | Cap on tickets filed per standalone run (`core`/high-severity first). Overridable per-run via `max_candidates=<n>` in `$ARGUMENTS`, which always wins. |
| `monitor.gapTiers` | no | `core` | Which gap tier files tickets by default: `core` (operationally load-bearing dimensions only) or `all` (also `recommended`). The `--all-gaps` run flag forces `all` for that invocation. |
| `monitor.backoffHours` | no | `24` | How long after a finding's ticket is closed/resolved to keep suppressing a re-file (the recently-resolved dedup window), so a just-fixed regression isn't re-filed before its signal drains. Distinct from `intake.repair.staleAfterHours` (2h). |
| `monitor.thresholds.minEvents24h` | no | `1` | Minimum 24h event count for an unresolved monitored error to be fileable. |
| `monitor.thresholds.errorRateSpikeMultiplier` | no | `2` | Error rate must be ≥ this × the prior-window baseline (and above an absolute floor) to file. |
| `monitor.thresholds.p95LatencyMs` | no | `1000` | p95 latency at/above this (or up ≥ 50% vs prior window) is a fileable regression. |
| `monitor.thresholds.faultRatePct` | no | `5` | Fault observations above this percentage of observations in the window constitute a fileable anomaly. |

Resolution order matches every other key: `$ARGUMENTS` override → `.lisa.config.local.json` →
`.lisa.config.json` → built-in default. `monitor` files only within the current repo (type-scoped
rubric + `repo:<name>` single-repo leaves); it never fixes — the `intake` cron implements what it
files.

### Intake assignee filter (`intake.assignee`)

The optional intake assignee filter narrows **ready-item selection only**. It never assigns or
reassigns tickets; it simply tells build-intake to consider only ready items that are already
assigned to the resolved person for this local run.

Resolution order:

1. `$ARGUMENTS` `assignee=<vendor-user-id-or-login>`
2. `.lisa.config.local.json` `intake.assignee`
3. empty default (no filtering)

The setting is intentionally **local-only**: personal or machine-specific intake lanes belong in
`.lisa.config.local.json`, not the committed project config. An empty resolved value disables the
filter and preserves the shared ready-queue behavior.

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `intake.assignee` | no | empty | Local ready-queue filter for build intake. When non-empty, vendor build-intake skills query only ready items already assigned to that vendor-specific user id or login. When empty, no assignee filter is applied. Runtime `$ARGUMENTS` `assignee=<...>` always wins over config for that invocation. |

Resolution order matches every other key: `$ARGUMENTS` override → `.lisa.config.local.json` →
`.lisa.config.json` → built-in default. The role SEMANTICS repair-intake operates on (which
roles count as "stuck", what each repair does) are fixed like every other lifecycle transition;
only these thresholds are tunable.

### Env-keyed `done`

The `done` role is special: the terminal status/label depends on which environment a PR was merged into. A hotfix to staging ends at `On Stg`; a production hotfix ends at `Done`. So `done` is a **map** keyed by env name (`dev`, `staging`, `production`).

Skills that transition to `done` MUST resolve the env first:

1. **Explicit caller arg** (`target_env=staging`) — always wins.
2. **Branch inference** — derive from the PR's base branch via `deploy.branches`. Reverse-lookup: if base branch is `staging`, env is `staging`.
3. **Failure** — if neither resolves and `done` is a map, fail loudly. Never pick arbitrarily.
4. **Promotion-completeness gate** — the env steps 1–2 produced is only *claimed*. Cap it at the highest **provably reached** env before writing anything. See below; this step is mandatory and applies to an explicit `target_env` too.

If a project's terminal state is the same regardless of env, set `done` to a string instead of a map (lifecycle skills accept either shape).

#### Promotion-completeness gate

A merged PR's base branch proves only which branch the merge landed on — never that the environments *below* that branch carry it. A hotfix merged straight to `main` therefore satisfies "reached production" by an out-of-order route, and writing the terminal value on that evidence closes the item while a lower environment has none of the fix. Steps 1–2 select a **claim**; this step proves it.

Walk `deploy.order` from its **lowest** rung up to and including the resolved env, and write the highest **contiguously reached** rung. A rung is *reached* only when both halves hold for its `deploy.branches` branch:

- **Ancestry — positive proof, required.** `git merge-base --is-ancestor <merge-sha> origin/<branch>` must affirmatively succeed, asserted for **every** rung at or below the resolved env, not only the PR's base. Fetch first. A branch that does not exist, cannot be fetched, or whose check does not succeed is **not** reached.
- **Deploy health — absence of a concluded failure.** That branch's most recent **concluded** deploy did not conclude failure, read from the same deploy surface the vendor scanners already use (a deploy workflow run or a deployment status keyed to the branch via `deploy.branches`). Read the `conclusion` field, **never** the `status`: an in-flight deploy has a `null` conclusion and is indistinguishable from a pass on `status`. A rung with no concluded deploy run — the project has no deploy surface for that branch, or none has finished — has no concluded failure and passes this half; the reason line must then say *no concluded deploy observed* rather than implying a green deploy was seen.

The first rung that fails ends the walk. Rungs **above** an unreached rung are not reached even when ancestry holds for them — that is precisely the skipped-environment case.

**Outcome.** The written value is `done[<highest contiguously reached rung>]`:

- Highest reached rung equals the resolved env → write it unchanged. A fix present in every environment resolves exactly as it does today.
- Highest reached rung is **below** the resolved env → write that lower, intermediate value. Intermediate values are waypoints, so per `leaf-only-lifecycle` the item stays natively open and the promotion gap is what holds it open.
- **No** rung is reached (the lowest fails) → write nothing, leave the item in its current role, and record the refusal.

**The gate only ever lowers the resolved env; it never raises one.** It can hold an item open longer than the ungated resolution would, and can never close one the ungated resolution would have left open. It also does not relax any stricter hold already in force — notably, a still-running deploy on the merged-into branch keeps the item at `claimed` for a later cycle exactly as before; the gate adds the lower rungs, it does not license closing on an unfinished deploy.

**Every refusal or downgrade MUST name the first unreached rung, its branch, and which half failed.** For example `staging (origin/staging): merge <sha> is not an ancestor` or `staging (origin/staging): most recent concluded deploy run <id> concluded failure`. A bare "blocked on promotion" is not an acceptable reason — the operator standing at the gate cannot act on it.

**When the ladder is unknowable.** `deploy.order` is optional (see "Env order (sync-down chain)"), and without it the rungs cannot be ranked, so contiguity cannot be evaluated:

- `deploy.branches` resolves to a **single distinct branch** → there is no promotion chain, the gate is vacuous, and resolution is unchanged.
- **More than one distinct branch and no `deploy.order`** → refuse to write a terminal value and name the missing `deploy.order` as the reason (`lisa-doctor` already WARNs on exactly this config). Never write a terminal value on an unevaluated gate. An intermediate value may still be written, since it closes nothing.

**A promotion gap is incomplete delivery, not branch hygiene.** An open back-fill PR against a skipped environment, or a lower branch that "just needs a merge down", is the item's own undelivered work and holds it open. Observing the gap and filing it under hygiene is the exact misclassification this gate exists to prevent. The gap is cleared by `lisa-sync-down`, which consumes the same `deploy.order`; a later cycle re-evaluates the gate and the item advances on its own.

Reference implementation, embedded verbatim by the vendor build-intake skills:

<!-- promotion-completeness-gate:start -->

```bash
# Promotion-completeness gate (config-resolution → "Promotion-completeness gate").
# TARGET_ENV is only the *claimed* env. Cap it at the highest contiguously
# reached rung of deploy.order; never raise it. GATE_REASON names the first
# unreached rung, its branch, and which half failed.
#
# Sets globals rather than echoing: command substitution would run the walk in a
# subshell and discard GATE_REASON, leaving a refusal with no operator-readable
# cause. Do not "simplify" this into REACHED_ENV=$(...).
REACHED_ENV=""; GATE_REASON=""; GATE_NOTES=""

# Default deploy surface (GitHub Actions): echo the conclusion of the most
# recent CONCLUDED run for a branch, empty when none has concluded. Projects
# deploying through another surface define this function before the gate runs;
# the guard leaves such an override in place.
if ! command -v deploy_conclusion_for_branch >/dev/null 2>&1; then
  deploy_conclusion_for_branch() {
    gh run list --branch "$1" --limit 30 --json conclusion \
      --jq '[.[] | select(.conclusion != null and .conclusion != "")][0].conclusion' \
      2>/dev/null
  }
fi

promotion_gate() { # $1 = claimed env, $2 = merge sha
  claimed="$1"; sha="$2"; reached=""
  distinct=$(jq -r '.deploy.branches // {} | .[]' .lisa.config.json 2>/dev/null | sort -u | grep -c .)
  if [ "${distinct:-0}" -le 1 ]; then   # single branch: no promotion chain, gate is vacuous
    REACHED_ENV="$claimed"; return 0
  fi
  order=$(jq -r '.deploy.order // [] | .[]' .lisa.config.json 2>/dev/null)
  if [ -z "$order" ]; then
    GATE_REASON="deploy.order missing for a multi-branch project: promotion ladder unknowable"
    return 0
  fi
  if ! printf '%s\n' "$order" | grep -qx "$claimed"; then
    GATE_REASON="claimed env '$claimed' is absent from deploy.order"
    return 0
  fi
  git fetch --quiet origin 2>/dev/null || true
  # Heredoc (not a pipe) so the loop body runs in this shell and its
  # assignments survive.
  while IFS= read -r rung; do
    [ -z "$rung" ] && continue
    branch=$(jq -r --arg e "$rung" '.deploy.branches[$e] // empty' .lisa.config.json 2>/dev/null)
    if [ -z "$branch" ] || ! git merge-base --is-ancestor "$sha" "origin/$branch" 2>/dev/null; then
      GATE_REASON="$rung (origin/${branch:-<unmapped>}): merge $sha is not an ancestor"
      break
    fi
    # Deploy health: most recent CONCLUDED run only. Never read .status — an
    # in-flight run has a null conclusion and looks like a pass on .status.
    # No concluded run at all => no concluded failure => this half passes.
    concluded=$(deploy_conclusion_for_branch "$branch")
    case "$concluded" in
      failure | timed_out | startup_failure | action_required)
        GATE_REASON="$rung (origin/$branch): most recent concluded deploy concluded $concluded"
        break
        ;;
      "") GATE_NOTES="${GATE_NOTES}${rung}: no concluded deploy observed; " ;;
    esac
    reached="$rung"
    if [ "$rung" = "$claimed" ]; then break; fi
  done <<EOF
$order
EOF
  REACHED_ENV="$reached"
  return 0
}

promotion_gate "$TARGET_ENV" "$MERGE_SHA"
if [ -z "$REACHED_ENV" ]; then
  echo "REFUSED: no environment provably reached — $GATE_REASON"
  exit 1
fi
if [ "$REACHED_ENV" != "$TARGET_ENV" ]; then
  echo "CAPPED: $TARGET_ENV -> $REACHED_ENV (intermediate; item stays natively open) — $GATE_REASON"
fi
# Rungs admitted on ancestry alone must say so; never let silence read as a
# green deploy.
if [ -n "$GATE_NOTES" ]; then
  echo "GATE NOTE: $GATE_NOTES"
fi
TARGET_ENV="$REACHED_ENV"
```

<!-- promotion-completeness-gate:end -->

The gate's inputs are `TARGET_ENV` (the claimed env from steps 1–2) and `MERGE_SHA` (the merged PR's merge commit — GitHub: `gh pr view <n> --json mergeCommit --jq .mergeCommit.oid`). A caller that cannot produce a merge sha has no delivery to prove and must not write an env-keyed `done` at all.

`cancelled` is deliberately **not** treated as a concluded failure. Deploy workflows commonly use concurrency groups that auto-cancel a superseded run, which would otherwise become "the most recent concluded run" in a normal race and hold every item open for a reason no operator can act on. The skipped-environment case this gate exists for is caught by the ancestry half, which does not depend on any deploy surface.

`deploy_conclusion_for_branch <branch>` is the project's deploy surface, echoing the `conclusion` of the most recent **concluded** run for that branch and empty when none has concluded. On GitHub the default is `gh run list --branch <branch> --limit 30 --json conclusion,workflowName --jq '[.[] | select(.conclusion != null and .conclusion != "")][0].conclusion'`, narrowed with `--workflow <deploy workflow>` where the project's deploy workflow is known. A repo whose deploy surface is GitHub Deployments reads the latest deployment status for the env instead. The gate never invents a surface: when none is observable, that half passes on absence-of-failure and the reason says so.

### Env → base branch (forward: the build base and PR base)

`deploy.branches` is also read in the **forward** direction by the build flow (`lisa-implement`): the environment a work item targets determines the branch the work is built on and the branch the PR opens against.

The durable field forms are: bare configured key or `Confirmed: <env>` for a
human-confirmed value; `Inferred: <env> — evidence: <title|body|reproduction|hostname>`
for automation-backed evidence; and
`Assumption: <env> — remote default branch <branch>` for a generic fallback.
When the remote default has no unique environment reverse-map, the valid form is
`Assumption: remote default branch <branch>`.
Human confirmation replaces the automated annotation with a bare key or
`Confirmed: <env>`.

For a legacy bare value, use managed draft markers and current ticket content
only; do not require provider edit history. A marker proves automation and
requires re-annotation; otherwise unknown provenance plus conflicting evidence
stops for confirmation.

1. **Resolve provenance first.** Human-confirmed wins, then validated `Inferred:` evidence. Otherwise search the human-authored title, body, and reproduction steps or URL hostname for one unambiguous exact `deploy.branches` key. Exclude the complete `Target Backend Environment` section and other machine-authored metadata/draft blocks from the scan so annotations cannot become evidence. Evidence supersedes only an `Assumption:`.
2. **Normalize narrowly.** Normalize built-in `prod` ↔ `production` only when exactly one of those keys is configured. No other aliases exist. Never infer from arbitrary branch text, URL paths/query strings, or substrings.
3. **Handle absence and conflict explicitly.** Multiple conflicting signals stop. With no signals, use the remote default branch (`gh repo view --json defaultBranchRef`, or `origin/HEAD`) and record the env-bearing assumption only for a unique reverse-map; otherwise use the branch-only assumption without inventing an environment or blocking.
4. **Validate the destination.** The selected exact configured key must map uniquely and the mapped remote branch must exist; otherwise stop without guessing or falling back.
5. **Before any code is written**, `lisa-implement` fetches and **rebases the working branch onto `origin/<base>`, resolving conflicts**, then opens the PR against that same base (`target_branch=<base>`).

This is the exact inverse of the env-keyed `done` "Branch inference" above: `done` derives the env *from* the PR base branch (reverse); the build flow derives the base branch *from* the env (forward). Both use the one `deploy.branches` map, so the branch a PR targets and the `done` status it earns always agree.

The true terminal `done` value is also the only value that triggers provider-native closure / resolution per `leaf-only-lifecycle`:

- If `done` is a string, that value is terminal.
- If `done` is an env-keyed map, the production / final environment's value is terminal. The conventional key is `production`; project-specific final env names must be explicit in deploy config or the lifecycle skill must fail rather than guessing.
- Intermediate env values (`dev`, `staging`, or configured equivalents) are deployment waypoints. Applying them must not close / resolve / complete the native tracker item.

### Env order (sync-down chain)

`deploy.order` is an **optional** array of the same env names used as keys in
`deploy.branches`, listed **lowest environment first** (promotion order), e.g.
`["dev", "staging", "production"]`. It encodes the one thing `deploy.branches`
cannot: the relative rank of environments. `deploy.branches` is an unordered map,
so without `deploy.order` the rank of a custom env name (`preprod`, `qa`, …) is
unknowable.

The Lisa back-sync flow consumes `deploy.order` to derive its source → target
chain. It walks the order from the
**highest** environment **down**, mapping each env's branch to the next-lower
env's branch:

- `order: ["dev","staging","production"]` + `branches: {dev:dev, staging:staging, production:main}`
  → chain `{"main":"staging","staging":"dev"}` (a hotfix on `main` back-syncs to
  `staging`, then `staging` back-syncs to `dev`). This is the inverse of the
  forward promotion order.

Rules:

- **Single-environment projects** (one entry in `deploy.branches`) may omit
  `deploy.order`; the derived chain is empty and the back-sync no-ops.
- **Projects whose environments all map to the same branch** (e.g.
  `dev`/`staging`/`production` all → `main`) may also omit `deploy.order`: the
  branches resolve to a single distinct branch, so there is nothing to back-sync
  and the derived chain is the empty no-op. `deploy.order` is only required when
  `deploy.branches` resolves to **more than one distinct branch**.
- **Multi-branch projects MUST set `deploy.order`** for config-driven back-sync.
  If `deploy.branches` resolves to more than one distinct branch and `deploy.order`
  is absent, the Action fails rather than guessing the rank (or the workflow
  wrapper must pass an explicit `chain`, which always wins).
- The env-name set of `deploy.order` and `deploy.branches` **must match exactly**
  — every env in one appears in the other. A mismatch is a config error.

This is the same `deploy.branches` map already used by env-keyed `done` (reverse:
env from PR base branch) and the build flow (forward: base branch from env);
`deploy.order` only adds the ranking those two directions never needed.

### What's configurable, what's not

- **Status / label NAMES** are configurable per project — that's the point of the vocabulary maps.
- **Role SEMANTICS and TRANSITIONS** are not. The build lifecycle is always `ready → claimed → done` (with optional `review` for label-driven systems). The PRD lifecycle is always `ready → in_review → (blocked | ticketed) → shipped`, then verification may move `shipped → verified` on a pass or `shipped → ticketed` on a failed verification. `verified` is terminal and product-owned like `draft` and `shipped`; Lisa does not add `prd-verifying` or `prd-verification-failed` states. Skills hardcode these transitions because they encode the design intent of the framework, not the project's preferences.
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

### Doctor config readiness

`/lisa:doctor` reads the same config, but it audits readiness instead of dispatching a write.
Doctor must validate config in three layers:

1. **Parse and merge**
   - Parse both config files as JSON. Missing or invalid `.lisa.config.json` is a blocking error.
     `.lisa.config.local.json` is optional, but if present and invalid it is also a blocking error.
   - Merge per key with the standard local-overrides-global rule. Doctor reports against the merged
     effective config; it does not treat the local file as a full replacement for the committed
     file.
2. **Required-key correctness**
   - Missing `tracker` after merge is a blocking error. Unknown merged `tracker` / `source` values
     are also blocking errors.
   - If the configured tracker/source vendor is missing its required keys after merge, doctor must
     report a blocking readiness failure using the vendor tables above. Examples: `tracker=github`
     requires `github.org` + `github.repo`; `tracker=jira` requires `atlassian.cloudId` +
     `jira.project`; `source=notion` requires `notion.workspaceId` + `notion.prdDatabaseId`.
3. **Field locality correctness**
   - `atlassian.email`, `intake.assignee`, and `jira.verified_workflow_hash` are local-only. If
     they appear in committed config, doctor warns that developer-specific state was checked into
     the project file.
   - Project-wide fields that exist only in `.lisa.config.local.json` should warn, not pass
     silently. Current machine works, repository not durably configured for teammates and
     automations. Common examples include `tracker`, `source`, `github.org`, `github.repo`,
     `atlassian.cloudId`, `atlassian.site`, `jira.project`, `linear.workspace`, `linear.teamKey`,
     and `deploy.branches`.

4. **Deploy env-order correctness**
   - When `deploy.branches` resolves to more than one **distinct** branch but `deploy.order` is
     absent, `WARN`: config-driven back-sync cannot derive a chain without the ranking (the wrapper
     must add `deploy.order` or pass an explicit `chain`).
   - When `deploy.branches` defines multiple environments that all map to the **same** branch (e.g.
     `dev`/`staging`/`production` all → `main`), `deploy.order` is **not** required — the chain is the
     empty no-op. Do not `WARN` in this case.
   - When `deploy.order` is present but its env names do not exactly match the `deploy.branches`
     keys, `FAIL` — the derived sync-down chain would be wrong or empty.

Doctor's severity rule is simple: unusable merged config is `FAIL`; locality drift with a still
usable merged config is `WARN`.

### Doctor vendor preflight

Once doctor can resolve the merged `tracker` and optional `source`, it must run a read-only vendor
preflight for those configured vendors only.

1. **Audit only the configured vendors**
   - Always audit the merged `tracker`.
   - Audit `source` when present and when it is not already covered by the tracker check.
   - Every other vendor is a doctor `SKIP`, not an implicit pass.
2. **Read-capable substrate requirement**
   - `github` requires `gh` CLI, a passing `gh auth status`, and read access to the configured
     repo (`github.org` + `github.repo`).
   - `jira` / `confluence` must reuse the `atlassian-access` substrate ladder. Doctor passes when
     at least one supported read-capable substrate (`acli`, Atlassian MCP, or validated curl/API
     token) can prove visibility to the configured `atlassian.cloudId` and target scope.
   - `linear` passes when either the Linear MCP or a validated API-key probe can read the
     configured workspace; tracker mode also requires visibility to `linear.teamKey`.
   - `notion` passes when either the Notion MCP identity matches `notion.workspaceId` or a valid
     internal-integration token does, and the configured `notion.prdDatabaseId` is readable.
3. **Observed-fact discipline**
   - Missing executable / MCP availability and failed auth/scope probes must be reported
     separately.
   - Preserve the exact probe failure text or status code when a read attempt fails; doctor should
     not collapse repo-not-found, wrong-workspace, and unauthenticated cases into one generic
     readiness error.
4. **Severity**
   - No read-capable substrate for the configured vendor, or a configured target that remains
     unreadable after all supported probes, is a doctor `FAIL`.
   - A reachable vendor with only auxiliary-substrate degradation is a doctor `WARN`.

### Doctor automation readiness

Doctor's automation-readiness group is also read-only. It answers "could this repo safely support
Lisa's recurring automations from the current runtime?" without creating, editing, deleting, or
reconciling any automation state.

1. **Resolve the automation queues from merged config**
   - Resolve the PRD automation queue from merged `source`.
   - Resolve the build automation queue from merged `tracker`.
   - Resolve repair-intake from the same queue-detection contract `lisa-intake` /
     `lisa-repair-intake` already use; doctor should not invent a second queue schema.
   - If an automation's queue cannot be resolved because `source`, `tracker`, or the selected
     vendor's required keys are still missing after merge, that automation is a doctor `FAIL`.
     Unattended runs would be ambiguous before the scheduler is even involved.
2. **Check native scheduler availability by runtime, read-only**
   - Codex automation support means the runtime exposes the native automations surface
     (`automation_update`) that `setup-automations` depends on.
   - Claude automation support means `/schedule` is available.
   - Other runtimes should be reported explicitly as having no known native Lisa scheduler unless a
     supported surface is observable.
   - Doctor must not create a throwaway automation just to prove the scheduler exists.
3. **Match exploratory automation support to the repo's shipped stack**
   - `exploratory-bugs` exists only for stacks that ship `exploratory-qa` (`expo`, `rails`,
     `harper-fabric`). If the repo lacks that command surface, doctor reports the automation as
     `SKIP`, not `FAIL`.
   - `exploratory-prds` follows the normal queue-resolution rules; if its prerequisites are
     unresolved, preserve the exact blocking config fact.
4. **Severity**
   - Queue resolution failure is a doctor `FAIL`.
   - Missing native scheduler support in an otherwise manually-usable repo is a doctor `WARN`.
   - Intentional absence of an optional exploratory automation surface is a doctor `SKIP`.

## Skill mapping

The shim → vendor mapping is fixed:

| Shim | jira tracker | github tracker | linear tracker |
|------|--------------|----------------|----------------|
| `lisa-tracker-write` | `lisa-jira-write-ticket` | `lisa-github-write-issue` | `lisa-linear-write-issue` |
| `lisa-tracker-validate` | `lisa-jira-validate-ticket` | `lisa-github-validate-issue` | `lisa-linear-validate-issue` |
| `lisa-tracker-verify` | `lisa-jira-verify` | `lisa-github-verify` | `lisa-linear-verify` |
| `lisa-tracker-read` | `lisa-jira-read-ticket` | `lisa-github-read-issue` | `lisa-linear-read-issue` |
| `lisa-tracker-claim` | `lisa-jira-claim` | `lisa-github-claim` | `lisa-linear-claim` |
| `lisa-tracker-evidence` | `lisa-jira-evidence` | `lisa-github-evidence` | `lisa-linear-evidence` |
| `lisa-tracker-sync` | `lisa-jira-sync` | `lisa-github-sync` | `lisa-linear-sync` |
| `lisa-tracker-add-journey` | `lisa-jira-add-journey` | `lisa-github-add-journey` | `lisa-linear-add-journey` |
| `lisa-tracker-journey` | `lisa-jira-journey` | `lisa-github-journey` | `lisa-linear-journey` |
| `lisa-tracker-create` | `lisa-jira-create` | `lisa-github-create` | `lisa-linear-create` |
| `lisa-tracker-build-intake` | `lisa-jira-build-intake` | `lisa-github-build-intake` | `lisa-linear-build-intake` |

The `tracker-source-artifacts` skill (formerly `tracker-source-artifacts`) is read-only and vendor-neutral — it has no shim and is invoked directly by every `*-to-tracker` skill and every destination write skill (`jira-write-ticket`, `github-write-issue`, `linear-write-issue`).

## Caller responsibilities

- **PRD-source skills** (`notion-to-tracker`, `confluence-to-tracker`, `linear-to-tracker`, `github-to-tracker`) MUST invoke `tracker-write` and `tracker-validate` — never `jira-write-ticket` / `github-write-issue` / `linear-write-issue` directly. This is what makes a project's destination switchable via config.
- **Lifecycle skills** (`implement`, `verify`, `monitor`) MUST invoke `tracker-read`, `tracker-claim`, `tracker-evidence`, `tracker-sync` for ticket interaction — never the vendor-specific equivalents.
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

- PRD-source labels: `prd-draft`, `prd-ready`, `prd-in-review`, `prd-blocked`, `prd-ticketed`, `prd-shipped`, `prd-verified` — owned by `github-prd-intake`, `verify-prd`, and the human PM.
- Build-queue labels: `status:ready`, `status:in-progress`, `status:on-dev`, `status:done` — owned by `github-build-intake` and `github-agent`.
- Sentinel issue label: `prd-intake-feedback` — owned by `github-prd-intake`.

Never overload one label across both lifecycles.

The same separation applies for Linear self-host (`source = "linear"` AND `tracker = "linear"`), with one asymmetry: project-level **labels** (`prd-*`) drive the PRD lifecycle, because a PRD is a Linear Project and Projects carry their own status object rather than Issue workflow states; issue-level **workflow states** (`linear.workflow`) drive the build lifecycle; the sentinel feedback issue carries the issue-level `prd-intake-feedback` label. So on Linear the two lanes are not merely different vocabularies, they are different *mechanisms* — never move a PRD by state or an Issue by `status:*` label.

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
  # Preferred path: the single secrets chokepoint, which owns the one-store rule
  # and the surface ladder. An agent following this reference must try it before
  # any keychain — a second reader is how one credential ends up in two places.
  #
  # Resolver scripts are executable code, so a familiar checkout-local path is
  # not provenance. Use only machine-managed plugin roots and the installed
  # package; never execute repository-controlled candidates from this ladder.
  local candidates=()
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    candidates+=("$CLAUDE_PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    candidates+=("$PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  local repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  candidates+=("$repo_root/node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  local resolver
  local tried=()
  for resolver in "${candidates[@]}"; do
    tried+=("$resolver")
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get NOTION_API_TOKEN 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      # Empty/error means this substrate had no answer; try the next trusted one.
    fi
  done
  # Legacy fallback: the OS keychain written by the guided setup flow, for
  # projects with no credentials provider. Reached only when the chokepoint is
  # absent or has no entry.
  local from_keychain=""
  case "$(uname -s)" in
    Darwin)  from_keychain=$(security find-generic-password -s lisa-notion -a "$workspace" -w 2>/dev/null) ;;
    Linux)   command -v secret-tool >/dev/null && \
             from_keychain=$(secret-tool lookup service lisa-notion account "$workspace" 2>/dev/null) ;;
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      from_keychain=$(LISA_CRED_TARGET="lisa-notion-${workspace}" powershell.exe -NoProfile -NonInteractive -Command '
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

  # Name every path. A bare empty return sends the next reader hunting for a
  # resolver they cannot see the absence of; the enumeration turns that into a
  # seconds-long diagnosis. Paths and store coordinates only — never any
  # resolved value, on any path.
  echo "Error: could not resolve NOTION_API_TOKEN through lisa-secrets-access or the legacy keychain." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  echo "  <OS keychain> service=lisa-notion account=$workspace" >&2
  return 1
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

## Repo scoping (multi-repo trackers)

A ticketing system can oversee **multiple repos** — e.g. one JIRA project (or Linear team) for `frontend`, `backend`, and `infrastructure`. When build-intake runs inside one repo, it must claim only the tickets that belong to **that** repo and skip the rest. Two pieces make this work; the claim-time enforcement lives in the `repo-scope-split` rule.

### The `repo:<name>` label (the repo marker)

A work item's target repo is recorded as a **label** `repo:<name>`, where `<name>` is the repo's short name (e.g. `repo:frontend`). The convention is uniform across trackers (JIRA / GitHub / Linear), consistent with the other namespaced labels (`status:`, `type:`, `component:`). On JIRA a **component** equal to the repo name is accepted as an alias (matches the legacy `component = "frontend"` JQL pattern). A leaf work unit carries **exactly one** `repo:<name>` (leaves are single-repo per `repo-scope-split`); a container (an Epic, or any item with open child work) may carry several or none.

The label is not required to exist up front: build-intake **determines** the target repo from the ticket's content + code surfaces when the label is absent and **stamps** `repo:<name>` so later cycles filter cheaply (see `repo-scope-split` "claim-time repo scoping").

### Current-repo resolution (which repo am I?)

Resolve the name of the repo intake is running in, highest priority first:

1. `.lisa.config.local.json` then `.lisa.config.json` `repo` (an explicit override, e.g. `"repo": "frontend"`).
2. `.lisa.config.json` `github.repo` when set (the repo's own identity).
3. The git remote basename: `basename -s .git "$(git remote get-url origin)"` (e.g. `git@github.com:acme/frontend.git` → `frontend`).

```bash
read_g() { local lv gv; lv=$(jq -r "$1 // empty" .lisa.config.local.json 2>/dev/null); gv=$(jq -r "$1 // empty" .lisa.config.json 2>/dev/null); echo "${lv:-${gv}}"; }
CURRENT_REPO=$(read_g '.repo')
[ -z "$CURRENT_REPO" ] && CURRENT_REPO=$(read_g '.github.repo')
[ -z "$CURRENT_REPO" ] && CURRENT_REPO=$(basename -s .git "$(git remote get-url origin 2>/dev/null)" 2>/dev/null)
```

If the current repo cannot be resolved by any tier, build-intake stops with a clear error rather than claiming tickets it cannot scope. The match is by repo short name (`repo:<CURRENT_REPO>`), case-insensitive.

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

# Tracker Resolution

Lisa supports two destination trackers: **JIRA** (default, original) and **GitHub Issues**. The active tracker is resolved per project from `.lisa.config.json`.

This rule is the single source of truth for how every vendor-neutral skill (the `tracker-*` family, the `*-to-tracker` PRD-source skills, and the lifecycle skills `implement` / `verify` / `monitor`) decides which destination to write to.

## Configuration

Read `.lisa.config.json` (or `.lisa.config.local.json` if present — local overrides global) from the repo root. The schema additions:

```json
{
  "tracker": "jira",
  "github": {
    "org": "<org-or-user>",
    "repo": "<repo>"
  }
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `tracker` | no | `"jira"` | One of `"jira"` or `"github"`. Missing key resolves to `"jira"` for back-compat. |
| `github.org` | when `tracker = "github"` | — | GitHub org or user name. |
| `github.repo` | when `tracker = "github"` | — | GitHub repository name. |

## Resolution algorithm

Every `tracker-*` shim and every vendor-neutral caller follows this:

1. Read `.lisa.config.json` (or `.lisa.config.local.json` if it exists; local takes precedence on per-key basis). Use `jq` from Bash; never hand-parse JSON.
2. Extract the `tracker` field. If missing or null, default to `"jira"`.
3. If `tracker = "jira"`, delegate to the matching `jira-*` skill.
4. If `tracker = "github"`, delegate to the matching `github-*` skill, AND ensure `github.org` and `github.repo` are present — stop and report if either is missing.
5. Any other value: stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira' or 'github'."`

## Skill mapping

The shim → vendor mapping is fixed:

| Shim | jira tracker | github tracker |
|------|--------------|----------------|
| `lisa:tracker-write` | `lisa:jira-write-ticket` | `lisa:github-write-issue` |
| `lisa:tracker-validate` | `lisa:jira-validate-ticket` | `lisa:github-validate-issue` |
| `lisa:tracker-verify` | `lisa:jira-verify` | `lisa:github-verify` |
| `lisa:tracker-read` | `lisa:jira-read-ticket` | `lisa:github-read-issue` |
| `lisa:tracker-evidence` | `lisa:jira-evidence` | `lisa:github-evidence` |
| `lisa:tracker-sync` | `lisa:jira-sync` | `lisa:github-sync` |
| `lisa:tracker-add-journey` | `lisa:jira-add-journey` | `lisa:github-add-journey` |
| `lisa:tracker-journey` | `lisa:jira-journey` | `lisa:github-journey` |
| `lisa:tracker-create` | `lisa:jira-create` | `lisa:github-create` |
| `lisa:tracker-build-intake` | `lisa:jira-build-intake` | `lisa:github-build-intake` |

The `jira-source-artifacts` skill is read-only and vendor-neutral — it has no shim and no GitHub counterpart. Both vendors invoke it directly.

## Caller responsibilities

- **PRD-source skills** (`notion-to-tracker`, `confluence-to-tracker`, `linear-to-tracker`, `github-to-tracker`) must invoke `tracker-write` and `tracker-validate` — never `jira-write-ticket` / `github-write-issue` directly. This is what makes a project's tracker switchable via config.
- **Lifecycle skills** (`implement`, `verify`, `monitor`) must invoke `tracker-read`, `tracker-evidence`, `tracker-sync` for ticket interaction — never the vendor-specific equivalents.
- **Per-vendor PRD intake skills** (`notion-prd-intake`, `confluence-prd-intake`, `linear-prd-intake`, `github-prd-intake`) compose the PRD-source skills (which in turn invoke the shims) — they do not need to read `tracker` themselves.

## Invariants

- Project tracker selection is **persistent** within a project — always read from config, never infer from the shape of `$ARGUMENTS`. If a developer wants a different destination for one run, they edit `.lisa.config.local.json`.
- A vendor-neutral skill never embeds vendor-specific terminology in its prompts (no "JIRA ticket key", "epic parent" — use "tracker key", "parent issue"). The vendor skill is responsible for translating its inputs.
- The shim layer is intentionally thin — its only job is dispatch. Gate logic, validation rules, and field schemas all live in the vendor skills.

## Self-host edge case (GitHub PRDs → GitHub destination)

When `github-to-tracker` is invoked AND `tracker = "github"`, both reads and writes hit the same GitHub repo. Label namespaces are kept separate so the two flows don't collide:

- PRD-source labels: `prd-draft`, `prd-ready`, `prd-in-review`, `prd-blocked`, `prd-ticketed`, `prd-shipped` — owned by `github-prd-intake` and the human PM.
- Build-queue labels: `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done` — owned by `github-build-intake` and `github-agent`.
- Sentinel issue label: `prd-intake-feedback` — owned by `github-prd-intake`.

Never overload one label across both lifecycles.

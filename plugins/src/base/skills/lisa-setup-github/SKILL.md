---
name: lisa-setup-github
description: "Configure GitHub Issues as the destination tracker and/or the PRD source for this project. Verifies the gh CLI is installed and authenticated, resolves `org/repo`, scaffolds the build-queue label namespace (`status:*`) when GitHub is the tracker and/or the PRD-lifecycle label namespace (`prd-*` + sentinel) when GitHub is the PRD source, writes the `github` section into `.lisa.config.json`, and offers to set top-level `tracker: \"github\"` and/or `source: \"github\"`. Idempotent — re-running updates the existing section and reuses existing labels rather than duplicating. No /lisa:setup:atlassian prerequisite (GitHub auth is standalone)."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Setup GitHub: $ARGUMENTS

Make GitHub Issues a tracker, a PRD source, or both for this project. After this skill, `.lisa.config.json` contains `github.org` + `github.repo`, the configured repo carries the lifecycle label namespaces lisa needs, and (optionally) `tracker` / `source` point at GitHub.

Unlike `setup-jira` / `setup-confluence`, this skill has **no `setup-atlassian` dependency** — GitHub auth runs through the `gh` CLI directly.

## Workflow

### Step 0 — Decide what GitHub is for

Ask via `AskUserQuestion` (multiSelect):

> What should lisa use this GitHub repo for?
>
> 1. **Destination tracker** — lisa writes Epics / Stories / Sub-tasks here as Issues, and the build queue (`/lisa:intake`, `/lisa:implement`) runs off the `status:*` label namespace. Sets `tracker: "github"`.
> 2. **PRD source** — humans drop PRDs here as Issues labeled `prd-ready`; `/lisa:intake` scans and ticketes them off the `prd-*` label namespace. Sets `source: "github"`.

The answer drives which label namespaces get scaffolded in Step 3: **tracker → `status:*`**, **source → `prd-*` + sentinel**. Self-host (both) is supported — the two namespaces never overlap (see the `config-resolution` rule's "Self-host edge case").

If the user selects neither, stop — there's nothing to configure.

### Step 1 — Ensure the gh CLI is installed and authenticated

```bash
if ! command -v gh >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install gh
  else
    cat >&2 <<'EOF'
Error: gh (GitHub CLI) not found and Homebrew unavailable. Install it:
  https://github.com/cli/cli#installation
Then re-run /lisa:setup:github.
EOF
    exit 1
  fi
fi

# Auth: prefer an interactive login; CI/headless uses GH_TOKEN.
if ! gh auth status >/dev/null 2>&1; then
  if [ -n "$GH_TOKEN" ] || [ -n "$GITHUB_TOKEN" ]; then
    echo "gh not logged in interactively, but GH_TOKEN/GITHUB_TOKEN is set — gh will use it."
  else
    cat >&2 <<'EOF'
Error: gh is not authenticated. Run:
  gh auth login           # interactive (developer machines)
or set GH_TOKEN as a secret (CI / headless), then re-run /lisa:setup:github.
EOF
    exit 1
  fi
fi
```

Confirm the authenticated identity can write Issues and labels — `gh auth status` shows the token scopes; `repo` scope (or fine-grained Issues: read-write + metadata: read) is required to create labels and issues. If the scopes look read-only, surface it and instruct `gh auth refresh -s repo`.

### Step 2 — Resolve `org/repo`

Honor any `--repo=org/repo` argument. Otherwise default-detect from the current repo's `origin` remote, then confirm — the tracker/PRD repo is frequently a *different* repo than the code repo (e.g. a dedicated `product-prds` repo):

```bash
DEFAULT_REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
```

Present the detected value via `AskUserQuestion`:

> Use `<DEFAULT_REPO>` as the GitHub repo for lisa's issues/PRDs, or specify a different `org/repo`?

Once resolved, split into `ORG` and `REPO` and confirm reachability + write access:

```bash
gh repo view "$ORG/$REPO" --json name,viewerPermission \
  --jq 'if (.viewerPermission | IN("ADMIN","MAINTAIN","WRITE")) then "ok" else error("insufficient permission: \(.viewerPermission)") end'
```

If permission is `READ` / `TRIAGE`, stop — lisa cannot create labels or issues. Surface and exit.

### Step 3 — Scaffold the lifecycle label namespaces

Read role → label mappings with the same default-fallback ladder the intake skills use, so the labels created here exactly match what they look for. Only the namespaces selected in Step 0 are scaffolded.

```bash
read_role() {  # $1=namespace (build|prd) $2=role $3=default
  local ns="$1" role="$2" default="$3" local_v global_v
  local_v=$(jq -r ".github.labels.${ns}.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.${ns}.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

# Idempotent label creator: create if missing, leave untouched if present.
ensure_label() {  # $1=name $2=hex-color $3=description
  local name="$1" color="$2" desc="$3"
  if gh label list --repo "$ORG/$REPO" --limit 200 --json name --jq '.[].name' | grep -qxF "$name"; then
    echo "  = $name (exists)"
  else
    gh label create "$name" --repo "$ORG/$REPO" --color "$color" --description "$desc" \
      && echo "  + $name (created)"
  fi
}
```

#### 3a. Build-queue labels (only if GitHub is the tracker)

Defaults from `config-resolution`. The `done` role is **env-keyed** — create all three by default; a project whose terminal state is env-independent can later collapse `github.labels.build.done` to a single string.

```bash
ensure_label "$(read_role build ready    status:ready)"        FBCA04 "Ready for build (human signal)"
ensure_label "$(read_role build claimed  status:in-progress)"  0E8A16 "Build in progress (agent owns)"
ensure_label "$(read_role build blocked  status:blocked)"      D93F0B "Blocked — human attention required"
ensure_label "$(read_role build done.dev        status:on-dev)" 1D76DB "Deployed to dev"
ensure_label "$(read_role build done.staging    status:on-stg)" 1D76DB "Deployed to staging"
ensure_label "$(read_role build done.production status:done)"   0E8A16 "Shipped to production"
```

#### 3b. PRD-lifecycle labels (only if GitHub is the PRD source)

```bash
ensure_label "$(read_role prd draft     prd-draft)"            C5DEF5 "PRD in progress (product owns)"
ensure_label "$(read_role prd ready     prd-ready)"            FBCA04 "PRD ready for ticketing"
ensure_label "$(read_role prd in_review prd-in-review)"        5319E7 "Claude is reviewing this PRD"
ensure_label "$(read_role prd blocked   prd-blocked)"          D93F0B "PRD blocked — see comments"
ensure_label "$(read_role prd ticketed  prd-ticketed)"         0E8A16 "Tickets created — see comments"
ensure_label "$(read_role prd shipped   prd-shipped)"          1D76DB "Work delivered (product owns)"
ensure_label "$(read_role prd verified  prd-verified)"         0E8A16 "Shipped product empirically verified against the PRD (product owns)"
ensure_label "$(read_role prd sentinel  prd-intake-feedback)"  EDEDED "Marker for PRD-intake feedback issues"
```

#### 3c. Handle name collisions / renames

If a project already uses a differently-named label for a role (e.g. `ready-for-dev` instead of `status:ready`), do NOT create a duplicate. Present the repo's existing labels via `AskUserQuestion` and let the user map the role to the existing label — that mapping becomes an override written in Step 4. Renaming-in-place (keeping lisa's defaults) is also fine if the user prefers; just surface the choice.

### Step 4 — Write `.lisa.config.json`

`github.org` / `github.repo` are project-wide → committed. Write **only label keys that differ from the documented defaults** — never echo the full default map into config (keeps it lean; missing keys inherit defaults at runtime).

```bash
touch .lisa.config.json
[ -s .lisa.config.json ] || echo '{}' > .lisa.config.json

jq --arg org "$ORG" --arg repo "$REPO" \
   '.github = ((.github // {}) | .org = $org | .repo = $repo)' \
   .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# Conditionally write label overrides (only roles the user mapped to non-default names).
# $LABEL_OVERRIDES_JSON is e.g. {"build":{"ready":"ready-for-dev"}} — {} if all defaults.
if [ -n "$LABEL_OVERRIDES_JSON" ] && [ "$LABEL_OVERRIDES_JSON" != "{}" ]; then
  jq --argjson o "$LABEL_OVERRIDES_JSON" \
     '.github.labels = ((.github.labels // {}) * $o)' \
     .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
fi
```

If this project later enables shared GitHub Project coordination, store it under the same `github` block as:

```json
"github": {
  "org": "<tracked-repo-owner>",
  "repo": "<tracked-repo>",
  "projects": {
    "v2": {
      "owner": { "kind": "organization", "slug": "<tracked-repo-owner>" },
      "number": 7,
      "required": false
    }
  }
}
```

That block is optional and coordination-only: real issues and pull requests stay the durable source of truth. In v1, `github.projects.v2.owner.slug` MUST match the tracked repository namespace (`github.org`) — user-owned repos use a user-owned Project, org-owned repos use an org-owned Project, and cross-namespace Project ownership is rejected. `required` defaults to `false`, meaning Project membership is best-effort unless a later setup/doctor flow explicitly opts into strict mode.

When that block is present, later setup/doctor and runtime validation must read the shared Project's owner + access before membership writes depend on it. Best-effort mode (`required: false`) reports warning-level validation failures and continues repository-local writes without Project membership; strict mode (`required: true`) reports the same failures as blocking errors and stops the write.

No secrets go in config — the GitHub token lives in `gh`'s own store (`~/.config/gh/`) or the `GH_TOKEN` env var, never in `.lisa.config.json`.

### Step 5 — Offer to set top-level `tracker` / `source`

For each role selected in Step 0, offer the matching top-level flag (skip if already set to GitHub).

If **tracker** was selected and `.tracker` is unset or not `"github"`, ask via `AskUserQuestion`:

> Repo `<org>/<repo>` configured. Set top-level `tracker: "github"` so all vendor-neutral skills write Issues here?

If yes: `jq '.tracker = "github"' ...`

If **source** was selected and `.source` is unset or not `"github"`, ask:

> Set top-level `source: "github"` so `/lisa:intake` (with no args) scans this repo for `prd-ready` PRDs?

If yes: `jq '.source = "github"' ...`

Both are project-wide switches that change every downstream skill's default — never set either without explicit confirmation.

### Step 6 — Verify

```bash
jq -e '.github.org and .github.repo' .lisa.config.json >/dev/null
gh label list --repo "$ORG/$REPO" --limit 200 --json name --jq '.[].name' \
  | grep -E 'status:|prd-' || true   # show the scaffolded namespaces
```

If `github.projects.v2` is configured, setup verification MUST also run the shared Project utility in
read-only resolution mode before declaring success:

```text
operation: resolve-project
```

This is the setup/doctor chokepoint for GitHub Project coordination. Do not inline ad-hoc GraphQL
here; delegate to `lisa-github-project-v2` so setup, doctor, writers, and linked-PR flows all read
the same owner/access contract and surface the same exact failure text.

Verification contract when `github.projects.v2` is present:

- First enforce the v1 namespace rule locally: `github.projects.v2.owner.slug` MUST equal
  `github.org`. If not, report the exact configuration failure and remediation:

  ```yaml
  code: project_namespace_mismatch
  message: "github.projects.v2.owner.slug must match github.org in v1"
  remediation: "Use a Project owned by <github.org> or remove github.projects.v2."
  ```

- Then resolve the configured Project owner + number through `lisa-github-project-v2`.
- Preserve the exact GitHub / GraphQL failure text for inaccessible or unsupported Project
  configurations. Examples: missing Project, `Resource not accessible by integration`, unsupported
  owner kind, or any other Project read failure.
- Report the exact remediation path. At minimum, say whether the operator must:
  1. choose a Project owned by the tracked repo namespace,
  2. grant the token Project read/write access,
  3. correct the configured Project number/owner, or
  4. remove `github.projects.v2` if coordination is not required.
- Branch severity on `required` exactly the same way the shared utility does:
  `required: false` => warning-level validation failure, continue repository-local setup success;
  `required: true` => blocking verification failure, stop setup/doctor before claiming coordination
  is usable.

The verify output should make the operator's next step obvious. Good examples:

```text
WARNING github.projects.v2: Resource not accessible by integration
Remediation: grant the token Project read/write access or remove github.projects.v2.required.
Repository-local GitHub issue/PR flows remain usable; Project coordination is disabled.
```

```text
ERROR github.projects.v2: github.projects.v2.owner.slug must match github.org in v1
Remediation: use a Project owned by CodySwannGT or remove github.projects.v2.
```

Report success with the resolved `org/repo`, which label namespaces were scaffolded (and which labels already existed vs. were created), any non-default label overrides written, and whether `tracker` / `source` were set. Direct the user to `/lisa:intake` to test.

## Idempotency

- Re-running merges the `github` section's fields rather than appending — `jq` merge semantics throughout.
- `ensure_label` is find-or-create: existing labels are left exactly as they are (color/description not overwritten), so a re-run never churns labels a human customized.
- Re-running does not re-prompt for `tracker` / `source` if they already point at GitHub.

## Rules

- Never write the GitHub token to `.lisa.config.json`. It stays in `gh`'s store or `GH_TOKEN`.
- Never create a duplicate label for a role that already has a (differently-named) label — map the role to the existing label and record it as a config override instead.
- Never overload one label across both the PRD and build namespaces — a single issue is either a PRD or a build ticket, never both (see `config-resolution`).
- Never set `tracker` / `source` without explicit user confirmation — they're project-wide and switch every downstream skill's behavior.
- Never invent an `org/repo`. Default-detect from the remote and confirm; if detection fails, ask the user to supply it.

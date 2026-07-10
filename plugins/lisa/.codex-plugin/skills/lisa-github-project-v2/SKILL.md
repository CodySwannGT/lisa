---
name: lisa-github-project-v2
description: "Shared GitHub ProjectV2…"
allowed-tools: ["Bash", "Read", "Skill"]
---

# GitHub ProjectV2: $ARGUMENTS

Single chokepoint for GitHub ProjectV2 coordination. Caller skills (`github-write-prd`,
`github-write-issue`, `git-submit-pr`, later linked-PR flows, later doctor/setup checks) MUST go through
this skill rather than duplicating `gh api graphql` calls.

The utility never invents policy. It applies the config + validation contract already defined in
`config-resolution`:

- `github.projects.v2` absent → coordination is disabled; callers keep repository-local writes.
- `required: false` → Project failures are warning-level, and the underlying issue / PR write
  remains the durable success.
- `required: true` → the same Project failures are blocking errors.

## Invocation contract

The caller passes exactly one operation plus its arguments:

```text
operation: resolve-project
operation: add-item         content_node_id: <issue-or-pr-node-id>
operation: ensure-item      content_node_id: <issue-or-pr-node-id>
operation: update-fields    item_id: <project-item-id> values: [{ field: "Status", option: "In Progress" }]
operation: add-and-update   content_node_id: <issue-or-pr-node-id> values: [{ field: "Repository", text: "frontend-v2" }]
```

Argument rules:

- `content_node_id` is the opaque GraphQL node id of a real GitHub Issue or Pull Request.
- `item_id` is the opaque Project item id returned by `add-item` / `ensure-item`.
- `values` is optional for `update-fields` / `add-and-update`. Omit it when membership alone is
  sufficient.

Return shape:

```yaml
enabled: true | false
required: true | false
outcome: disabled | resolved | added | reused | updated | warning | blocked
project_id: "<opaque-project-id>"
item_id: "<opaque-project-item-id>"
warnings:
  - "<warning text>"
error:
  code: "<stable-code>"
  message: "<exact gh / GraphQL failure>"
  remediation: "<next step>"
```

`error.message` MUST preserve the exact GitHub failure text (permission error, missing project,
field mismatch, duplicate-content response, etc.). Do not collapse failures into generic
"Project update failed."

## Workflow

### Step 1 — Resolve and validate config

Read config in local-overrides-first order:

```bash
read_cfg() {
  local path="$1"
  local lv gv
  lv=$(jq -r "$path // empty" .lisa.config.local.json 2>/dev/null)
  gv=$(jq -r "$path // empty" .lisa.config.json 2>/dev/null)
  echo "${lv:-$gv}"
}

ORG=$(read_cfg '.github.org')
REPO=$(read_cfg '.github.repo')
OWNER_KIND=$(read_cfg '.github.projects.v2.owner.kind')
OWNER_SLUG=$(read_cfg '.github.projects.v2.owner.slug')
PROJECT_NUMBER=$(read_cfg '.github.projects.v2.number')
REQUIRED=$(read_cfg '.github.projects.v2.required')
REQUIRED=${REQUIRED:-false}
```

If the `github.projects.v2` block is absent or incomplete, return:

```yaml
enabled: false
required: false
outcome: disabled
```

That is a clean no-op for best-effort callers; they continue the repository-local write path.

When the block is present:

1. Require `github.org`, `github.repo`, `owner.kind`, `owner.slug`, and `number`.
2. Enforce the v1 namespace rule: `owner.slug` MUST equal `github.org`.
3. Enforce supported owner kinds only: `organization` or `user`.
4. Confirm `gh auth status` succeeds before any GraphQL call.

Namespace mismatch is never silent. It returns a configuration failure with exact remediation:

```yaml
enabled: true
required: <required>
outcome: warning | blocked
error:
  code: project_namespace_mismatch
  message: "github.projects.v2.owner.slug must match github.org in v1"
  remediation: "Use a Project owned by <github.org> or remove github.projects.v2."
```

### Step 2 — Resolve the Project id

Resolve the human-facing owner + number to the opaque ProjectV2 id:

```bash
gh api graphql -f query='
query($login:String!,$number:Int!){
  organization(login:$login){ projectV2(number:$number){ id title number url } }
  user(login:$login){ projectV2(number:$number){ id title number url } }
}' -F login="$OWNER_SLUG" -F number="$PROJECT_NUMBER"
```

Pick the branch matching `owner.kind`. If the Project is missing, inaccessible, or the authenticated
identity cannot read it, preserve the exact GraphQL failure text in `error.message`.

Successful resolution returns:

```yaml
enabled: true
required: <required>
outcome: resolved
project_id: "<opaque-project-id>"
```

### Step 3 — Add an Issue or Pull Request to the Project

For `add-item`, `ensure-item`, or `add-and-update`, first resolve the Project id, then add the
provided Issue / Pull Request node id:

```bash
gh api graphql -f query='
mutation($projectId:ID!,$contentId:ID!){
  addProjectV2ItemById(input:{projectId:$projectId contentId:$contentId}){
    item { id }
  }
}' -F projectId="$PROJECT_ID" -F contentId="$CONTENT_NODE_ID"
```

Behavior:

- `add-item` expects the membership write to succeed and returns `outcome: added`.
- `ensure-item` is idempotent. If GitHub reports the content is already in the Project, return
  `outcome: reused` and surface the existing membership as a success, not a failure.
- `add-and-update` adds first, then continues into Step 4.

When GitHub returns a duplicate-membership or already-present response, `ensure-item` MUST branch
idempotently rather than rethrowing.

### Step 4 — Optionally update Project fields

If `values` are provided, apply them in order to the Project item returned from Step 3. Support the
common field types callers need first:

- single-select option by field name + option name
- text field by field name + text value
- iteration field by field name + iteration title
- date field by field name + ISO date

The utility resolves the Project's fields first, then performs the correct GraphQL mutation for the
typed value. Missing field names or option names are exact failures; never silently skip them.

Example shape:

```text
operation: add-and-update
content_node_id: <node-id>
values:
  - { field: "Status", option: "In Progress" }
  - { field: "Repository", text: "lisa" }
```

Successful field updates return `outcome: updated` with both `project_id` and `item_id`.

### Step 5 — Required vs best-effort branching

Every failure after config detection branches on `required`:

- **`required: false`** → return `outcome: warning`, preserve the exact error, and let the caller
  keep the underlying issue / PR write as the durable success.
- **`required: true`** → return `outcome: blocked` with the same exact error, causing the caller to
  fail the write before claiming Project coordination succeeded.

This means the exact same GitHub failure can surface in two different severities without changing
its message:

```yaml
enabled: true
required: false
outcome: warning
error:
  code: project_access_denied
  message: "Resource not accessible by integration"
  remediation: "Grant the token Project read/write access or disable github.projects.v2."
```

```yaml
enabled: true
required: true
outcome: blocked
error:
  code: project_access_denied
  message: "Resource not accessible by integration"
  remediation: "Grant the token Project read/write access or disable github.projects.v2."
```

## Rules

- Never create draft issues here. This utility coordinates real Issues / Pull Requests only.
- Never replace repository-local lifecycle truth with Project fields. Project membership is a
  coordination view layered on top.
- Never hide the original GitHub failure text.
- Never treat duplicate membership as an error for `ensure-item`.
- Never mutate issue / PR labels, comments, or body from this skill. Writers own those surfaces.
- All GitHub ProjectV2 membership and field writes go through this skill so future GraphQL changes
  are made in one place.

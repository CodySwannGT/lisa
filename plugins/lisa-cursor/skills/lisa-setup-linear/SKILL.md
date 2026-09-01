---
name: lisa-setup-linear
description: "Configure Linear as the destination tracker and/or the PRD source for this project. Verifies Linear access (MCP OAuth or a personal API key in OS keychain), resolves the workspace slug and team key, scaffolds the build-queue **workflow states** (`linear.workflow`) when Linear is the tracker and/or the PRD-lifecycle project-label namespace (`prd-*` + issue-level sentinel) when Linear is the PRD source, writes the `linear` section into `.lisa.config.json`, and offers to set top-level `tracker: \"linear\"` and/or `source: \"linear\"`. Idempotent — re-running updates the existing section and reuses existing labels. No /lisa:setup:atlassian prerequisite."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion", "mcp__linear-server__authenticate", "mcp__linear-server__complete_authentication"]
---

# Setup Linear: $ARGUMENTS

Make Linear a tracker, a PRD source, or both for this project. After this skill, `.lisa.config.json` contains `linear.workspace` (+ `linear.teamKey` when Linear is the tracker), the team carries the lifecycle states and label namespaces lisa needs, and (optionally) `tracker` / `source` point at Linear.

The two lifecycles run on different primitives, and conflating them is the most common setup error:

- **Build queue → native workflow STATES**, read from `linear.workflow.*`. Not labels. See "Why Linear uses states, not labels" in `config-resolution`, and Step 3a below. `lisa-linear-build-intake` reads only these.
- **PRD lifecycle → PROJECT labels** (`prd-*`), because a PRD is a Linear Project.

Project labels and issue labels are distinct namespaces in Linear and are NOT interchangeable — creating an issue label named `prd-ready` will not work for the PRD flow. The one issue label this skill creates is the sentinel feedback marker, which belongs to the PRD flow despite being an issue label (Linear's MCP has no project-level comments — see `linear-prd-intake`).

**A `status:*` issue-label namespace is no longer scaffolded or read.** It was the pre-state-model build lane; see "Migrating a project that predates the state model" below for what to do with a config that still carries it.

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
> 1. **Destination tracker** — lisa writes Epics→Projects, Stories→Issues, Sub-tasks→Sub-issues; the build queue runs off native workflow **states** (`linear.workflow`), not labels. Sets `tracker: "linear"`. (Requires a team key.)
> 2. **PRD source** — humans flag Linear **projects** with `prd-ready`; `/lisa:intake` scans and ticketes them off the `prd-*` project-label namespace. Sets `source: "linear"`.

The role answer drives Step 3 (states for the tracker lane, `prd-*` project labels for the PRD lane) and whether `teamKey` is required (tracker → yes).

### Step 1 — Establish Linear access

#### MCP path (1 or 2)

Verify the Linear MCP is authenticated to the right workspace by listing teams:

```text
lisa-linear-access operation: list-teams({})
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
  # Preferred path: the single secrets chokepoint. It owns the one-store rule
  # and the surface ladder, so anything it can answer must not be read out of an
  # OS keychain here — a second reader is how the same credential ends up living
  # in two places and drifting.
  #
  # The CANDIDATE LADDER below must stay identical to `linear-access`. What may
  # differ is only what happens after it: `linear-access` has nowhere else to
  # go and fails loudly, whereas this skill falls through to the legacy keychain
  # rung. Stating the invariant as "the ladder" rather than "this function" is
  # deliberate — the previous wording said to keep the whole thing identical,
  # which is not achievable, and a rule that cannot be followed is a rule that
  # gets ignored. That is exactly how this copy kept the two-rung ladder while
  # `linear-access` grew to seven, leaving `/lisa:setup:linear` unable to reach
  # a key that `lisa-linear-access` could read from the same repository.
  #
  # Ordered across trusted machine-managed substrates, ending at the installed
  # package. Checkout-local paths are deliberately absent: a familiar generated
  # destination is still repository-controlled executable code. The plugin
  # rungs are the floor: `resolve-secret.mjs` ships beside this skill, so a rung
  # pointing at it is reachable from anywhere the plugin itself is installed.
  # Execute only machine-managed plugin/package resolvers. Checkout-local
  # candidates are repository-controlled code, not trusted merely by path.
  local candidates=()
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    candidates+=("$CLAUDE_PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  if [ -n "${PLUGIN_ROOT:-}" ]; then
    candidates+=("$PLUGIN_ROOT/skills/lisa-secrets-access/scripts/resolve-secret.mjs")
  fi
  # Last rung deliberately needs no environment variable: an agent that was
  # never handed a plugin root still has the installed package to fall back on.
  candidates+=(node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs)

  local resolver
  local tried=()
  for resolver in "${candidates[@]}"; do
    tried+=("$resolver")
    if [ -f "$resolver" ]; then
      local via_lisa
      via_lisa=$(node "$resolver" get LINEAR_API_KEY 2>/dev/null) \
        && [ -n "$via_lisa" ] && { echo "$via_lisa"; return; }
      # Empty/error means this substrate had no answer; try the next trusted one.
    fi
  done
  # Legacy fallback: the OS keychain written by the guided flow below, for
  # projects that have not adopted a credentials provider. Reached only when the
  # chokepoint is absent or has no entry.
  local from_keychain=""
  case "$(uname -s)" in
    Darwin)  from_keychain=$(security find-generic-password -s lisa-linear -a "$ws" -w 2>/dev/null) ;;
    Linux)   command -v secret-tool >/dev/null && from_keychain=$(secret-tool lookup service lisa-linear account "$ws" 2>/dev/null) ;;
    MINGW*|MSYS*|CYGWIN*)
      # `cmdkey /generic ... /pass:` stores the secret in Windows Credential Manager, but
      # `cmdkey /list` never prints stored passwords (by design). Read the CredentialBlob
      # back via the Win32 CredRead API through PowerShell; pass the target name via an env
      # var to dodge nested quoting, and strip the CRLF powershell.exe appends.
      from_keychain=$(LISA_CRED_TARGET="lisa-linear-${ws}" powershell.exe -NoProfile -NonInteractive -Command '
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

  # Name every path, the same way `linear-access` does — the diagnostics are
  # part of the parity, not decoration. A silent empty return sends the next
  # reader hunting for a resolver they cannot see the absence of; the
  # enumeration turns that into a seconds-long diagnosis. Paths and store
  # coordinates only — never any resolved value, on any path.
  echo "Error: could not resolve LINEAR_API_KEY through lisa-secrets-access or the legacy keychain." >&2
  echo "Tried, in order (relative paths are from $PWD):" >&2
  printf '  %s\n' "${tried[@]}" >&2
  echo "  <OS keychain> service=lisa-linear account=$ws" >&2
  return 1
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
- **Team key** (required when Linear is the **tracker**): honor `--team=<KEY>`. Otherwise enumerate teams via `lisa-linear-access operation: list-teams({})` (or the GraphQL `teams` query) and present them via `AskUserQuestion` (label = team key, description = team name) for the user to pick the team that owns lisa's destination Issues. If Linear is source-only, `teamKey` is optional — skip unless the user wants to pin a team scope.

### Step 3 — Scaffold the lifecycle namespaces

Read role → label with the default-fallback ladder the intake skills use, so scaffolded labels match exactly what they query.

```bash
read_role() {  # $1=namespace (build|prd) $2=role $3=default
  local ns="$1" role="$2" default="$3" local_v global_v
  local_v=$(jq -r ".linear.labels.${ns}.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.labels.${ns}.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
```

#### 3a. Build-queue lifecycle — WORKFLOW STATES (only if Linear is the tracker)

The build lane resolves to native workflow **states**, not labels — see "Why Linear uses states, not labels" in `config-resolution`. Read role → state name with the same ladder, against `linear.workflow`:

```bash
read_state() {  # $1=role path (e.g. ready, done.dev) $2=default
  local role="$1" default="$2" local_v global_v
  local_v=$(jq -r ".linear.workflow.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.workflow.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
```

Enumerate the team's states with `lisa-linear-access operation: list-workflow-states` (each carries `id`, `name`, `type`, `position`). For each role, resolve in this order — the same cascade `lisa-setup-jira` uses, with one extra rung Linear affords that JIRA does not:

1. **Exact name match** → resolved, nothing to do. For `ready`, additionally refuse to resolve onto the team's DEFAULT state (`Todo` on a stock team): that inverts the gate from "a human flipped this" to "nobody has touched this" and makes every untouched backlog item claimable. Offer to create a dedicated state instead.
2. **A plausible existing state of the right `type`** (`ready` → `unstarted`, `claimed`/`review` → `started`, `blocked` → `started` or `unstarted`, terminal `done` → `completed`) → present the team's state list via `AskUserQuestion` and let the user pick which state means this role. Record the choice as a config override in Step 4.
3. **Nothing plausible** → offer to **create** the state via `lisa-linear-access operation: create-workflow-state` (name, `type`, `position`, colour), showing the exact name and type first. Linear's API permits this where JIRA's workflow editing is admin-gated — which is why this rung exists here and not there.
4. **User declines creation** → stop and say which role is unresolvable and that the lifecycle cannot run without it. Never silently fall back to a state whose meaning differs, and never invent a name in config that does not exist in the team.

| Role | Default state | `type` | Ships with a stock team? |
|------|---------------|--------|--------------------------|
| `ready` | `Ready` | `unstarted` | **no — must be created or mapped** |
| `claimed` | `In Progress` | `started` | yes |
| `review` | **none — optional, never seeded** | `started` | n/a |
| `blocked` | `Blocked` | `unstarted` | **no — must be created or mapped** |
| `done.dev` | `On Dev` | `started` | **no — must be created or mapped** |
| `done.staging` | `On Stg` | `started` | **no — must be created or mapped** |
| `done.production` | `Done` | `completed` | yes |

**`review` is OPTIONAL and this setup NEVER binds it unprompted.** It has no
default state, so there is nothing to resolve unless the user asks for a review
hold; leaving `linear.workflow.review` absent is a supported configuration
meaning the project runs no agent review step, and lifecycle skills skip that
transition entirely (`config-resolution` R1). Writing a binding a project did
not ask for is how agent-owned work reaches a human-only review lane — the
stock `In Review` state a team happens to ship is not evidence the project
wants one. Offer it only on an explicit request, and resolve it through the
same four-rung cascade as any other role.

**The env rungs are deliberately `started`, not `completed`.** `On Dev` and `On Stg` mean "merged and deployed *that far*" — work that is emphatically not finished. Typing them `completed` would make Linear treat them as closed: they would leave the active board, stop counting in cycles, and re-create the exact premature-closure problem this model exists to fix. Only `done.production` is `completed`.

**Position them between `In Review` and `Done`** so the board reads left-to-right in real lifecycle order. A team that orders its board differently can pass its own `position`.

**Turn off the team's `merge → Done` git automation.** Linear's per-team git automations (Settings → Team → Workflow, or the `gitAutomationStates` API) auto-complete an Issue on merge to **any** branch. With this model that automation is an unwanted second writer: it jumps an Issue straight to `Done` at a `dev` merge, skipping `On Dev` / `On Stg` and asserting production-done. Lisa itself moves the state at each rung, so the automation is redundant as well as wrong. Detect it and offer to delete it; leave `start` and `review` alone — those assert non-terminal states and are harmless.

#### 3b. PRD-lifecycle labels — PROJECT labels (only if Linear is the PRD source)

Probe with `lisa-linear-access operation: list-project-labels`. Create missing ones via `lisa-linear-access operation: create-project-label`. This probe-then-create is find-or-create per label: a label already present is reused untouched, so re-running never duplicates `prd-*`. These are a **separate label kind** from issue labels — creating an issue label of the same name will NOT work for the PRD flow.

`prd-verified` is the terminal lifecycle state after `prd-shipped` (the `verified` role from config-resolution, #591): `/lisa:verify-prd` transitions a Linear PRD project into it once the shipped product has been empirically verified against the PRD. Scaffold it through the same find-or-create path as every other `prd-*` row.

| Role | Default | Kind |
|------|---------|------|
| `draft` | `prd-draft` | project label |
| `ready` | `prd-ready` | project label |
| `in_review` | `prd-in-review` | project label |
| `blocked` | `prd-blocked` | project label |
| `ticketed` | `prd-ticketed` | project label |
| `shipped` | `prd-shipped` | project label |
| `verified` | `prd-verified` | project label |
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

# Conditionally write label overrides (markers + PRD lane only — the build lane
# is states now, and lives under .linear.workflow below).
if [ -n "$LABEL_OVERRIDES_JSON" ] && [ "$LABEL_OVERRIDES_JSON" != "{}" ]; then
  jq --argjson o "$LABEL_OVERRIDES_JSON" \
     '.linear.labels = ((.linear.labels // {}) * $o)' \
     .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
fi

# Workflow-state overrides: only roles whose resolved state name differs from
# the default, INCLUDING any the user mapped onto an existing state in 3a.
if [ -n "$WORKFLOW_OVERRIDES_JSON" ] && [ "$WORKFLOW_OVERRIDES_JSON" != "{}" ]; then
  jq --argjson w "$WORKFLOW_OVERRIDES_JSON" \
     '.linear.workflow = ((.linear.workflow // {}) * $w)' \
     .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
fi
```

**Migrating a project that predates the state model.** A config carrying
`linear.labels.build.{ready,claimed,review,blocked,done}` was written against the
old label-driven lane. Those keys are inert now — nothing reads them — but
leaving them in place reads as configuration and will mislead the next person.
Migrate in one pass, and do it before the first intake cycle runs, or that cycle
sees an empty queue:

1. Resolve each build role to a state per 3a, writing `linear.workflow`.
2. **Backfill live Issues**: for every Issue carrying a `status:*` label, set its
   workflow state to the role that label encoded. Do this before deleting
   anything — the labels are the only record of where each Issue sits.
3. Drop `build.{ready,claimed,review,blocked,done}` from `linear.labels`, keeping
   `build.human_needed` and the whole `prd` map.
4. Leave the `status:*` labels themselves in the workspace, unapplied, until the
   first intake cycle after the migration has run green. They are the rollback.

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

Confirm what was scaffolded is present: `list-workflow-states` for every build role when Linear is the tracker, `list_project_labels` for `prd-*` (including the terminal `prd-verified`) and `list_issue_labels` for the sentinel when Linear is the PRD source. Do NOT expect a `status:*` namespace — it is not part of this model. Report success with the resolved workspace, team key (if any), which namespaces were scaffolded (created vs. already existed), any non-default overrides, and whether `tracker` / `source` were set. Direct the user to `/lisa:intake` to test.

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

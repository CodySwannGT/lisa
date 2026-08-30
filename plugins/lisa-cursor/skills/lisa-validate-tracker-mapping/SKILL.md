---
name: lisa-validate-tracker-mapping
description: "Detect and repair drift between a project's configured Lisa status/label mappings and the live tracker/source workflow. Compares every lifecycle role in `.lisa.config.json` (JIRA `jira.workflow` statuses, GitHub/Linear `labels.{build,prd}`, Notion `notion.values` select options, Confluence `confluence.parents`) against the authoritative live names the access layer reports — catching renames, deletions, and case drift (e.g. config `On Stg` vs live `ON STG`). Read-only by default; `repair=true` rewrites the config to the canonical live names (config is fixed, never the tracker). Also reports advisory GitHub scoping-label smells that no config declares — `type:`/`priority:` outside their closed sets, `component:` synonyms of an established value, off-Fibonacci `points:` — which never gate and are never repaired. Audits the current repo by default, or sweeps a set of projects via `projects=<glob>` / `workspaces=<file>`. Safe to schedule for continuous drift detection."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Validate Tracker Mapping: $ARGUMENTS

`/lisa:validate-tracker-mapping` answers one question: **do the status/label names this project's `.lisa.config.json` maps each lifecycle role to still exist — with the exact name — in the live tracker and PRD source?**

Lisa's lifecycle is driven by configured role → name mappings (`ready` → `"Ready"`, `done.staging` → `"On Stg"`, a GitHub `ready` build label → `"status:ready"`, a Notion `ticketed` value → `"Ticketed"`, …). When someone renames or deletes a status in JIRA, a label in GitHub/Linear, or a select option in Notion, the config silently points at a name that no longer resolves. The symptom is downstream: a build finishes but the completion transition can't be found, so the item stalls — exactly the kind of half-broken state `/lisa:repair-intake` then has to clean up. This skill catches that drift at the source: the config-to-live mapping itself.

It is the audit/repair counterpart to `/lisa:setup:jira` (and the other `setup:*` skills): where `setup:*` *establishes* the mapping interactively, this skill *re-validates an existing mapping* against the live workflow and, on request, repairs the config to match.

## Confirmation policy

- **Default mode is read-only.** Detect drift and report. Never mutate config or the tracker.
- **`repair=true` enables writes — to the config only, never to the tracker.** Within repair mode:
  - **Case drift** (the live workflow has the same name with different casing — the configured name resolves case-insensitively but the canonical case differs) is repaired automatically: rewrite the config value to the live canonical name. This is non-destructive and unambiguous.
  - **Missing name** (no case-insensitive match exists in the live set — renamed beyond recognition or deleted) is **never** auto-repaired. Compute the closest live candidates and confirm via `AskUserQuestion` before writing. Default to leaving the value unchanged.
- This skill never renames or deletes anything in the tracker/source. Repair fixes the Lisa config to match reality; correcting the tracker itself is a human/admin decision made elsewhere.

## Arguments

- (none) — audit the **current repo** (`./.lisa.config.json`).
- `projects=<glob-or-path>` — batch sweep. Expands to every directory under the glob that contains a `.lisa.config.json`. Example: `projects=~/workspace/acme/projects/*`.
- `workspaces=<file>` — batch sweep driven by a Lisa workspaces file (the `{ "<project-path>": "<branch>" }` map used by `/lisa:update-projects`). Each key is a project path to audit. Combine with `filter=<substring>` to restrict to matching paths (e.g. `filter=acme`).
- `repair=true` — enable config repair (see confirmation policy). Default `false`.
- `lane=build|prd|both` — which mapping family to check. Default `both`. `build` = the destination `tracker` workflow; `prd` = the PRD `source` status/label mapping.

Batch mode runs the identical per-project audit on each resolved project and prints one section per project plus a roll-up summary.

## Step 1 — Resolve scope

```bash
# Single-repo (default): the audit target is the current directory.
# Batch: expand projects=<glob> to dirs containing .lisa.config.json,
# or read workspaces=<file> keys (optionally filtered).
```

For `workspaces=<file>`, parse with `jq` (never grep/sed JSON):

```bash
jq -r 'keys[]' "$WORKSPACES_FILE" \
  | sed "s#^~#$HOME#" \
  | while read -r proj; do
      [ -n "$FILTER" ] && case "$proj" in *"$FILTER"*) : ;; *) continue ;; esac
      [ -f "$proj/.lisa.config.json" ] && echo "$proj"
    done
```

Skip (and note) any path with no `.lisa.config.json`.

## Step 2 — Load the project's mappings

For each project, resolve the effective config from `.lisa.config.local.json` first, then `.lisa.config.json`:

```bash
read_config() {
  local path="$1" local_v global_v
  local_v=$(jq -r "$path // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r "$path // empty" .lisa.config.json 2>/dev/null)
  printf '%s\n' "${local_v:-$global_v}"
}
tracker=$(read_config '.tracker')
source=$(read_config '.source')
```

Resolve the **effective** role → name mapping using the same defaults `/lisa:intake` and `/lisa:setup:jira` use (config-resolution contract). The tracker field is required; only vendor-specific role-name keys present in config override the defaults, and absent vendor-specific role-name keys fall back to the documented defaults. Build the list of `(role, configured-name)` pairs to validate:

- **Missing / empty tracker**: report `UNRESOLVABLE` with setup guidance (`/lisa:setup:jira`, `/lisa:setup:github`, or `/lisa:setup:linear`). Do not default to JIRA.
- **JIRA build workflow** (`jira.workflow`): `ready`, `claimed`, optional `review`, `blocked`, and each `done.<env>` (`dev` / `staging` / `production`). Defaults: `Ready`, `In Progress`, `Code Review`, `Blocked`, `{dev: "On Dev", staging: "On Stg", production: "Done"}`.
- **GitHub build/prd labels** (`github.labels.build`, `github.labels.prd`): each configured label string.
- **Linear build workflow** (`linear.workflow`): `ready`, `claimed`, `review`, `blocked`, and each `done.<env>` — native workflow **states**, the Linear analogue of `jira.workflow`, not of `github.labels`. Defaults: `Ready`, `In Progress`, `In Review`, `Blocked`, `{dev: "On Dev", staging: "On Stg", production: "Done"}`.
- **Linear labels** (`linear.labels`): the `prd.*` map plus the one surviving build-lane key, the `human_needed` marker (`linear.labels.build.human_needed`). A config that predates the state model may still carry `ready` / `claimed` / `blocked` / `done` under `linear.labels.build`; those are **inert** — nothing reads them. Do not audit them against the live label set, and do not report them as drift. Report them once as a migration note pointing at `/lisa:setup:linear`, which removes them.
- **Notion PRD values** (`notion.values`): each configured select-option value, validated against the `notion.statusProperty` property's options.
- **Confluence PRD parents** (`confluence.parents`): each configured parent page id, validated by existence.

## Step 3 — Enumerate the authoritative live name set

Resolve the live, canonical names per vendor through the **same access layer the rest of Lisa uses** — never a second source of truth.

### JIRA (via `/lisa:atlassian-access`)

First confirm the active substrate is authenticated to **this project's** `atlassian.cloudId` / `atlassian.site`. `/lisa:atlassian-access` already enforces account identity: a substrate authed as a different Atlassian account is skipped, not used. If no substrate matches the configured account, mark the project `UNRESOLVABLE` (auth mismatch) and move on — do **not** validate against the wrong instance, and do **not** trust a case-insensitive JQL pass as proof.

Enumerate the project's full workflow status set, preferring the most authoritative substrate:

1. **curl** (authoritative — all statuses, including empty ones):
   ```bash
   # GET /rest/api/3/project/<KEY>/statuses → union of canonical status names across issue types
   # via lisa-atlassian-access curl substrate
   # jq: '[.[].statuses[].name] | unique'
   ```
2. **MCP fallback** (when curl creds aren't available): union of `to.name` from `getTransitionsForJiraIssue` (with `includeUnavailableTransitions=true`) on a sample ticket, plus changelog-observed names (`fromString`/`toString`). This can miss a status that is empty *and* unreachable from the sample, so when only this substrate is available, report the enumeration method in the output so the operator knows the set may be partial.

> Note: JQL `status = "<name>"` matching is **case-insensitive**, so a JQL probe that "passes" does **not** prove the configured casing matches. Always compare against the canonical `status.name` strings from the enumeration above, case-sensitively.

### GitHub (via `gh`)

```bash
gh label list --repo "$REPO" --limit 200 --json name -q '.[].name'
```

### Linear / Notion / Confluence

Enumerate via the corresponding access surface (`lisa-linear-access` workflow states + labels; Notion data-source select options for `notion.statusProperty`; Confluence page-exists check per parent id). Same compare-exact-case contract as JIRA.

For Linear, `lisa-linear-access operation: list-workflow-states` returns each state's `name`, `type`, `position` and `isTeamDefault` (the access layer sets it from the team's `defaultIssueState`). **Keep `isTeamDefault`** — Step 4 needs it, and it is the only authoritative answer to "which state does this team create Issues into". Do not approximate it with a name guess: `Todo` is merely the stock name, and a team that renamed its `defaultIssueState` is exactly the case a name guess misses.

## Step 4 — Compare (exact case)

For each `(role, configured-name)` pair, classify against the live name set:

- **VALID** — an exact-case match exists in the live set.
- **CASE_DRIFT** — a case-insensitive match exists but no exact-case match (e.g. config `"On Stg"` vs live `"ON STG"`). Canonical = the live exact name.
- **MISSING** — no case-insensitive match exists. The name was renamed beyond recognition or deleted.

One role carries a further check that name-existence cannot express:

- **INVERTED** — Linear only, `ready` only: the configured state exists, but it is the team's **default created state** (`isTeamDefault`). This is worse than a name that does not resolve. The name resolves perfectly, so every existence check passes while the gate runs backwards: `ready` is supposed to mean "a human moved this Issue here", and the team's default means "nobody has touched this". Build-intake claims from that lane, so an INVERTED mapping dispatches work no human ever approved. Measured on the first team it hit: 20 Issues in the claimable lane, 12 never marked ready — including decision tickets shaped like leaves, which the leaf-only gate cannot catch either. Report it even when every other role is VALID.

A project's verdict:

- **VALID** — every role is VALID.
- **DRIFTED** — at least one CASE_DRIFT, MISSING, or INVERTED role, none of which is UNRESOLVABLE. An INVERTED `ready` is never VALID, no matter how cleanly it resolves.
- **UNRESOLVABLE** — the live set couldn't be enumerated (auth mismatch, missing tracker config, access failure). Distinguish this loudly from VALID — an unresolved audit is not a passing audit.

## Step 4b — Scoping-label smells (GitHub, advisory)

Steps 2–4 audit **lifecycle** roles, and they can only ever audit lifecycle
roles: every pair they compare comes from a `(role, configured-name)` mapping
declared in `.lisa.config.json`. The **scoping** vocabulary — `type:`,
`priority:`, `points:`, `component:` — is declared in no config key at all, so
there is no configured name to compare a live name against. The audit was not
failing to check those labels; it had nothing to check them with.

That blind spot matters because `lisa-github-write-issue` instructs the write
path to `gh label create` any label it needs. That is correct for bootstrapping
a fresh repo, and it makes the scoping vocabulary **unbounded and
self-expanding**: every typo becomes a permanent new label, and two labels
meaning one thing silently split every query that filters on them — including
the `--label "component:<component>"` related-work query the same skill runs to
find related issues. A component split across two spellings returns half its
related issues to that query, and nothing anywhere reports it.

**Lisa asserts no authority over a project's label vocabularies.**
`component:` is open by design — an open vocabulary has no wrong member, only
inconsistent ones — so this step reports *smells*, not violations. `type:` and
`priority:` are the exception: they are closed sets already enumerated by
`lisa-github-write-issue`, so membership there is checked against the declared
set because the lists exist already and cost nothing to assert.

> **Advisory only. This is not a gate and must not become one.** A heuristic
> that guesses at synonyms will be wrong sometimes, and a wrong gate is worse
> than no gate. Scoping findings never change a project's verdict, never enter
> the repair path, and never change this skill's exit status. They report; a
> human decides.

Skip this step for non-GitHub trackers — the families are GitHub label
conventions. Skip it silently, and never let a `gh` failure here downgrade a
lifecycle verdict; the scoping section simply reports "not collected".

### Collect the vocabulary and its usage

Rarity is the whole signal, so the declared label set alone is not enough — a
label that exists is not a label anyone uses. Collect both, and union them so a
declared-but-never-applied label lands with a usage of `0`:

```bash
gh label list --repo "$REPO" --limit 500 --json name \
  | jq '[.[] | {name: .name, count: 0}]' > /tmp/lisa-labels-declared.json

gh issue list --repo "$REPO" --state all --limit 1000 --json labels \
  | jq '[.[].labels[].name]
        | group_by(.)
        | [.[] | {name: .[0], count: length}]' > /tmp/lisa-labels-used.json

jq -s '{labels: (.[0] + .[1])}' \
  /tmp/lisa-labels-declared.json /tmp/lisa-labels-used.json \
  > /tmp/lisa-scoping-input.json
```

The `--limit 1000` cap is a sample, not a census. Say so in the report when the
issue count reaches the cap, because rarity measured on a truncated sample can
call an established value rare.

### Classify

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/scoping-label-audit.mjs" \
  < /tmp/lisa-scoping-input.json
```

It returns `{ findings, familiesWalked, advisory: true }` and always exits `0`.
Three finding kinds, all `severity: "advisory"`:

- **`outside-vocabulary`** — a `type:` or `priority:` value outside the closed
  set `lisa-github-write-issue` declares.
- **`probable-synonym`** — a `component:` value used at most once that sits
  within two edits of a well-established value. **Both** conditions are
  required. Rarity alone is not evidence of a synonym (a single-use
  `component:billing` with no near neighbour is not reported), and proximity
  alone reports healthy repositories forever — `component:ci` and
  `component:cli` are one edit apart and genuinely distinct.
- **`off-scale`** — a `points:` value off the Fibonacci scale. `points:` is
  open, so this is a consistency smell, not an invalid value.

Do not re-derive any of these thresholds in prose or in a second script. The
module is the single definition; this step calls it.

## Step 5 — Report

Per project, print a terminal-first section:

```
<project-path>  [tracker=<vendor> project/repo=<id>]  VERDICT
  role            configured        live (canonical)    status
  ready           Ready             Ready               VALID
  claimed         In Progress       In Progress         VALID
  blocked         Blocked           Blocked             VALID
  done.dev        On Dev            On Dev              VALID
  done.staging    On Stg            ON STG              CASE_DRIFT  → fix: "ON STG"
  done.production Done              Done                VALID
```

An INVERTED `ready` gets a full line rather than a one-word status, because the operator reading it is not necessarily an engineer and the word alone does not convey the stakes:

```
  ready           Todo              Todo                INVERTED
      "Todo" is the state this Linear team puts every NEW issue into, so the
      build queue is currently claiming issues nobody marked ready. Pick or
      create a state a person moves an issue into (Lisa's default is "Ready")
      via /lisa:setup:linear, then set linear.workflow.ready to it.
```

Print the Step 4b findings, when there are any, as a clearly separate advisory
block **below** the mapping table so nobody reads a smell as a mapping failure:

```
  scoping labels (advisory — no effect on the verdict above)
    component:plugin      used 1×, 1 edit from component:plugins (used 40×)  probable synonym
    type:Chore            outside the declared type vocabulary               review
    points:4              off the Fibonacci scale                            review
```

Write those lines for a non-technical operator: say what was seen and what a
person might do about it, never "FAIL". A healthy repository prints
`scoping labels: none` and nothing else.

End with a roll-up: counts of VALID / DRIFTED / UNRESOLVABLE projects and the exact next command (`… repair=true` when drift is auto-repairable; an admin note when a status is genuinely MISSING; `/lisa:setup:linear` when a `ready` is INVERTED). Scoping findings are reported alongside that roll-up as a **separate count**, never folded into DRIFTED.

## Step 6 — Repair (only when `repair=true`)

For each drifted role, repair the **config** (preserve everything else; only write changed keys; always `jq … > tmp && mv`):

### CASE_DRIFT — automatic

Rewrite the configured value to the live canonical name. Examples:

```bash
# scalar role (ready/claimed/blocked/review)
jq --arg v "$CANONICAL" '.jira.workflow.<role> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# done.<env>
jq --arg v "$CANONICAL" '.jira.workflow.done.<env> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# github/linear label
jq --arg v "$CANONICAL" '.github.labels.<lane>.<role> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
```

### MISSING — confirm first

Compute the closest live candidates (case-insensitive token/substring overlap, then edit distance). Present via `AskUserQuestion`:

> Role `<role>` maps to `<configured>`, which no longer exists in `<vendor>`. Closest live names: `<c1>`, `<c2>`, `<c3>`. Pick the replacement, leave unchanged, or enter a name manually.

Only write on an explicit pick. Never auto-select. If the user leaves it unchanged, keep the project `DRIFTED` and surface the admin remediation (add the status back, or fix it in the tracker).

### INVERTED — never auto-repair

**Never auto-repair an INVERTED `ready`, even with `repair=true`.** Every other classification has one correct answer that the live tracker already knows: CASE_DRIFT has the canonical casing, MISSING has a shortlist of near-matches. INVERTED has neither. The configured name is live and correctly cased; what is wrong is which lane the project chose to mean "build-ready", and nothing in the config or the tracker records what the human intended instead. Guessing would silently repoint the queue at a lane that may hold nothing, or worse, at another lane the team fills automatically — swapping one wrong answer for a quieter one.

The team may also genuinely not have a dedicated ready lane yet, in which case the repair is to **create a state**, not to rewrite a string — `/lisa:validate-tracker-mapping` audits config, it does not mutate the tracker.

So: present the team's non-default states via `AskUserQuestion`, and write `linear.workflow.ready` only on an explicit pick. If none fits, or the user declines, leave the config untouched, keep the project `DRIFTED`, and hand off:

> Linear has no dedicated build-ready state on this team. Run `/lisa:setup:linear` — it offers to create `Ready` and records the mapping.

Until then, say plainly that the build queue is claiming unapproved work and that pausing build intake is the safe interim.

### Scoping-label findings — never repaired at all

`repair=true` does not touch scoping labels, and there is no flag that makes it.
The lifecycle roles are repairable because the live tracker already holds the
one correct answer; a scoping smell has no such answer anywhere. Renaming or
merging a `component:` value is a project-vocabulary decision with no
machine-checkable right answer, and acting on a heuristic guess would rewrite
real issue metadata on a coin flip. Report the finding, name the two spellings,
and leave the decision to a human — and note that reconciling them means
relabelling the issues, which is a tracker mutation this skill never performs.

### Invalidate the verification cache

After any JIRA repair, clear the `setup-jira` reachability cache so it re-verifies the new mapping:

```bash
jq 'if .jira then .jira.verified_workflow_hash = null else . end' \
  .lisa.config.local.json > .lisa.config.local.json.tmp 2>/dev/null \
  && mv .lisa.config.local.json.tmp .lisa.config.local.json || true
```

Re-print the project section showing the post-repair mapping and the new verdict (VALID if every role now resolves).

## Idempotency & repeatability

- Re-running on a clean config reports `VALID` and writes nothing.
- Read-only mode has no side effects and is safe to schedule. Pair with `/schedule` (or run in CI) to detect drift continuously; run `repair=true` interactively when drift appears (the `MISSING` path needs a human decision and should not run unattended).
- Repair only ever touches `.lisa.config.json` (and clears the local verification-cache key) — it preserves all unrelated config and never stages secrets or env values.

## Rules

- Compare status/label names **case-sensitively** against the live canonical set. A case-insensitive tracker query (e.g. JQL) that resolves is not proof the casing matches.
- Verify the access substrate is authenticated to the **configured** account before trusting any enumeration. An audit run against the wrong instance is `UNRESOLVABLE`, not `VALID`.
- Repair fixes the **config**, never the tracker. Do not rename or delete tracker statuses, labels, or options.
- Never auto-repair a `MISSING` mapping; confirm the replacement via `AskUserQuestion`.
- Use `jq` for all JSON reads/writes; write only changed keys via `jq … > tmp && mv`.
- In batch mode, audit each project independently — one project's `UNRESOLVABLE` (e.g. an auth mismatch) must not abort the rest of the sweep.
- Reuse the config-resolution defaults and the vendor access skills (`atlassian-access`, `gh`, Linear/Notion MCP); do not invent a parallel mapping or lifecycle vocabulary.
- Scoping-label findings (Step 4b) are **advisory**. They never change a project's verdict, never change this skill's exit status, and are never auto-repaired. Do not add a flag that turns them into a gate.
- Never let Step 4b fail the run. A `gh` error, a non-GitHub tracker, or an empty repository means the scoping section reports "not collected" — the lifecycle verdict is unaffected either way.

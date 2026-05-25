---
name: doctor
description: "Audit whether the current repository is ready to use Lisa. Runs grouped read-only checks across project detection, Lisa config, runtime distribution surfaces, tracker/source preflight access, automation prerequisites, optional GitHub Project coordination, and optional wiki delegation, then reports PASS/WARN/FAIL/SKIP results plus an overall readiness verdict (`READY`, `READY_WITH_WARNINGS`, or `NOT_READY`)."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Doctor: $ARGUMENTS

Run a read-only Lisa readiness audit for the current repository.

## Purpose

`/lisa:doctor` is the deterministic answer to "is this repo actually ready to use Lisa?" It audits
the repository in grouped sections, reports each check as `PASS`, `WARN`, `FAIL`, or `SKIP`, and
emits one overall verdict: `READY`, `READY_WITH_WARNINGS`, or `NOT_READY`.

The command is repository-scoped. It validates only what can be observed from the current repo,
current machine, and current runtime. It does **not** create automations, labels, tracker items, or
other external state as part of the default audit path.

## Inputs

- Optional flags in `$ARGUMENTS` that narrow or tune read-only validation.
- The current repository root and its Lisa config files (`.lisa.config.json`,
  `.lisa.config.local.json`) when present.

## Confirmation policy

Do **not** ask whether to proceed. Once invoked, run the read-only audit, print the grouped
results, emit the overall verdict, and stop.

Specifically forbidden:

- Previewing the number of checks and asking whether to continue.
- Offering "run a few checks first" or "dry-run vs real run" choices. This skill is already the
  read-only path.
- Performing setup mutations just because a failing check discovered something missing.

The only legitimate reasons to stop early are:

- The current working directory cannot be resolved to a repository/root the audit can inspect.
- The runtime blocks all required local reads needed to even classify the repo.

## Audit contract

Doctor reports grouped checks in a stable, human-readable structure. The grouped sections include,
as applicable to the current repo:

1. **Project detection and runtime basics** — detect the project root, package/runtime surface, and
   whether Lisa is installed where the repo expects it.
2. **Lisa config readiness** — read `.lisa.config.json` and `.lisa.config.local.json` using the
   same local-overrides-global semantics defined by `config-resolution`; report missing required
   keys, incompatible combinations, and committed-vs-local locality problems as findings rather
   than mutating config.
3. **Tracker/source preflight** — perform read-only readiness checks for the configured `tracker`
   and `source` only. If a required CLI, MCP surface, or auth context is unavailable in the current
   runtime, report that explicitly instead of pretending the repo is ready.
4. **Runtime distribution surfaces** — confirm the command, skill, hook, and related distribution
   surfaces relevant to this repo are present where Lisa expects them on the active runtime.
5. **Automation readiness** — inspect whether the configured queue source/tracker and scheduling
   prerequisites are observable, but do **not** create, edit, or delete automations during doctor.
6. **Optional GitHub Project coordination** — when `github.projects.v2` is configured, delegate
   the shared validation read to `github-project-v2` instead of reimplementing ad-hoc GraphQL
   checks. Honor the `required=false` vs `required=true` semantics documented by
   `config-resolution`: best-effort failures are `WARN`, required-mode failures are `FAIL`.
7. **Optional wiki delegation** — when a repo-local `wiki/` exists, either summarize the
   specialized `lisa-wiki-doctor` verdict or explicitly report that deeper wiki checks are
   available there. The base doctor stays narrower than full wiki migration enforcement.

If a check family is not applicable to the current repo, report `SKIP` with the reason.

### Minimum config-readiness checks

The Lisa config group is not just "does a file exist?" Doctor must audit the config contract in
this order:

1. **Presence + parseability**
   - `FAIL` when `.lisa.config.json` is missing, empty, or invalid JSON.
   - Read `.lisa.config.local.json` only when present; if present but invalid JSON, `FAIL`.
2. **Merged effective config**
   - Resolve every key with the same per-key local-overrides-global semantics documented by
     `config-resolution`. Doctor must describe findings against the effective merged value, not by
     pretending one file fully replaces the other.
3. **Required top-level dispatch keys**
   - `FAIL` when merged `tracker` is missing or is not one of `jira`, `github`, or `linear`.
   - `FAIL` when merged `source` is present but is not one of `notion`, `confluence`, `linear`,
     `github`, or `jira`.
4. **Vendor required-key audit**
   - `FAIL` when the configured tracker/source points at a vendor whose required keys are absent
     after merge. Examples: `tracker=github` requires `github.org` + `github.repo`;
     `tracker=jira` requires `atlassian.cloudId` + `jira.project`; `source=notion` requires
     `notion.workspaceId` + `notion.prdDatabaseId`.
   - Reuse the `config-resolution` vendor tables rather than inventing a second required-key list.
5. **Local-vs-committed locality audit**
   - `WARN` when developer-specific fields appear in committed config. At minimum enforce the
     documented local-only examples: `atlassian.email`, `intake.assignee`, and
     `jira.verified_workflow_hash`.
   - `WARN` when project-wide shared fields exist only in `.lisa.config.local.json` and are absent
     from `.lisa.config.json`, because the current machine may work while the repository remains
     under-configured for teammates and automations. Examples include `tracker`, `source`,
     `github.org`, `github.repo`, `atlassian.cloudId`, `atlassian.site`, `jira.project`,
     `linear.workspace`, `linear.teamKey`, and `deploy.branches`.

Locality findings are advisory unless the merged config is unusable. Missing shared keys after the
merge are `FAIL`; shared keys that exist only locally are `WARN`.

### Minimum tracker/source preflight checks

After config readiness passes far enough to resolve the merged `tracker` and optional `source`,
doctor must perform read-only preflight checks for the configured vendors only. It does not probe
every vendor Lisa supports.

1. **Scope the audit to configured vendors**
   - Audit the merged `tracker`.
   - Audit the merged `source` only when present and distinct from the tracker.
   - Report every non-configured vendor as `SKIP` rather than pretending it was checked.
2. **Prove a readable substrate exists**
   - `tracker=github` or `source=github`: require `gh` CLI availability, a passing `gh auth status`,
     and a read probe against the configured repo such as `gh repo view <org>/<repo>`.
   - `tracker=jira`, `source=jira`, or `source=confluence`: follow the `atlassian-access`
     substrate ladder and prove at least one read-capable path can see the configured
     `atlassian.cloudId` and vendor scope. Acceptable substrates are `acli`, Atlassian MCP, or the
     validated API-token/curl path documented by `config-resolution`.
   - `tracker=linear` or `source=linear`: require either readable Linear MCP access or a valid
     personal API-key probe against the configured workspace. When Linear is the tracker, doctor
     must also prove the configured `linear.teamKey` is visible.
   - `source=notion`: require either a Notion MCP identity match for `notion.workspaceId` or a
     valid internal-integration token probe, plus read visibility to `notion.prdDatabaseId`.
3. **Separate missing tooling from missing auth or scope**
   - Missing executable / MCP substrate availability is a distinct observed fact, not the same as
     "auth failed."
   - When a probe runs and fails, preserve the exact read-only failure text or HTTP/GraphQL status
     in the observed output so the operator can distinguish wrong workspace/site/repo from missing
     credentials.
4. **Severity ladder**
   - `PASS` when at least one supported read-only substrate proves the configured vendor is
     reachable with the required scope.
   - `WARN` when the configured vendor is reachable, but an additional optional substrate is
     unavailable and later Lisa flows would need to fall back.
   - `FAIL` when no supported substrate can prove read access for the configured tracker/source, or
     when the configured vendor target is unreadable from the current runtime.

## Output contract

The final report must:

- Separate observed facts from remediation advice.
- Print every check with one of `PASS`, `WARN`, `FAIL`, or `SKIP`.
- Emit exactly one overall verdict: `READY`, `READY_WITH_WARNINGS`, or `NOT_READY`.
- Stay read-only by default.

Render the report in grouped sections using the shared `scripts/doctor-report.mjs` contract:

- Start with `Overall verdict: <VERDICT>` and one `Counts:` line covering `PASS`, `WARN`, `FAIL`,
  and `SKIP`.
- Then print each group as `<group-id>. <group-title>`.
- Under each group, print one line per check as `- <STATUS> <check-id>: <summary>`.
- When available, print `Observed:` and `Remediation:` lines beneath the check so the report keeps
  facts separate from advice.
- If a group has no applicable checks yet, render it as a grouped `SKIP` with the reason instead of
  silently omitting the section.

The verdict ladder is:

- `READY` — no `FAIL` and no `WARN`.
- `READY_WITH_WARNINGS` — no `FAIL`, but one or more `WARN`.
- `NOT_READY` — one or more `FAIL`.

## Delegation and reuse

- Reuse `config-resolution` for config and lifecycle role defaults instead of inventing a second
  schema.
- Reuse the existing `github-project-v2` chokepoint for GitHub Project coordination checks instead
  of inlining bespoke access logic.
- Reuse ideas from `lisa-wiki-doctor` for grouped verdict rendering where they fit, while keeping
  the Lisa-wide doctor narrower than the wiki-specific migration/readiness workflow.

## Rules

- Never mutate repository, tracker, or automation state on the default doctor path.
- Never hardcode tracker/source label names outside the documented defaults plus configured
  overrides from `config-resolution`.
- Never silently treat an unavailable check surface as success; report `WARN`, `FAIL`, or `SKIP`
  with the explicit missing dependency.
- Never turn wiki-specific checks into a requirement for non-wiki repos.

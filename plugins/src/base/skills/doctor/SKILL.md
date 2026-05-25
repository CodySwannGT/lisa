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

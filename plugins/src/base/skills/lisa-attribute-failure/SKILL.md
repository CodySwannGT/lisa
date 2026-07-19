---
name: lisa-attribute-failure
description: "Event-triggered root-cause attribution for an arbitrary failure: decide, with cited evidence, whether the defect is Lisa's fault or the project's. Accepts a failure event (defect description, implicated files, rule/skill/hook in play) and returns a verdict of lisa | project | ambiguous plus the evidence relied on. Read-only — it never files, writes, or remediates; callers (lisa-doctor findings, the learning judgment gate, rework triage) consume the verdict. Extracted from lisa-doctor's upstream Lisa change-history diagnosis (#1494) so the same attribution procedure can run on ANY failure event, not only doctor config-audit findings."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Attribute Failure

Attribute ONE failure event to Lisa or the project, with cited evidence. Failure event: $ARGUMENTS

Before a Lisa-caused failure can be routed upstream, something has to say — with evidence — "this was Lisa's fault, not the project's." A failure has two possible causes: the project drifted, or **Lisa itself changed or shipped the defect**. This skill must distinguish them instead of blaming the project by default, and equally must never blame Lisa without conclusive evidence. Wrong attribution in either direction is the failure mode; **inconclusive evidence is always `ambiguous`, and ambiguous stays local and low-confidence — never upstream.**

## Input — the failure event

Accept the event as JSON or `key=value` fields. This procedure is **event-triggered, not version-window-keyed**: any failure can be attributed, not only a doctor config-audit finding.

- `defect` — what went wrong, in plain language (required)
- `implicated_files` — the file paths where the defect lives or manifests (required when known)
- `surface_in_play` — the Lisa rule / skill / hook / template / workflow involved, if any
- `installed_version` / `latest_version` — the Lisa version window, when the caller knows it; otherwise resolve it as signal 3 describes
- `failure_class` — a short slug naming the class of failure (used by downstream filing for the root-cause key)

## Output — the verdict

Return exactly one verdict — `lisa` | `project` | `ambiguous` — plus the evidence it relied on:

```text
## Attribution: [lisa | project | ambiguous]

**Signal:** [managed-surface | shipped-artifact-behavior | upstream-history | none-conclusive]
**Lisa surface at fault:** [path or rule/skill/hook name | n/a]
**Cited evidence:**
- [each item names the signal it came from and the concrete citation: file path + ownership proof, shipped artifact text, or commit sha/subject/version]
**Confidence note:** [why the evidence is conclusive, or exactly what was inconclusive]
```

Verdict rules:

- **`lisa`** — at least one signal conclusively pins the defect on a Lisa-shipped surface or upstream change, and the evidence names that surface. Never emit `lisa` from degraded, truncated, or unverified history.
- **`project`** — the implicated files are project-owned, no shipped Lisa artifact drove the behavior, and the upstream-history window shows no relevant Lisa change. Cite the absence explicitly (which paths were checked, which window showed no relevant change).
- **`ambiguous`** — anything else: unresolvable version window, unreachable history, partial ownership, conflicting signals. Ambiguous is treated as local and low-confidence; nothing is escalated upstream from it.

## The three signals (evaluate in order)

### Signal 1 — the defect lives in a Lisa-managed surface

Resolve ownership of each implicated file the way doctor's config audit does:

- **Copy-overwrite / managed**: the path is populated by `lisa apply` from a stack template (`typescript/`, `expo/`, `nestjs/`, `cdk/`, `harper-fabric/`, `rails/` copy-overwrite trees), is a plugin-distributed rule/skill/hook/agent/command surface, carries Lisa governance markers or a Lisa version stamp, or is governed by `package.lisa.json` `force` keys. A defect in the shipped content of such a surface is **Lisa's fault** — any local edit would be overwritten on the next `lisa apply`.
- **Create-only**: the local copy is project-owned after scaffolding, but if the defect is faithful to the template as shipped, the template is still Lisa's fault (every newly scaffolded repo inherits it). Cite the template origin, and note the local copy will not be overwritten.
- **Project-owned**: not from a Lisa template and not Lisa-managed — signal 1 is negative; continue.

If the project locally modified a managed surface and the defect lives in the local modification, that is project drift, not a Lisa defect — signal 1 is negative for `lisa` and positive evidence for `project`.

### Signal 2 — a shipped Lisa rule/skill/hook drove the wrong behavior

Read the shipped artifact named in `surface_in_play` (the plugin-distributed rule, skill, hook, agent, or CI workflow as Lisa ships it — not a local fork). If following its instructions or configuration as shipped produces the observed defect, the verdict is `lisa`: cite the artifact path and the specific shipped text or configuration that drove the behavior. If the artifact is shipped correct and was misapplied locally, that is evidence for `project`.

### Signal 3 — the upstream-history window shows Lisa changed the relevant contract

This is the #1494 doctor procedure, unchanged in behavior — here it is the third signal, not the trigger. Whenever signals 1-2 are not conclusive on their own — and always before a definitive `project` verdict — pull Lisa's own git history for the version window and read what actually changed:

1. **Resolve the version window.** Use the caller-supplied `installed_version`/`latest_version` when present; otherwise determine the project's installed Lisa version (the `@codyswann/lisa` entry in `package.json`/lockfile, or the plugin version stamp on the active runtime) and the latest published version (`npm view @codyswann/lisa version`, or the update check's cached result). An unresolvable window makes this signal inconclusive — it can support `ambiguous`, never `lisa`.
2. **Pull the upstream history for that window** (read-only; no clone required when `gh` is available):

   ```bash
   gh api "repos/CodySwannGT/lisa/compare/v<installed>...v<latest>" \
     --paginate --slurp |
     jq '{total_commits: .[0].total_commits, files: [.[0].files[]?.filename], commits: [.[].commits[]? | {sha, subject: (.commit.message | split("\n")[0]), api_url: .url, html_url, parents: [.parents[]?.sha]}]}'
   ```

   `--paginate` fetches every page of commits, and `--slurp` gathers those pages into a single
   array before the external `jq` projection runs. GitHub CLI does not permit its built-in `--jq`
   flag together with `--slurp`, so keep the pipe as shown; without `--slurp`, paginated responses
   are not one merged input. `total_commits` and `files` only need the first page
   (files are capped at 300 and not repeated on later pages); `commits` flattens across all pages
   while retaining each commit SHA and URLs needed for accurate follow-up.

   After path-scoping identifies a candidate commit, fetch its targeted file-level diff context by
   the retained SHA rather than attributing from the subject alone:

   ```bash
   gh api "repos/CodySwannGT/lisa/commits/<sha>" \
     --jq '{sha, files: [.files[]? | select(.filename == "<relevant-path>" or (.filename | startswith("<relevant-prefix>/"))) | {filename, status, additions, deletions, changes, patch}]}'
   ```

   Preserve the returned filename, status, counts, and available patch with the SHA in the
   upstream-history projection. A missing or truncated `patch` is not proof of no relevant change;
   use the compare diff fallback below or downgrade the attribution to `ambiguous` when
   commit-level context cannot be established.

   The compare endpoint paginates commits (250 without `--paginate`) and only lists changed files
   on the first page, capped at 300 total — a large version window can silently drop commits or
   files. If `total_commits` or the file count looks truncated, re-run with the
   `application/vnd.github.diff` accept header (`gh api ... -H "Accept: application/vnd.github.diff"`)
   to pull the full patch text, or fall back to the bounded-fetch `git log` below. When completeness
   still can't be established, say so in the evidence and return `ambiguous` rather than attributing
   with unverified confidence.

   Fallbacks, in order: `gh api repos/CodySwannGT/lisa/commits?path=<template-path>` for a
   path-scoped view — note this endpoint has no way to bound results to the `v<installed>..v<latest>`
   window, so treat its output as best-effort context only, not authoritative attribution; a
   finite-depth, explicit-tag fetch, which is bounded to the two version refs and should be preferred
   for definitive attribution; or the local marketplace/plugin cache checkout when the runtime has
   one. For the fetch fallback, use a temporary directory and a fixed history ceiling:

   ```bash
   lisa_history_dir="$(mktemp -d)"
   git init "$lisa_history_dir"
   git -C "$lisa_history_dir" remote add origin https://github.com/CodySwannGT/lisa.git
   git -C "$lisa_history_dir" fetch --no-tags --filter=blob:none --depth=256 origin \
     refs/tags/v<installed>:refs/tags/v<installed> \
     refs/tags/v<latest>:refs/tags/v<latest>
   git -C "$lisa_history_dir" merge-base --is-ancestor v<installed> v<latest>
   git -C "$lisa_history_dir" log --format='%H%x09%s' v<installed>..v<latest> -- <paths>
   git -C "$lisa_history_dir" show --format=fuller --stat --patch <relevant-sha> -- <paths>
   ```

   The explicit tag refspecs, `--no-tags`, and finite `--depth=256` make this fetch bounded. Do not
   silently deepen beyond that ceiling. If `merge-base --is-ancestor` fails, the shallow window is
   incomplete (or the tags are not on one ancestry line): do not make definitive attribution from
   it. If none of the bounded sources are reachable, or only the unbounded path-scoped fallback is
   reachable, report the gap in the evidence and return `ambiguous` — never fail the caller's flow
   because history was unavailable or incomplete, and never let a degraded history produce `lisa`.
3. **Scope the reading to what the failure touches.** Filter the commit list to the paths that
   generate the failing surface: the detected stacks' template dirs (`typescript/`, `expo/`, …),
   `plugins/src/base/` for skills/hooks/rules, `scripts/` for governance scripts, and the shipped
   config factories (`src/configs/`). A failure about a lint rule reads the lint-config commits,
   not the whole log.
4. **Attribute.** When the upstream history shows Lisa changed the relevant contract (a tightened
   lint rule, a renamed check context, a new required config key), the verdict is `lisa` — cite the
   commit subject/version. When history shows no relevant upstream change and signals 1-2 are also
   negative, the project drifted — the verdict is `project`, citing the absence of a relevant
   upstream change as the evidence.

## Rules

- **Read-only.** This skill reads the project and Lisa's repository; it never writes to either, never files issues, and never remediates. Filing the upstream ticket on a `lisa` verdict is the caller's flow (`lisa-persist-learning`, `handoff-upstream` disposition); doctor maps verdicts into its findings; remediation stays with whoever called.
- **Never block.** Attribution failure, missing tooling (`gh` unavailable), or degraded history degrades to `ambiguous` with the gap named in the evidence — it never raises an error that stops the caller's build or audit.
- **Every verdict cites its evidence.** An attribution without a named signal and concrete citation is invalid — return `ambiguous` instead.
- **Ambiguous never escalates.** `ambiguous` is a terminal local verdict: low-confidence, no upstream filing, no durable local rule derived from it.
- **Headless-safe and idempotent**: no prompts, no side effects, same event in → same verdict out.

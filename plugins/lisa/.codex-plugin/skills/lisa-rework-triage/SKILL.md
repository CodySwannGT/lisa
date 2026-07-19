---
name: lisa-rework-triage
description: "Rework detection and…"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Rework Triage: $ARGUMENTS

Classify why a previous agent attempt at this ticket failed, and convert that cause into a
structural improvement. This is the self-hardening arm of the lifecycle: every classified
failure either hardens the harness (an upstream Lisa issue), the project (a provisioning or
environment ticket), or the spec (a PRD defect flag). A rework cycle that fixes the bug but
never asks *why the agent got it wrong* guarantees the mistake recurs.

The caller MUST have run `lisa-tracker-read` first and provided the context bundle (all
comments chronological, linked PRs with review state, issue links, parent epic). Do not
classify from a bare summary — evidence-free classification is worse than none.

## Phase 1 — Rework detection

A ticket is **rework** when it was previously implemented by this lifecycle and has returned
to a build-ready state. Evaluate these signals in order; the first confirmed signal suffices.
If none confirm, output `## Verdict: NOT_REWORK` and stop — this skill takes no action on
first-attempt work.

1. **Status history shows a post-implementation regression transition.** The ticket's
   changelog contains a transition from a post-build state (the configured `claimed`,
   any configured `done.*` environment state, or a review state) back to the configured
   `ready` state.
   - JIRA: fetch the changelog via the `lisa-atlassian-access` REST substrate —
     `GET /rest/api/3/issue/<KEY>/changelog` — and scan `items[].field == "status"` entries.
   - GitHub: `gh issue view <n> --json timelineItems` (or the timeline API) — scan for the
     `$DONE`/environment label being removed and `$READY` re-added after a linked PR merged.
   - Linear: the Issue history relation — scan state changes from a completed/started state
     back to the ready-labeled state.
2. **Merged linked PR + build-ready again.** The bundle shows at least one linked PR that is
   `MERGED`, while the ticket currently carries the build-ready role. First-attempt tickets
   never have merged PRs.
3. **Prior lifecycle claim marker.** The comments contain a prior implementation-cycle
   marker for THIS ticket: a `[claude-build-intake]` claim comment, or a build-evidence
   comment posted by `lisa-tracker-evidence` (`[lisa-evidence]` / the vendor evidence
   header). Only markers proving a prior *implementation* attempt qualify —
   `[lisa-rework-triage]` comments and other unrelated `[lisa-*]` annotations never do.
4. **Explicit rework marker.** A `rework`, `qa-fail`, or `regression` label applied by QA or
   the verify lifecycle.

Record which signal fired — it is part of the evidence trail.

## Phase 2 — Failure-cause classification

Classify the failed attempt into **exactly one primary cause**. Every classification must
cite concrete evidence from the bundle, the codebase, or the PRD lineage — a cause without
evidence is `UNCLASSIFIED`, which is itself a surfaced outcome, never a silent default.

| Cause | Definition | Required evidence |
|-------|------------|-------------------|
| `decomposition-infidelity` | The ticket misrepresents the PRD requirement it implements — the agent built what the ticket said, but the ticket distorted the spec. | Resolve the ticket's requirement id(s) from the source PRD's `## Tickets` section (written by `lisa-prd-backlink` — each entry carries `requirements: ["R#"]` and the register maps R# to verbatim PRD text). Quote the PRD text vs. the ticket's AC and name the divergence. |
| `prd-defect` | The ticket faithfully captured the PRD, but the PRD itself was wrong, ambiguous, or missing the failing case. | Quote the PRD requirement and the QA failure it does not cover or contradicts. |
| `missing-tool-access` | The agent lacked a tool, credential, environment, or permission the work required, and worked around it blindly. | The prior cycle's comments/PR show the gap (skipped verification step, "could not access", missing env credentials, absent MCP tool) — cite the marker. |
| `implementation-defect` | Spec and ticket were right; the agent's code was wrong. | The failing behavior contradicts an AC the ticket states correctly; cite the AC and the failure report. |
| `environment-data` | The failure is caused by environment or data state (drift, missing fixtures, shared-state collision), not by the code under test. | The failure reproduces only in the affected environment, or the report references data absent from the environment's seed/fixtures. |
| `verification-gap` | The code was wrong AND the verification lifecycle should have caught it — the codified regression test was missing, too weak, or asserted the wrong thing. | Name the verification/codify-verification artifact from the prior cycle that failed to catch this class of failure. Frequently a **secondary** cause alongside `implementation-defect`; record both, primary first. |

Classification sources, in priority order: the QA failure report (comments), the prior
cycle's evidence comment and PR review thread, the PRD requirement register via
`lisa-prd-backlink` lineage, and the codebase itself (Glob/Grep the failing surface).

## Phase 3 — Post the triage comment

Post one structured comment on the ticket via the vendor comment surface (`lisa-atlassian-access
operation: comment`, `gh issue comment`, or the Linear comment mutation):

```text
[lisa-rework-triage] Rework detected (signal: <signal>)
Fingerprint: <ticket-key>|<last merged PR number, or none>|<primary cause>
Primary cause: <cause>
Secondary cause: <cause or none>
Evidence: <2-4 lines citing the specific PRD text / AC / comment / PR review / environment fact>
Hardening action: <what Phase 4 filed, with link — or "none required (implementation-defect)">
```

**Idempotency:** the fingerprint is the literal `Fingerprint:` line —
`<ticket-key>|<last merged PR number>|<primary cause>`, with `none` as the PR component
when detection fired on a claim marker or label and no merged PR exists. Before posting,
scan existing comments for a `[lisa-rework-triage]` block whose `Fingerprint:` line
matches — if present, skip posting and report `already-triaged`. One triage per bounce,
never one per cycle re-entry.

## Phase 4 — Route the cause to its hardening destination

Each cause has exactly one destination. File through the proper write path — never raw
ticket creation — so every hardening artifact passes the same quality gates as any other
Lisa work item.

| Primary cause | Destination | Action |
|---------------|-------------|--------|
| `decomposition-infidelity` | **Upstream Lisa issue** | The decomposition pipeline produced an unfaithful ticket and every gate passed it — that is a harness defect. File per "Filing upstream" below, citing the PRD text, the distorted ticket AC, and which gate should have caught it. |
| `verification-gap` | **Upstream Lisa issue** | The verification lifecycle passed work it should have failed. File per "Filing upstream", citing the missed failure class and the weak/missing codified test. |
| `missing-tool-access` | Project tracker | Create a provisioning ticket via `lisa-tracker-write` (`issue_type: Task`, labeled `type:tooling`) describing the missing tool/credential/environment and which flow needs it. Link it `blocks` the rework ticket. |
| `environment-data` | Project tracker | Create an environment-hardening ticket via `lisa-tracker-write` citing the drift/fixture/shared-state evidence. Link `relates to` the rework ticket. |
| `prd-defect` | Source PRD | Comment on the PRD (via the `lisa-prd-backlink` lineage) quoting the defective requirement and the QA failure; flag for product review. Do NOT silently edit the PRD — spec changes are a human gate. |
| `implementation-defect` (no secondary) | None | Normal fix path; the classification comment is the record. Pass the pattern to the `learner` phase — repeated implementation defects of the same shape escalate to `verification-gap`. |

**Secondary causes route too.** A recorded secondary cause triggers its own row's
destination in addition to the primary's: `implementation-defect` with a
`verification-gap` secondary files the upstream Lisa issue per the `verification-gap`
row — the code being wrong does not excuse the verification lifecycle for passing it.
Deduplicate against the primary's filing (one upstream issue per failure class, not one
per cause slot).
| `UNCLASSIFIED` | Surface to human | Include in the triage comment and the caller's summary; a human decides. Never guess a cause to avoid this outcome. |

### Filing upstream

Upstream issues target the Lisa repository itself so the harness gets fixed for every
project at once. Resolve the repo from `.lisa.config.json` `hardening.upstreamRepo`;
default `CodySwannGT/lisa`.

There are **two upstream lanes**, distinguished by what the filing proposes. Both share
the same dedupe-marker and evidence-chain discipline below; only the label and one body
section differ:

| Lane | Label | When | Extra body section |
|------|-------|------|--------------------|
| Defect | `self-hardening` | A Lisa gate/skill/template did something wrong — a harness bug the kernel must fix. | none |
| Contribution | `template-candidate` | A generalizable pattern discovered downstream that would benefit every host project — not a defect, a proposed improvement to Lisa's templates/rules/skills. | `## Proposed template change` |

1. **Dedupe first.** `gh issue list -R <upstream> --state open --search "<fingerprint terms>"`
   — if an open issue already covers this failure class or pattern, comment the new
   occurrence on it (evidence compounds; duplicates dilute) and link it instead of filing.
2. **File with the same bar as any ticket:** a three-audience description (what failed or
   improved for the operator, what the harness did or could do, what to change), the
   verbatim evidence chain (PRD text → ticket AC → QA failure → gate that passed it; for
   patterns, the downstream occurrences proving generality), and the lane's label:
   `gh issue create -R <upstream> --title "<gate/skill>: <failure class>" --label self-hardening`
   for defects, or
   `gh issue create -R <upstream> --title "<template surface>: <pattern>" --label template-candidate`
   for contributions. A `template-candidate` filing MUST include a
   `## Proposed template change` section naming the Lisa template/rule/skill surface to
   change (e.g. `typescript/package-lisa/package.lisa.json`, a `plugins/src/base` rule)
   and the proposed content or diff sketch, so Lisa-side intake can triage it as a
   contribution rather than a defect.
3. **Close the loop.** Reference the upstream issue URL in the triage comment. The upstream
   repo's own build intake implements it; the next kernel release ships the hardening (or
   the generalized pattern) to every host project.

## Verdict

```text
## Verdict: [NOT_REWORK | REWORK_CLASSIFIED | ALREADY_TRIAGED]

**Signal:** [status-history | merged-pr | claim-marker | label | n/a]
**Primary cause:** [cause | n/a]
**Secondary cause:** [cause | none]
**Hardening filed:** [upstream <url> | tracker <key> | prd-comment | none | pending-human]
```

The caller (ticket-triage Phase 2.5, or a standalone invocation) incorporates this into its
own findings. `REWORK_CLASSIFIED` never blocks the fix — the rework ticket proceeds to
implementation regardless; hardening runs alongside, not in front of, shipping the fix. The
one exception: `missing-tool-access` with the gap still present should surface as a Phase 3
ambiguity in the calling triage ("prior attempt lacked <tool>; it is still unavailable"),
which blocks per the normal triage rules.

## Rules

- Never classify without evidence; `UNCLASSIFIED` beats a guess.
- One primary cause. Record a secondary only when the evidence genuinely supports both.
- Fire only on confirmed rework — first-attempt tickets exit at Phase 1 with `NOT_REWORK`.
- All ticket/issue writes go through `lisa-tracker-write` or `gh` as specified — never
  bypass the quality gates this loop exists to strengthen.
- Noise discipline: one triage comment per bounce (fingerprinted), no upstream issue without
  the dedupe search, and upstream issues describe failure *classes*, not single incidents.

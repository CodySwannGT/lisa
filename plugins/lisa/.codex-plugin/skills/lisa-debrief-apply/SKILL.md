---
name: lisa-debrief-apply
description: "Apply human-marked dispositions…"
allowed-tools: ["Skill", "Bash", "Read", "Edit", "Write", "Glob", "Grep"]
---

# Debrief Apply: $ARGUMENTS

Read the triage document at `$ARGUMENTS` and persist every Accepted candidate learning to its destination.

This skill is intentionally **single-agent** — there is no team. Routing is deterministic given the disposition column. Spawning sub-agents would only add latency.

## Input

A path or URL to a Debrief triage document produced by `lisa-debrief`. The document is expected to follow the structure that skill produces — a header, an anomalies section, candidate-learning rows grouped by category, and a source-map appendix.

## Pre-flight

1. **Verify the doc exists and parses.** If the file cannot be read or the expected sections are missing, stop and report — do not guess.
2. **Confirm dispositions exist.** If every row is unmarked, stop and ask the human to triage first. A pristine doc is a no-op, not an error to silently swallow.
3. **Identify the destination map.** Read the project's `.lisa.config.json` (or stack defaults) for: edge-case checklist file (default: `plugins/src/base/rules/intent-routing.md`'s Edge Case Brainstorm sub-flow), the committed learnings ledger path (resolve it — never hardcode — via `resolveProjectLearningsFile` from `@codyswann/lisa/learnings`: the `learnings.file` override, else the default `.lisa/PROJECT_LEARNINGS.md`), tracker for new tickets. The three knowledge categories (recurring gotcha, process friction, convention drift) all land in the ledger now; machine-local auto-memory and host rules (`.agents/rules/`) / `AGENTS.md` are no longer knowledge destinations (see [Ledger persistence](#ledger-persistence-knowledge-categories)).

## Routing rules

For every row marked **Accept**:

| Category | Destination | Action |
|----------|-------------|--------|
| Edge case | Edge Case Brainstorm checklist in `intent-routing.md` | Append the new pattern + question to the matching group (Navigation, Data, Failure, Input, Auth, or a new group if none fit). Use the row's `Summary` and `Evidence` link as a citation comment. |
| Recurring gotcha | Committed learnings ledger (via contract) | Persist a ledger entry per [Ledger persistence](#ledger-persistence-knowledge-categories). The `rule` is the recurring gotcha and the guard against it; `why` is the causal claim. |
| Process friction | Committed learnings ledger (via contract) | Persist a ledger entry per [Ledger persistence](#ledger-persistence-knowledge-categories). The `rule` is the friction-avoiding guideline; `why` names the friction it prevents. |
| Tooling gap | Configured tracker — or upstream Lisa when harness-level | **Split by level.** Project-level (a missing project script, hook, or automation) → create a ticket via `lisa-tracker-write` with `issue_type: Task`, summary derived from the row's `Summary`, description citing the evidence and the originating debrief doc, labeled `type:tooling` / `lifecycle-improvement`, and explicit `build_ready: true` per `ready-role-filing` (a tooling gap the factory can close itself is queue work, and an omitted flag is NOT build-ready on any tracker). Harness-level (a Lisa skill/gate/agent that should have caught the issue but didn't) → file an upstream Lisa issue exactly per the "Filing upstream" procedure in `lisa-rework-triage` (dedupe search first, three-audience description, evidence chain, `self-hardening` label; repo from `.lisa.config.json` `hardening.upstreamRepo`, default `CodySwannGT/lisa`). |
| Convention drift | Committed learnings ledger (via contract) | Persist a ledger entry per [Ledger persistence](#ledger-persistence-knowledge-categories). The `rule` is the correct convention; `why` records the drift it corrects. |
| Decomposition infidelity | Upstream Lisa repo | File an upstream Lisa issue per the "Filing upstream" procedure in `lisa-rework-triage`, citing the PRD text vs. the distorted ticket AC and naming the gate that passed it. |
| PRD defect | Source PRD | Comment on the PRD via the `lisa-prd-backlink` lineage quoting the defective requirement and the failure it missed; flag for product review. Never silently edit the spec. |
| Missing tool access | Configured tracker | Create a provisioning ticket via `lisa-tracker-write` (`issue_type: Task`, `type:tooling`) describing the missing tool/credential/environment and which flow needs it. Pass `human_gate: "a human must grant the missing access"` per `ready-role-filing` — the factory cannot provision its own credentials. |
| Uncategorized | **No route — requires reclassification** | `Uncategorized` records that the synthesizer could not fit the finding to a category; it is not itself a destination. Do NOT guess a route and do NOT silently skip the row. Leave the row unapplied, mark it `[!] Needs reclassification — <the synthesizer's "why no category fit" note>`, and list it under its own heading in the run summary so the human can retag it to one of the eight and re-run `apply`. A row that stays `Uncategorized` across runs is a signal the category set itself is missing a case — worth an upstream Lisa issue, not a forced fit. |

For every row marked **Reject** or **Defer**: no action. Defer is a no-op for `apply` but worth surfacing in the run summary — the human may want to revisit at the next debrief.

## Ledger persistence (knowledge categories)

The three knowledge categories — **recurring gotcha**, **process friction**, and **convention drift** — all persist to the committed learnings ledger through the SAME executable contract the learner uses (`@codyswann/lisa/learnings`). This is the single governed, budgeted, contract-validated, team- and cloud-visible knowledge surface. **Never hand-edit the ledger markdown** — every write goes through the contract, or it is a bug.

For each such Accepted row:

Use the branch, PR deduplication, commit, submission and confidence-routing sequence in `lisa-persist-learning` Phase 3. The human's Accepted disposition supplies the high-confidence durable-learning decision here. Before writing, create or reuse the learning branch in an isolated worktree; never write the ledger in the default-branch checkout. Submit a pull request carrying only the resolved ledger or overflow surface. Keep the triage-document update separate. A local write alone is not an applied learning: report the PR and whether it is pending or merged.

1. **Resolve the ledger path (never hardcode).** Use `resolveProjectLearningsFile` from `@codyswann/lisa/learnings` — the `learnings.file` override, else the default `.lisa/PROJECT_LEARNINGS.md` (a cold path, never an auto-loaded rules tree):

   ```bash
   LEARNINGS_FILE=$(node -e 'import("@codyswann/lisa/learnings").then(async m => { const c = await m.readProjectConfig(process.cwd()); console.log(m.resolveProjectLearningsFile(c)); })')
   ```

2. **Consolidation check (mandatory before writing).** Parse the existing entries with `parseLearningsFile` and look for one related to the row (same failure class, overlapping topic, or near-duplicate wording). Then write through the contract:
   - **Related entry found** → consolidate with the exact parsed versions: `persistConsolidatedLearning(projectRoot, entry, { supersede: [{ id: <related id>, fingerprint: <related fingerprint> }], onStaleSupersede: targets => report(targets) })`. Every stamp is checked together inside the writer lock. If any is stale, the writer removes none, safely appends the new fingerprint, and reports the mismatch. Never append a near-duplicate sibling by choice — a sibling is a bug; the stale append is the deliberate concurrent-writer preservation path.
   - **No related entry** → append via `persistLearningEntry(projectRoot, entry)`.

3. **Entry mapping (eight fields).**
   - `fingerprint` — `learningFingerprint(rule)` from `@codyswann/lisa/learnings`, computed from the final consolidated rule. Keep workflow/PR markers separate: use the `lisa-persist-learning` Phase 0 occurrence key with the stable triage-document reference as `triggering_issue`; the rule distinguishes rows sharing that reference.
   - `id` — initially `id = fingerprint`. On an exact stamped consolidation the writer carries forward the deterministic primary target id; report the returned id in the run summary.
   - `rule` / `why` — from the row's `Summary` and the category-specific guidance in the routing table above (≤240 chars, ≤2 lines).
   - `provenance` — **the triage-doc row's evidence links**. Evidence supports a rule; it is not the rule's identity, and one event may support several distinct lessons.
   - `first_learned` = `last_confirmed` = today (ISO date; on consolidation keep the superseded entry's earliest `first_learned`).
   - `confidence` = **`high`**. A human marking the row **Accept** is corroboration — an independent human judgement that the learning is real — so a debrief-accepted entry starts higher than the learner's single-occurrence auto-capture (which defaults to `low`). A duplicate fingerprint fails before mutation. The writer re-asserts the entry and token budgets; an over-budget failure means consolidate harder or drop, never truncate by hand.

**Machine-local memory is no longer a knowledge destination.** Auto-memory (`project_*.md`, `MEMORY.md`) remains available only for the assistant's *personal* collaboration notes — it is invisible to cloud runs and to teammates, so it can never hold shared project knowledge. **`AGENTS.md` is human-authored** agent operating instruction — it is the source of truth, and `CLAUDE.md` is only a one-line `@AGENTS.md` pointer — and the host-rules directory `.agents/rules/` is durable human-authored guidance; `apply` never writes to any of the three for these categories.

## Idempotency

`apply` is safe to re-run. Compute the final rule's fingerprint before checking its destination:

- **Knowledge categories (gotcha, friction, drift) → ledger.** Read the default-branch ledger through `parseLearningsFile` from `@codyswann/lisa/learnings` and compare `learningFingerprint(existing.rule)` with `learningFingerprint(candidate.rule)`. An equal rule there is already captured: preserve its legacy id and fingerprint, report that id, and skip the write. A rule present only on an open PR branch remains pending, not applied; reuse that PR. For changed consolidations use exact parsed legacy stamps in `supersede`; never rewrite them merely to adopt the helper. Distinct rules sharing provenance must both be considered. Also reuse the existing PR when its workflow marker is present, including a PR not yet merged.
- **Other categories** keep their existing destination check (the tracker for the ticket marker, the PRD for the defect comment, `intent-routing.md` for the edge-case citation).

If the fingerprint is already present, skip the write and note the row as `already-applied` in the run summary. This lets the human triage a doc incrementally (mark a few, run apply, mark more, run apply again) without producing duplicates.

## Updating the triage doc

After a learning PR merges (or the rule is already in the default-branch ledger), replace the row's `[ ] Accept` checkbox with `[x] Applied — <entry id and PR>`. While the PR is open, leave the row Accepted and record `Pending PR: <url>` so a rerun reuses it. Other destinations retain their successful-write marking. If a write or submission fails, mark the row `[!] Apply failed — <reason>` and continue with the rest.

## Output

A run summary printed to the user:

```text
Applied <n> learnings:
  <n> edge cases → intent-routing.md
  <n> gotchas → ledger (<entry-id1>, <entry-id2>, ...)
  <n> friction → ledger (<entry-id1>, ...)
  <n> convention drift → ledger (<entry-id1>, ...)
  <n> tooling gaps (project) → <tracker> (<key1>, <key2>, ...)
  <n> tooling gaps (harness) → upstream Lisa (<issue-url1>, ...)
  <n> decomposition infidelity → upstream Lisa (<issue-url1>, ...)
  <n> PRD defects → PRD comments (<prd-link1>, ...)
  <n> missing tool access → <tracker> (<key1>, ...)
Skipped:
  <n> rejected, <n> deferred, <n> already-applied
Needs reclassification:
  <n> uncategorized (retag to one of the eight categories and re-run apply)
Failed:
  <n> (see <path> for details)
Triage doc updated in place: <path>
```

Report ledger PRs and their pending/merged state in the summary. Other local changes, such as the triage document or intent-routing checklist, remain separate from those PRs and may be committed through the project's normal flow.

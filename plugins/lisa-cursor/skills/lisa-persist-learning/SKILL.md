---
name: lisa-persist-learning
description: This skill should be used when a candidate learning (from a failure signal, rejection, or debrief) needs to be judged and routed. It computes a stable fingerprint, runs the candidate through the hostile-default learning-judge gate, and performs exactly the verdict's side effects — a dropped-with-reason note on the triggering issue (drop), an upstream handoff marker (lisa-upstream), or a confidence-routed pull request that touches only the learnings surface (durable-learning). Idempotent via marker dedupe; headless-safe; never blocks the primary build flow.
---

# Persist Learning

Route ONE candidate learning through the judgment gate and act on the verdict. Candidate: $ARGUMENTS

Most candidates are dropped — that is the gate working, not a failure. Nothing is ever silent (every drop leaves a visible note), and no learning content ever reaches the learnings surface outside a pull request.

## Candidate Input

Accept the candidate as JSON or `key=value` fields:

- `rule` — the proposed learning (must fit the executable contract: ≤240 chars, ≤2 lines)
- `why` — the causal claim
- `provenance` — stable refs (issues/PRs/commits/comments), ≤20
- `evidence_links` — concrete evidence refs available for citation
- `scope_hint` — `project` | `upstream` (a hint; the judge decides)
- `triggering_issue` — the issue/work item whose failure produced this candidate (required)
- `fingerprint` — optional; computed below when absent

## Phase 0 — Fingerprint (stable dedupe key)

Every marker and branch below keys off one deterministic fingerprint:

```text
fingerprint = "sll4-" + first 12 hex chars of sha1(normalized_rule + "\n" + triggering_issue)
normalized_rule = rule lowercased, all whitespace runs collapsed to single spaces, trimmed
```

```bash
NORM=$(printf '%s' "$RULE" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//')
FP="sll4-$(printf '%s\n%s' "$NORM" "$TRIGGERING_ISSUE" | shasum -a 1 | cut -c1-12)"
```

(Use `sha1sum` where `shasum` is unavailable.) The same rule for the same triggering issue always produces the same fingerprint, so re-runs dedupe instead of duplicating comments, PRs, or branches.

## Phase 1 — Judge (mandatory, never skipped)

Invoke the `learning-judge` agent (via the Agent/Task tool with `subagent_type: "learning-judge"` — the same invoke pattern `learner` uses for `skill-evaluator`) with the full candidate including the fingerprint. It returns a verdict: `classification`, `cited_evidence[]`, `rationale`, `confidence` (durable only), `disposition`.

**Respect the verdict — do not override it.** Never re-run the judge hoping for a different answer, and never persist anything the judge did not classify `durable-learning`.

## Phase 2 — Route by disposition

All issue/PR comments below follow the marker-dedupe discipline from `lisa-github-write-prd` Phase 2, each with its own producer tag: match on the **marker, never the title or text**; **exactly one marker per body**; **never write a markerless body** (it breaks all future dedupe); include the eventual-consistency guard — when the `gh` search index is stale, also enumerate the bodies directly (`gh issue view <n> --json comments --jq '.comments[].body'` or `gh pr list --json number,body`) and grep for the marker before deciding to create.

### `drop` (classification `one-off` or `misunderstanding/spec-gap`)

Post **one** comment on the triggering issue and write **nothing** — zero bytes — to the learnings surface (not a stub, not a placeholder):

```markdown
<!-- [lisa-learning-drop] key=<fingerprint> -->
Dropped (<classification>): <reason>.
```

The note is one line naming the classification and the reason, readable by a non-technical operator. Dedupe before posting: if any comment on the triggering issue already carries `[lisa-learning-drop] key=<fingerprint>`, do not post again — report the existing note.

### `handoff-upstream` (classification `lisa-upstream`)

Emit the handoff marker only — file **nothing** (no upstream issue, no local rule; the upstream filing flow [SLL-5] consumes this marker later):

```markdown
<!-- [lisa-learning-upstream-handoff] key=<fingerprint> -->
Upstream handoff (lisa-upstream): <reason>. Nothing persisted locally; upstream filing is a separate flow.
```

Same one-comment marker dedupe on the triggering issue.

### `persist` (classification `durable-learning`)

Continue to Phase 3.

## Phase 3 — Persist via PR (durable-learning only)

No learning content is ever committed without a PR — there is no other write path, and the PR must touch **only** the learnings surface (any other changed file is a bug).

1. **PR dedupe.** Search all PRs for the marker `[lisa-learning-pr] key=<fingerprint>` in the body (`gh pr list --state all --search '"<marker>" in:body' --json number,url`), with the stale-index guard above. If one exists, reference it and stop — never open a duplicate.
2. **Resolve the learnings surface path — never hardcode it.** The canonical path is `resolveProjectLearningsFile` from `@codyswann/lisa/learnings`: the `PROJECT_LEARNINGS.md` sibling of the configured `.lisa.config.json` `projectRulesFile` (default `.claude/rules/PROJECT_LEARNINGS.md`):

   ```bash
   LEARNINGS_FILE=$(node -e 'import("@codyswann/lisa/learnings").then(async m => { const c = await m.readProjectConfig(process.cwd()); console.log(m.resolveProjectLearningsFile(c)); })')
   ```

3. **Consolidation check (mandatory before writing).** Parse the existing entries (`parseLearningsFile` from `@codyswann/lisa/learnings`) and look for entries related to the new rule (same failure class, overlapping topic, or near-duplicate wording). Then write through the executable contract — **never hand-edit the markdown**:
   - **Related entry found** → consolidate via `persistConsolidatedLearning(projectRoot, entry, { supersede: [<related ids>] })`, merging the old entry's still-true content into the new rule. Never append a near-duplicate sibling — a sibling is a bug that fails review.
   - **No related entry** → append via `persistLearningEntry(projectRoot, entry)` and state in the PR body why appending was correct.
   - Entry mapping: `id` = the fingerprint; `rule`/`why`/`provenance` from the candidate; `first_learned` = `last_confirmed` = today (ISO date; on consolidation keep the superseded entry's earliest `first_learned`); `confidence` = the judge's `high`/`low`. The writer re-asserts the entry and token budgets — an over-budget failure means consolidate harder or drop, never truncate by hand.
4. **Branch + commit.** Work on branch `learning/<fingerprint>`. Commit only the learnings file; verify with `git diff --name-only` that the diff touches nothing else.
5. **PR body.** Exactly one marker line plus the reviewable story:

   ```markdown
   <!-- [lisa-learning-pr] key=<fingerprint> -->

   ## Learning
   <rule> — <judge rationale>

   ## Provenance
   - Triggering issue: <ref>
   - Ancestor issue/PR (the past failure this is round 2 of): <ref or none found>
   - Rejection comments that produced the candidate: <refs or none>
   - Cited evidence (from the judge): <refs>

   ## Consolidation decision
   <"Superseded entry id(s) X, Y: <why they merged>" | "Appended: no related entry exists — <one-line search summary>">
   ```

6. **Confidence routing.**
   - **`high`** → submit through `lisa-git-submit-pr` with its defaults: auto-merge ON, merging through the project's normal gates.
   - **`low`** → submit through `lisa-git-submit-pr` with `auto_merge=false` (drives the PR to green-and-open `awaiting-human`, never merging — even on repos that disallow auto-merge). Then apply the human-triage label, creating it idempotently first (the `lisa-drive-pr-to-merge` label pattern — `|| true` tolerates only already-exists, so verify):

     ```bash
     gh label create "learning:needs-triage" \
       --description "Low-confidence learning PR awaiting human triage" \
       --color FBCA04 || true
     gh label list --search "learning:needs-triage" --json name \
       --jq '[.[].name] | contains(["learning:needs-triage"])'   # must print true
     gh pr edit <pr> --add-label "learning:needs-triage"
     ```

     A low-confidence PR sitting OPEN with green checks and `autoMergeRequest: null` is this mode's **success** state — a human merges or closes it.

## Rules

- **Headless-safe**: no interactive prompts; must run identically under an intake cron.
- **Never block the build**: if judging or persistence fails, report the failure and let the primary flow continue — shipping the triggering issue always outranks recording a learning about it.
- **No learning loops about learning**: never feed this skill a candidate whose triggering artifact is itself learning machinery (a `[lisa-learning-*]`-marked comment, learning PR, or handoff); the judge's Step 0 guard backstops this.
- **Idempotent**: re-running with the same candidate posts no duplicate comment, opens no duplicate PR, and writes no duplicate entry — the fingerprint and markers guarantee it.
- **One write path**: the learnings surface changes only through `persistLearningEntry` / `persistConsolidatedLearning` inside a PR. Never hand-edit the file, never commit it to the default branch directly.

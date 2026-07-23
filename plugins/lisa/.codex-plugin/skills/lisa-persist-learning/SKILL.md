---
name: lisa-persist-learning
description: "a candidate learning (from a…"
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

Invoke the `learning-judge` agent (via the Agent/Task tool with `subagent_type: "learning-judge"` — the same invoke pattern the gardener uses for the `skill-evaluator` ladder router) with the full candidate including the fingerprint. It returns a verdict: `classification`, `cited_evidence[]`, `rationale`, `confidence` (durable only), `disposition`.

**Respect the verdict — do not override it.** Never re-run the judge hoping for a different answer, and never persist anything the judge did not classify `durable-learning`.

## Phase 2 — Route by disposition

All issue/PR comments below follow the marker-dedupe discipline from `lisa-github-write-prd` Phase 2, each with its own producer tag: match on the **marker, never the title or text**; **exactly one marker per body**; **never write a markerless body** (it breaks all future dedupe); include the eventual-consistency guard — when the `gh` search index is stale, also enumerate the bodies directly (`gh issue view <n> --json comments --jq '.comments[].body'` or `gh pr list --json number,body`) and grep for the marker before deciding to create.

### `drop` (classification `one-off` or `misunderstanding/spec-gap`)

Post **one** comment on the triggering issue and write **nothing** — zero bytes — to the learnings surface (not a stub, not a placeholder):

```markdown
<!-- [lisa-learning-drop] key=<fingerprint> -->
Dropped (<classification> — <plain-language gloss>): <reason>.
```

The note is one line naming the classification (with its fixed plain-language gloss) and the reason, readable by a non-technical operator. Use exactly these glosses per class:

| Classification | Gloss |
|----------------|-------|
| `one-off` | a one-time fluke, not a recurring pattern |
| `misunderstanding/spec-gap` | traced to an unclear requirement, not a durable lesson |
| `lisa-upstream` | root cause suspected in Lisa; routed for upstream attribution |

(A `lisa-upstream` classification never produces a drop note — it routes through the `handoff-upstream` flow below, whose step-1 note uses this pre-attribution wording because filing only happens after attribution confirms the Lisa surface.) Dedupe before posting: if any comment on the triggering issue already carries `[lisa-learning-drop] key=<fingerprint>`, do not post again — report the existing note.

### `handoff-upstream` (classification `lisa-upstream`)

This disposition completes the SLL-5 loop (#1583): on a Lisa-attributed failure the upstream Lisa ticket is filed **automatically**. Filing lives here — not in `lisa-attribute-failure` — because that skill is deliberately read-only (doctor delegates to it inside its own read-only contract), while this skill already owns exactly the verdict's side effects and the marker-dedupe discipline. Never persist a local rule for a Lisa-attributed failure; the host project's only durable trace is the brief linking note in step 6.

1. **Post the handoff marker** on the triggering issue (same one-comment marker dedupe; the marker key is unchanged). The visible line must not claim a filing that has not happened yet — attribution and filing come after this step:

   ```markdown
   <!-- [lisa-learning-upstream-handoff] key=<fingerprint> -->
   Candidate routed for upstream attribution (root cause suspected in Lisa): <reason>.
   ```

2. **Require a confirmed `lisa` verdict from `lisa-attribute-failure` — always.** Run the `lisa-attribute-failure` skill on the failure event before any filing. The judge's `cited_evidence` seeds the event (implicated files, surface in play, failure class) but never substitutes for the verdict — a path or commit reference alone is not attribution. File **only** when the skill returns a conclusive `lisa` verdict that names the Lisa surface with cited evidence. Any other outcome — `ambiguous`, `project`, or a verdict that cannot name a concrete Lisa surface — files **NOTHING** upstream: the candidate stays local and low-confidence, the run summary says attribution was inconclusive, and the step-1 note is resolved with one corrective follow-up comment on the triggering issue (marker-deduped so re-runs never repeat it; the suffix is distinct from the filing-failure marker in step 8 so one outcome never suppresses the other):

   ```markdown
   <!-- [lisa-learning-upstream-handoff] key=<fingerprint>-inconclusive -->
   Attribution was inconclusive — nothing was filed upstream and nothing was persisted locally.
   ```

3. **Derive the root-cause key from the LISA SURFACE, never the host project or the local issue.** Two projects hitting the same Lisa bug MUST collide on the same key — that collision is the design (update, not duplicate):

   ```text
   root-cause-key = <lisa-surface>#<failure-class>
   ```

   - `<lisa-surface>` — the exact public Lisa-relative path of the surface at fault (e.g. `plugins/src/base/skills/lisa-doctor/SKILL.md`, `typescript/copy-overwrite/.github/workflows/quality.yml`). Canonical names, aliases, host paths, and unmanifested paths are prohibited.
   - `<failure-class>` — exactly one exported closed value: `access-control-failure`, `agent-parity-regression`, `configuration-regression`, `data-integrity-failure`, `dependency-regression`, `generated-artifact-regression`, `installation-regression`, `observability-gap`, `pagination-truncation`, `performance-regression`, `public-data-exposure`, `release-regression`, `runtime-regression`, `stale-artifact-overwrite`, `test-coverage-gap`, `validation-gap`, or `workflow-contract-violation`.
   - Normalize: lowercase, trim, collapse every whitespace run to a single `-`. The key must contain no host-project name, no local issue number, and no fingerprint — those vary per project and would defeat fleet-wide dedupe.

4. **Enforce the per-run cap.** Resolve `hardening.maxUpstreamFilingsPerRun` from `.lisa.config.json` (default `5` — a conservative bound modeled on `lisa-repair-intake`'s `max_candidates` precedent). Count every upstream create **and** update this run performs; once the cap is reached, drop the remaining candidates and **note each dropped candidate visibly** (in the run summary, naming its root-cause key) — never queue a spam burst and never drop silently. A later run picks the dropped candidates up idempotently.

5. **Evidence redaction (binding).** The upstream repo is PUBLIC by default (`hardening.upstreamRepo` → `CodySwannGT/lisa`) and this filing runs headless on crons — treat every drafted upstream body and comment as world-readable. The PRIMARY control is the **allowlist projection** in step 6: `bunx @codyswann/lisa file-upstream` calls the sole `buildUpstreamAttributionIssueBody` export from `@codyswann/lisa/learnings`, so content outside its enumerated fields is structurally incapable of reaching the public document. The rules below bind the FIELDS supplied to that command; the closing scan is a defense-in-depth backstop, never the primary control:

   - Quote ONLY Lisa-owned surface text: template/rule/skill/hook excerpts and upstream commit references. The reproduction must be REDACTED — generic placeholders, never the host project's real values.
   - Never paste host environment values, tokens/credentials, connection strings, API keys, PII (names, emails, customer data), or proprietary host code/payloads.
   - The evidence chain names the Lisa surface and the failure class — never project payloads. Keep any host-project issue link only in the private local trace; it is never supplied to or emitted by the public builder.
   - Use only these exact generic placeholders: `<host-project>`, `<env-value>`, `<credential>`, `<connection-string>`, `<pii>`, `<host-payload>`, `<path>`, `<identifier>`. A project-specific placeholder is host prose and must be rejected.
   - **Backstop (defense in depth, never the primary control).** Before filing or commenting, scan the projected document for common secret shapes — `key=value` pairs with high-entropy values, token prefixes (`AKIA`, `ghp_`, `xox`), email addresses — and reject on a match. To strip on match, remove the offending INPUT field and re-run `file-upstream`; never strip or edit the generated output itself. Non-allowlisted fields must reject before filing rather than be silently dropped. When in doubt, leave it out: a thinner upstream document is recoverable; a leaked secret is not.

6. **Dedupe by marker, then file or update.** The upstream marker is:

   ```markdown
   <!-- [lisa-upstream-attribution] key=<root-cause-key> -->
   ```

   Resolve the upstream repo from `.lisa.config.json` `hardening.upstreamRepo` (default `CodySwannGT/lisa`). Search **all issue states** for an existing issue carrying the marker — a closed marker-bearing ticket still owns this root cause, and searching only open issues would mint a duplicate the moment the original closes. Match on the **MARKER, never the title** — with the same eventual-consistency guard as above (`gh issue list -R <upstream> --state all --search '"<marker>" in:body' --json number,state,url`, and when the search index returns nothing, also `gh issue list -R <upstream> --state all --json number,state,body` and grep the bodies for the marker before concluding no ticket exists).

   - **No existing ticket** → compose the body EXCLUSIVELY through the executable builder, then file its stdout verbatim via `lisa-github-write-issue` targeting the upstream repo with the `self-hardening` label:

     ```bash
     bunx @codyswann/lisa file-upstream --input filing-event.json   # or pipe the JSON on stdin
     ```

     **Never assemble the public body as free-form prose.** Public composition happens through the builder, never by free-form prose assembly. The builder owns the three-audience description and the redacted evidence chain (Lisa-owned text only). Do not hand-write either section, name an affected project in prose, or edit the builder's output after generation. Supply only this JSON shape; host-project issue URLs remain private local-trace data and are never accepted by the public builder:

     ```json
     {
       "documentKind": "issue",
       "lisaSurface": "plugins/src/base/skills/lisa-doctor/SKILL.md",
       "failureClass": "stale-artifact-overwrite",
       "lisaOwnedExcerpts": [
         {
           "file": "plugins/src/base/skills/lisa-doctor/SKILL.md",
           "text": "<verbatim Lisa-owned text>"
         }
       ],
       "upstreamCommitRefs": ["<full 40-character public-origin SHA>"],
       "redactedPlaceholders": ["<host-project>", "<env-value>"]
     }
     ```

     Every excerpt is verified against the installed package's Lisa-owned source and every commit against the public origin. Callers cannot supply a verifier or Lisa root. Anything outside the allowlist is REJECTED by field name with empty stdout and a non-zero exit; fix or remove the offending input field and re-run the command, never route around it. The builder emits **exactly one** dedupe marker; **never write a markerless body** — it permanently breaks all future dedupe.
   - **Existing ticket (open or closed)** → this is a repeat encounter: comment the new occurrence on the existing issue with this project's evidence. The comment is projected through the same builder: run `bunx @codyswann/lisa file-upstream` with the same allowlisted fields plus exactly `"documentKind": "occurrence"` and `"occurrenceFingerprint": "<fingerprint>"`. The supplied fingerprint is only a validated seed: the builder hashes it and emits a different deterministic `sll4-<12 lowercase hex>` marker. Use the marker in the builder's stdout — never the supplied literal — to search existing issue comments for a duplicate, then post stdout verbatim only when that emitted marker is absent. Free-form occurrence prose is prohibited, and post-generation edits are prohibited. Never open a second issue, and never match on the title — evidence compounds on one ticket. When the match is **CLOSED**, still comment the occurrence there and reference it in the local trace instead of filing a duplicate; do not reopen it yourself — recurrence evidence on a closed ticket signals the shipped fix may not cover this case, and reopening is the upstream maintainer's call.

7. **Leave the local trace — a note, never a rule.** Post one follow-up comment on the triggering issue linking the upstream ticket:

   ```markdown
   <!-- [lisa-upstream-filed] key=<fingerprint> -->
   Upstream ticket: <url> (root-cause key `<root-cause-key>`). No local rule persisted — the fix ships fleet-wide through Lisa.
   ```

   The learnings surface gains **no durable local rule** for a Lisa-attributed failure. Agents avoid the trap via the upstream ticket link until the fix ships.

8. **Degrade gracefully.** If filing fails (auth, rate limit, network), report the failure in the run summary and continue shipping the host issue — a later run retries idempotently. Never block the primary build flow. So the step-1 note is not left dangling, post a marker-deduped corrective follow-up on the triggering issue — with its own suffix, distinct from step 2's `-inconclusive`, so an earlier inconclusive note can never suppress a filing-failure note (or vice versa):

   ```markdown
   <!-- [lisa-learning-upstream-handoff] key=<fingerprint>-filing-failed -->
   Upstream filing did not complete — nothing was filed upstream and nothing was persisted locally; a later run retries.
   ```

### `persist` (classification `durable-learning`)

Continue to Phase 3.

## Phase 3 — Persist via PR (durable-learning only)

No learning content is ever committed without a PR — there is no other write path, and the PR must touch **only** the learnings surface (any other changed file is a bug).

1. **PR dedupe.** Search all PRs for the marker `[lisa-learning-pr] key=<fingerprint>` in the body (`gh pr list --state all --search '"<marker>" in:body' --json number,url`), with the stale-index guard above. If one exists, reference it and stop — never open a duplicate.
2. **Resolve the learnings surface path — never hardcode it.** The canonical path is `resolveProjectLearningsFile` from `@codyswann/lisa/learnings`: the machine-managed ledger resolved from `.lisa.config.json` (the `learnings.file` override, else the default `.lisa/PROJECT_LEARNINGS.md` — a cold path, never an auto-loaded rules tree):

   ```bash
   LEARNINGS_FILE=$(node -e 'import("@codyswann/lisa/learnings").then(async m => { const c = await m.readProjectConfig(process.cwd()); console.log(m.resolveProjectLearningsFile(c)); })')
   ```

3. **Consolidation check (mandatory before writing).** Parse the existing entries (`parseLearningsFile` from `@codyswann/lisa/learnings`) and look for entries related to the new rule (same failure class, overlapping topic, or near-duplicate wording). Then write through the executable contract — **never hand-edit the markdown**:
   - **Related entry found** → consolidate via `persistConsolidatedLearning(projectRoot, entry, { supersede: [<related ids>] })`, merging the old entry's still-true content into the new rule. Never append a near-duplicate sibling — a sibling is a bug that fails review.
   - **No related entry** → append via `persistLearningEntry(projectRoot, entry)` and state in the PR body why appending was correct.
   - Entry mapping: `id` = the fingerprint; `rule`/`why`/`provenance` from the candidate; `first_learned` = `last_confirmed` = today (ISO date; on consolidation keep the superseded entry's earliest `first_learned`); `confidence` = the judge's `high`/`low`. The writer re-asserts the entry and token budgets — an over-budget failure means consolidate harder or drop, never truncate by hand.
   - **On a budget-forced drop, signal saturation once (never silent).** When the writer's budget re-assertion cannot fit the entry even after consolidating harder — a durable capture has to be DROPPED for budget — the ledger is saturated, and that pressure must be visible to an operator instead of swallowed. Emit **exactly one** tracker signal via `lisa-tracker-write` (`issue_type: Task`; GitHub trackers carry the `type:Task` label), then continue — dropping the capture never blocks the build. Follow the same marker-dedupe discipline as every other comment here (match on the **marker, never the title**; **exactly one marker per body**; the eventual-consistency guard when the search index is stale), with **one deliberate difference: dedupe against OPEN signals only.** A *closed* saturation ticket means room was already reclaimed, so a fresh saturation is a new actionable event — searching closed tickets too (as the drop/upstream markers do) would permanently suppress every later saturation.

     The saturation fingerprint keys on the **ledger, not the candidate**, so the signal fires once per saturation episode — never once per capture:

     ```text
     saturation-fingerprint = "sat-" + first 12 hex chars of sha1(<resolved learnings-file path>)
     ```

     ```markdown
     <!-- [lisa-ledger-saturated] key=<saturation-fingerprint> -->
     Learnings ledger saturated — a durable capture was dropped for budget. The projection is now omitting entries; promote or retire a learning to reclaim room. This records budget pressure for the gardener's next audit — it is not itself a new learning.
     ```

     The `[lisa-ledger-saturated]` marker sits **outside the `[lisa-learning-*]` namespace** that the gardener (`lisa-learnings-audit`) auto-excludes from candidacy — chosen so the gardener reads it as budget-pressure evidence (its `projectLearnings` omission / promote-or-retire axis) rather than skipping it as learning-machinery noise. **Do not reuse a `[lisa-learning-*]` marker here** — that would make the gardener blind to the very pressure it exists to relieve. The candidate itself is still dropped; this signal records the saturation, it does not persist the rule.
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

   For a **low-confidence** PR, the body must additionally end with this fixed decision-framing line so the human at the gate knows exactly what merging means:

   ```markdown
   **Merge** to adopt this rule into every future session for all six coding agents; **close** to discard it.
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

     A low-confidence PR sitting OPEN with green checks and `autoMergeRequest: null` is this mode's **success** state — a human merges or closes it. All pending low-confidence learning PRs are findable by filtering on the `learning:needs-triage` label (`gh pr list --label "learning:needs-triage"`).

## Rules

- **Headless-safe**: no interactive prompts; must run identically under an intake cron.
- **Never block the build**: if judging or persistence fails, report the failure and let the primary flow continue — shipping the triggering issue always outranks recording a learning about it.
- **No learning loops about learning**: never feed this skill a candidate whose triggering artifact is itself learning machinery (a `[lisa-learning-*]`-marked comment, learning PR, or handoff); the judge's Step 0 guard backstops this.
- **Idempotent**: re-running with the same candidate posts no duplicate comment, opens no duplicate PR, and writes no duplicate entry — the fingerprint and markers guarantee it.
- **One write path**: the learnings surface changes only through `persistLearningEntry` / `persistConsolidatedLearning` inside a PR. Never hand-edit the file, never commit it to the default branch directly.

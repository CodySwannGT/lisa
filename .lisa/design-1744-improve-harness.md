# Architecture Analysis — `lisa-improve-harness` (#1744)

## Files to Create

- `plugins/src/base/skills/lisa-improve-harness/SKILL.md` — the loop (spec below)
- `plugins/src/base/commands/improve-harness.md` — FLAT (not under `commands/improve/`); `/lisa:improve-harness` is one hyphenated segment

## Files to Modify

None hand-edited. `bun run build:plugins` regenerates `plugins/lisa*` artifacts (commit both trees).

## Dependency Graph

`plugins/src/base/skills/lisa-improve-harness/SKILL.md` → `plugins/src/base/commands/improve-harness.md` → `bun run build:plugins` → `plugins/lisa*` (generated)

---

# SKILL.md — section-by-section specification

## 1. Frontmatter

```yaml
---
name: lisa-improve-harness
description: "Investigate ONE failed or expensive factory trajectory and prove whether a fix helped. Records the job contract, observes the baseline, locates the earliest failed handoff, classifies the gap as exactly one of context | capability | domain-ownership | authority | proof | feedback-delivery | worker-limitation, makes the smallest owning intervention at the authoritative owner (larger changes become a proposed-intervention ticket and the loop stops), verifies at both layers (native gates plus the operational journey), then reruns the same job class in a fresh session and isolated worktree behind a relevance gate — a rerun that never retrieved or invoked the intervention yields no-evidence-for-intervention, never retain. Terminates by posting a fingerprinted result record on the originating work item with decision retain, revise, remove, or test-without. Headless-safe, idempotent per trajectory, single-trajectory bounded claims only."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep", "Edit", "Write", "Agent"]
---
```

Constraints satisfied: parseable YAML, description quoted (it contains `: ` inside), 986 chars — under the 1024 cap enforced by `tests/unit/core/skill-frontmatter-contract.test.ts`.

**Tool justification** (this skill is the first of its family that *mutates*, so it needs more than the read-only peers' five):

| Tool | Why |
|---|---|
| `Skill` | Calls `lisa-attribute-failure` (Phase 4), `lisa-tracker-read`/`lisa-tracker-write` (Phases 0/5), `lisa-verification-lifecycle` + `lisa-codify-verification` (Phase 6), `lisa-git-submit-pr` (Phase 5), `lisa-persist-learning` (Phase 8) |
| `Bash` | `git worktree add`/`remove` for the isolated rerun, `git log`/`show` for baseline, `gh` for comments/tickets, `shasum` for the fingerprint, native gate commands |
| `Read`/`Glob`/`Grep` | Baseline trajectory evidence, owning-surface resolution, marker dedupe by direct body enumeration |
| `Edit`/`Write` | The smallest owning intervention itself — the only phase that writes, and only inside the authority envelope, only on a branch |
| `Agent` | The fresh rerun must not inherit the investigating session's context. A subagent is the portable clean-context mechanism across runtimes; headless CLI re-invocation via `Bash` is the fallback where the runtime lacks it. (Precedent: `lisa-persist-learning` invokes the Agent/Task tool for `learning-judge`.) |

## 2. Input contract

Body opens:

```markdown
# Improve Harness

Run ONE bounded baseline → intervention → fresh-rerun loop on a single failed or expensive trajectory. Trajectory: $ARGUMENTS
```

Accept as JSON or `key=value` (the `lisa-attribute-failure` / `lisa-persist-learning` input convention). Exactly one of the first two is required:

- `item_ref` — a work-item ref: tracker URL/key, PR URL, or session/run ref. Resolution, in order:
  - tracker key/URL → `lisa-tracker-read` for the full context bundle (comments, linked PRs, status history). This is also the **originating item** the result record posts to.
  - PR URL → `gh pr view --json number,title,body,commits,files,reviews,comments`; the originating item is the tracker item the PR links to, else the PR itself.
  - session/run ref (CI run URL, automation run id, transcript path) → read the run/transcript directly; the originating item is the tracker item it names, else `none` (see below).
- `observed_failure` — a described failure in prose when no ref exists. Resolution: the description IS the baseline claim; Phase 2 must still find at least one durable artifact (commit, log, PR, comment) corroborating it, or the loop stops at Phase 2 with `Verdict: insufficient-evidence`.
- `job_class` — optional short slug naming the class of job (e.g. `implement-leaf-ticket`, `verify-prd`). Derived in Phase 1 when absent.
- `mode` — optional `interactive` (default) | `headless`. See §6.

**No originating item** (a bare `observed_failure` with no tracker item): the skill files ONE tracker item via `lisa-tracker-write` (`issue_type: Task`, label `type:harness`) carrying the job contract, and that item becomes the originating item. It never posts the result record nowhere.

Missing tool access at any point (no `gh`, no tracker credentials, no worktree): follow the `tool-access-gate` rule's break-out protocol — report the missing access on the work item and stop. Never substitute a weaker step.

## 3. The loop — Phases

### Phase 0 — Idempotency check (before anything else)

Compute the fingerprint (§5), scan the originating item for the marker, and stop with `already-improved` on a match. Nothing in Phases 1–8 runs on a duplicate invocation.

### Phase 1 — Record the job contract

Write the job-contract block (§4) into the result-record draft. This is the loop's frame of reference: everything later is measured against it. **The base revision is pinned here** — the rerun in Phase 7 uses this exact revision, not `HEAD`.

If the accepted outcome cannot be stated observably ("done correctly" is not checkable by someone who did not run the job), stop: `Verdict: insufficient-evidence`, reason `no-checkable-outcome`. An unfalsifiable contract makes every later phase unfalsifiable too.

### Phase 2 — Observe the baseline trajectory

Reconstruct what actually happened, from artifacts only — never from reconstruction-by-plausibility. Sources, in priority order: the run/session transcript; the PR (diff, commits, especially late `fix:`/`revert:` follow-ups, review threads); tracker comments and status history; the `lisa:git-history-analyzer` agent for the surrounding file evolution; CI logs.

Per the `empirical-inquiry` rule, every claim about what the worker did or knew cites a concrete artifact. Record which sources were reachable and which were not — an unreachable source is a stated limit in the result record, never a silent gap.

### Phase 3 — Locate the earliest failed handoff

A **handoff** is any point where work, information, or authority moves: intake → plan, plan → ticket, ticket → worker, worker → gate, gate → next worker, worker → human. Walk the baseline forward and name the **first** handoff whose output was already wrong, incomplete, or unusable — not the point where the failure became visible.

Record: the handoff (from → to), the artifact that crossed it, what was wrong with it, and the citation. Downstream symptoms are explicitly noted as symptoms of this handoff, not as separate findings. If two handoffs are genuinely tied, take the earlier one; if the earliest cannot be established from artifacts, stop with `Verdict: insufficient-evidence`.

### Phase 4 — Classify the gap

Classify the earliest failed handoff into **exactly one** taxonomy gap, with cited evidence.

| Gap | One-sentence definition |
|---|---|
| `context` | The worker had the tools, ownership, and authority to do the step but lacked a fact it needed — a spec detail, convention, prior decision, or state of the world — at the moment it acted. |
| `capability` | The worker lacked a tool, command, skill, credential, or environment the step actually required, and proceeded degraded instead of stopping. |
| `domain-ownership` | The step crossed into a surface no configured worker owns, so the handoff had no responsible recipient and fell through. |
| `authority` | The worker knew what to do and could do it, but was not permitted to (gate, protected environment, approval boundary) and worked around the boundary instead of breaking out. |
| `proof` | The output was genuinely wrong and no gate, test, or check existed that would have observed that class of defect. |
| `feedback-delivery` | A signal that would have caught it did exist, but never reached the worker in a usable form or in time — buried in a log, emitted as a non-blocking warning, or produced after the decision was already made. |
| `worker-limitation` | The worker itself could not perform the step even with full context, tools, ownership, authority, proof, and feedback — the other six are affirmatively excluded. |

**The worker-limitation multi-failure guard (binding).** `worker-limitation` requires **≥2 comparable failed trajectories** — same job class, same handoff, same failed step, different runs — each cited by ref, AND an explicit exclusion line for each of the other six gaps. A single trajectory can **never** establish `worker-limitation`; the skill has exactly one trajectory by construction, so reaching this classification requires citing prior recorded trajectories (found by searching the originating repo/tracker for prior `[lisa-improve-harness]` markers on the same `job_class`). When the second comparable failure cannot be produced, classify as the best-supported of the other six, or `unclassified`.

`unclassified` is a **surfaced terminal outcome**, never a silent default (the `lisa-rework-triage` `UNCLASSIFIED` precedent): the loop stops, posts the result record with `Verdict: unclassified`, and no intervention is made. Guessing a gap to avoid this is forbidden.

**`lisa-attribute-failure` runs here.** Invoke it (Skill tool) on the failed handoff — `defect`, `implicated_files`, `surface_in_play`, `failure_class` seeded from Phases 2–3 — to decide whether the owning surface is **Lisa's** or the **project's**. That verdict does not choose the taxonomy gap; it chooses the *owner* in Phase 5:

- `project` → the owner is a project surface; local intervention is in scope.
- `lisa` **and we are in a host project** → per the `upstream-to-lisa` rule the fix belongs upstream. Do not edit Lisa-managed surfaces from the host: route the intervention through `lisa-persist-learning`'s `handoff-upstream` disposition (which owns the filing, dedupe marker, per-run cap, and redaction) and record `Decision: n/a — routed upstream`. Any local stopgap is recorded as a stopgap, never as the intervention under test.
- `lisa` **and we are inside `CodySwannGT/lisa`** → the `upstream-to-lisa` rule does not apply; the owning surface is local (`plugins/src/...`) and the intervention proceeds normally.
- `ambiguous` → terminal-local; no upstream filing. Continue only if a project-owned surface can still be named; otherwise `unclassified`.

### Phase 5 — The smallest owning intervention (bounded authority)

**Authoritative owner by gap** — the intervention lands where the gap lives, never where the symptom appeared:

| Gap | Authoritative owner |
|---|---|
| `context` | The knowledge surface that should have carried the fact — wiki page, ticket/PRD template, the relevant rule, or a ledger entry via `lisa-persist-learning` |
| `capability` | Tool/credential provisioning (a `type:tooling` ticket) or the skill that should have wrapped the tool |
| `domain-ownership` | The worker roster / routing config that assigns the surface |
| `authority` | The gate or authority-envelope configuration that should have stopped the worker |
| `proof` | The missing gate, test, lint, or ast-grep control (see the `promotion-contract` rule when prose is being replaced by a control) |
| `feedback-delivery` | Where the signal is emitted, escalated, or blocked — severity, timing, or delivery surface |
| `worker-limitation` | No local intervention; upstream/roster decision only |

**Smallest owning change** = the minimal edit at that one owner that closes this gap and nothing else. An intervention is **larger than the smallest owning change** — and therefore out of authority — if any of these hold:

1. It touches more than one owning surface.
2. It changes a contract other workers depend on (a shared schema, a status/label vocabulary, a skill's input/output shape).
3. It requires a new tool, dependency, credential, or environment.
4. It changes product behavior, not harness behavior.
5. It falls outside the authority envelope recorded in the job contract.

**On any of those: file a proposed-intervention ticket via `lisa-tracker-write` and STOP.** The ticket carries the job contract, the earliest failed handoff, the gap classification with evidence, and the proposed change with its expected mechanism; labels `type:harness`, `status:blocked` (human-flipped to `status:ready` when approved). Post the result record with `Verdict: bounded-authority-stop`, `Decision: n/a (proposed-intervention <url>)`, and terminate. Implementing it anyway is the failure mode this phase exists to prevent.

Otherwise: make the change on a branch (`harness/<fingerprint>`), never a direct commit to the default branch, and state the **expected mechanism** — the specific causal chain by which this change makes the failed handoff succeed — *before* verifying. An intervention with no stated mechanism cannot be relevance-gated in Phase 7.

### Phase 6 — Two-layer verification

Both layers, in order, per the `verification` rule:

- **Layer 1 — native gates.** The project's own lint/typecheck/test/build for the changed surface, plus (in this repo) `bun run build:plugins` + `bun run check:plugins` when the surface is under `plugins/src/`. These are **quality checks, not verification** — the `verification` rule is explicit that a green suite is a prerequisite and never the proof.
- **Layer 2 — the operational journey.** Exercise the harness the way the factory does: run the representative job (or the smallest faithful slice of it) and observe the previously failing handoff now producing a usable output. Delegate to `lisa-verification-lifecycle` where the surface has one. Capture typed `[EVIDENCE: <artifact-type>: <name>]` artifacts from the `verification` rule's fixed taxonomy.

Layer 1 red → fix or revert; never proceed to Phase 7 on red gates. Layer 2 unrunnable → record it as a known limit and downgrade the strongest available decision to `revise`; never claim a journey that was not run.

For a `proof`-gap intervention, `lisa-codify-verification` applies: the new control is the codification.

### Phase 7 — Fresh-session rerun + the relevance gate

1. **Isolated starting state.** `git worktree add` off the base revision pinned in Phase 1, with the intervention applied (and only the intervention). No investigator working-tree state leaks in. Remove the worktree in a `finally`-equivalent step.
2. **Fresh session.** Rerun via a subagent with no inherited context (or headless CLI re-invocation). The rerun agent receives the representative job and the worker config from the job contract — **not** the investigation, not the gap classification, not the intervention's existence. Telling it about the intervention contaminates the only evidence this phase produces.
3. **Same job class, same worker config.** Any deviation from the job contract is recorded as a limit.

**The relevance gate (binding).** A successful rerun credits the intervention **only** if the rerun transcript shows the intervention was **retrieved or invoked** — the changed file was read, the skill was called, the gate fired, the new message was surfaced, the added test ran. Positive evidence is required; absence of evidence is not evidence.

- Rerun **succeeded** and the intervention **was** retrieved/invoked → `Verdict: intervention-supported`.
- Rerun **succeeded** and the intervention was **not** retrieved/invoked → `Verdict: no-evidence-for-intervention`. **Never `retain`.** The success is attributed to run-to-run variance until proven otherwise, and the honest next action is `Decision: test-without` — rerun with the intervention deliberately withheld to see whether the local evidence already suffices.
- Rerun **failed at the same handoff** → the intervention did not close the gap → `Decision: remove` (or `revise` when the mechanism was right and the surface was wrong).
- Rerun **failed at a later handoff** → this gap closed, a new one exists → `Decision: retain` for this gap, and the new handoff is a *separate* trajectory: file it, do not chain a second loop inside this one.

### Phase 8 — Decision, result record, learnings

Two fields, deliberately separate:

- `Verdict` (evidence status): `intervention-supported` | `intervention-refuted` | `no-evidence-for-intervention` | `insufficient-evidence` | `unclassified` | `bounded-authority-stop` | `headless-proposal-only`
- `Decision` (action): `retain` | `revise` | `remove` | `test-without` — the four the ticket's AC requires. A completed loop always carries exactly one. Early terminations (`insufficient-evidence`, `unclassified`, `bounded-authority-stop`) carry `Decision: n/a` plus the reason, because the loop did not complete.

Decision table:

| Verdict | Rerun outcome | Decision |
|---|---|---|
| `intervention-supported` | succeeded, intervention invoked | `retain` — merge the branch through `lisa-git-submit-pr` |
| `intervention-supported` | failed at a later handoff (this gap closed) — relevance gate satisfied | `retain` (this gap) + file the new trajectory |
| `no-evidence-for-intervention` | succeeded, intervention never invoked | `test-without` |
| `intervention-refuted` | failed at the same handoff, mechanism wrong | `remove` — revert the branch |
| `intervention-refuted` | failed at the same handoff, mechanism right / surface wrong | `revise` — one revised attempt inside budget, else file a proposed-intervention ticket |

Post the result record (§4) to the originating item with its marker. Any durable lesson the loop produced routes through `lisa-persist-learning` (the ledger's only write path per the `project-learnings` rule) — this skill never writes the learnings file, `PROJECT_RULES.md`, or `CLAUDE.md` itself, and never promotes a learning to a higher rung (that is the gardener's ticket-gated job).

## 4. Embedded templates

Both are inline fenced blocks in the skill body.

### Job contract

```text
[lisa-improve-harness] Job contract
Target: <repo / harness surface under improvement>
Revision: <base git sha>  Lisa: <version or plugin stamp>
Worker config: <agent type / model / runtime / skill+plugin set that ran the job>
Representative job: <job_class> — <the exact input: ticket ref or prompt that stands for the class>
Accepted outcome: <what "done correctly" means, observable and checkable by someone who did not run it>
Evidence: <typed [EVIDENCE: <artifact-type>: <name>] markers proving the outcome>
Authority envelope:
  - may change: <surfaces this loop may edit directly>
  - may only propose against: <surfaces requiring a proposed-intervention ticket>
  - upstream lane: <lisa | project | n/a>
Budget: <max 1 intervention + 1 rerun + 1 optional test-without rerun; wall-clock/token bound>
Stop conditions: bounded-authority breach | unclassified gap | missing tool access
  (tool-access-gate) | insufficient baseline evidence | budget exhausted
```

### Result record

```text
<!-- [lisa-improve-harness] key=<fingerprint> -->
[lisa-improve-harness] Result record (job class: <job_class>)

Suspected gap: <gap> — <one plain-language sentence a non-technical operator can read>
Baseline evidence: <2-4 lines, each citing a concrete artifact (transcript line, commit sha, PR review, log)>
Earliest failed handoff: <from> -> <to>; artifact <what crossed>; wrong because <...>
Owner: <authoritative owner surface, path or name> (attribution: <lisa | project | ambiguous>)
Intervention: <the smallest owning change, with path> | none (<reason>)
Expected mechanism: <the causal chain by which this change makes the handoff succeed>
Verification:
  - native gates: <commands run + result>
  - operational journey: <what was run, what was observed, evidence artifacts>
Fresh rerun: worktree @ <base sha>, fresh session, same worker config
  - outcome: <succeeded | failed at same handoff | failed at later handoff | not run (<why>)>
  - relevance gate: <retrieved/invoked — cited proof> | <not retrieved/invoked>
Verdict: <intervention-supported | no-evidence-for-intervention | insufficient-evidence | unclassified | bounded-authority-stop>
Decision: <retain | revise | remove | test-without | n/a (<reason>, <ticket url>)>
Recorded owner: <who/what surface now owns this behavior>
Known limits: <what this record does NOT establish — always non-empty>
```

## 5. Idempotency

```text
fingerprint = "ih1-" + first 12 hex chars of sha1(normalized_item_ref + "\n" + normalized_trajectory_ref)
normalized_*  = lowercased, whitespace runs collapsed to single spaces, trimmed
trajectory_ref = the failing run identifier (PR number, CI run URL, session/transcript id);
                 when none exists, the normalized `observed_failure` text
```

```bash
NORM_ITEM=$(printf '%s' "$ITEM_REF" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//')
NORM_TRAJ=$(printf '%s' "$TRAJ_REF" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//')
FP="ih1-$(printf '%s\n%s' "$NORM_ITEM" "$NORM_TRAJ" | shasum -a 1 | cut -c1-12)"
```

(`sha1sum` where `shasum` is unavailable.) Marker discipline follows `lisa-persist-learning` Phase 2: match on the **marker, never the title or text**; **exactly one marker per body**; **never write a markerless body**.

**Dedupe before write (Phase 0 and again immediately before posting):**

1. Search the originating item's comments for `[lisa-improve-harness] key=<fingerprint>` (`gh issue view <n> --json comments --jq '.comments[].body'`, or the vendor comment read).
2. Eventual-consistency guard: when a search index is used and returns nothing, also enumerate bodies directly and grep before concluding no record exists.
3. Match found and its `Decision` is not `test-without` → report `already-improved` and stop; make no mutation.
4. Match found and its `Decision` **is** `test-without` → a follow-up run is the recorded next action: post under `key=<fingerprint>-r<N>`, where `N` = 1 + the count of existing markers with the `<fingerprint>-r` prefix.
5. Branch/worktree names reuse the fingerprint (`harness/<fingerprint>`), so a re-entrant run collides with its own artifacts instead of forking new ones.

## 6. Headless-safe mode

Trigger: `mode=headless`, a non-interactive/automation invocation (cron, intake, CI), or any run where a TTY is absent. When ambiguous, assume headless — the safe direction.

In headless mode:

- **No working-tree mutation of any kind.** Phase 5 does not edit, branch, or commit; it *drafts* the smallest owning change and files it as a proposed-intervention ticket via `lisa-tracker-write` (`type:harness`, `status:blocked`), with the drafted diff sketch, the expected mechanism, and the verification plan.
- Phases 6 and 7 do not run (there is nothing applied to verify); the result record carries `Verdict: bounded-authority-stop`, `Decision: n/a (proposed-intervention <url>)`, and a `Known limits` line saying no rerun evidence exists.
- **Output is exactly: the result record + the proposed-intervention ticket(s).** Mutation of any kind requires a human flipping that ticket to `status:ready`, after which the normal factory (or an interactive invocation) implements it.
- Never a prompt, never a question, never a blocked wait — anywhere in the skill, in either mode.

**Named contradiction + resolution.** The ticket says "headless: output is the result record + proposed-intervention ticket(s)" and also "mutation beyond the smallest owning change requires a human-flipped ticket," which read together could imply headless runs may still make the smallest owning change. Resolution taken: **headless proposes only; the smallest-owning-change authority belongs to the interactive mode.** Rationale: this is the convention-conformant reading — `lisa-persist-learning` lets nothing durable reach a managed surface outside a human-visible gated artifact, and the factory model puts autonomous mutation behind the ready-role flip. The second sentence is the general (interactive) authority bound; the first narrows headless output. Interactive mutation still never touches the default branch directly — it lands on `harness/<fingerprint>` and ships through `lisa-git-submit-pr`.

## 7. Bounded-claim discipline

The result record **may** claim:

- What this one trajectory did, with cited artifacts.
- Which handoff failed earliest in it, and which single gap the evidence supports.
- That the intervention was, or was not, retrieved/invoked in one fresh rerun of one job.
- That one rerun of this job class, at this revision, with this worker config, succeeded or failed.

The result record **may not** claim:

- **`worker-limitation` from one trajectory.** One failure never establishes it — the multi-failure guard is not a formality.
- **That the intervention caused a rerun success it was never retrieved for.** No-retrieval success is `no-evidence-for-intervention`, full stop.
- **Any comparative or longitudinal claim** — "better than", "improved the harness", "reduced failures by", "the model is worse at X", pass-rate/eval framing. Those need a population and a control; this loop has one trajectory. Explicitly Out of Scope in the ticket.
- **Generalization to other job classes, workers, repos, or revisions** than the ones pinned in the job contract.
- **That a green Layer-1 gate proves anything about behavior** — quality checks are not verification (`verification` rule).

`Known limits` is a **required, never-empty** field. A record with nothing in it is invalid on its face, because a single-trajectory loop always has limits.

## 8. Overlap boundaries

- **vs `lisa-attribute-failure`** — that skill answers one narrow question about a single event (is this Lisa's fault or the project's) and is read-only; `improve-harness` **calls it** during Phase 4 to pick the authoritative owner, and owns everything before and after it.
- **vs `lisa-rework-triage`** — that skill fires only on confirmed QA/staging bounces and classifies the *previous agent attempt* into its six causes; `improve-harness` is the generic single-trajectory loop that runs on any failed or expensive run, bounce or not, and actually makes and tests an intervention.
- **vs `lisa-debrief`** — that mines a whole shipped initiative across many tickets and PRs for candidate learnings; `improve-harness` investigates exactly one trajectory in depth and proves a fix.
- **vs `lisa-persist-learning`** — that is the ledger's judged write path; `improve-harness` never writes the learnings surface itself and routes every durable lesson (and every Lisa-attributed upstream filing) **through** it.
- **vs the gardener (`lisa-learnings-audit`)** — that is the periodic, ticket-gated promotion/demotion/retirement pass over accumulated knowledge; explicitly Out of Scope here, and `improve-harness` never promotes a learning to a higher rung.

## 9. Command file — verbatim

`plugins/src/base/commands/improve-harness.md`:

```markdown
---
description: "Investigate one failed or expensive factory trajectory end to end: record the job contract, observe the baseline, locate the earliest failed handoff, classify the gap (context | capability | domain-ownership | authority | proof | feedback-delivery | worker-limitation), make the smallest owning intervention at the authoritative owner, verify at both layers, and rerun in a fresh isolated session behind a relevance gate before deciding retain, revise, remove, or test-without. Files a proposed-intervention ticket and stops when the fix exceeds the smallest owning change."
argument-hint: "<ticket URL | PR URL | session or run ref | described failure>"
---

Use the /lisa-improve-harness skill to run one bounded baseline → intervention → fresh-rerun loop on the given trajectory and post the result record to the originating work item. $ARGUMENTS
```

(Flat file, not `commands/improve/harness.md`: nesting would produce `/lisa:improve:harness`, and the ticket specifies `/lisa:improve-harness`. The existing `commands/improve/` directory is unaffected — a sibling file and a directory of the same stem do not collide.)

## 10. AC coverage matrix

| Gherkin scenario | Satisfied by |
|---|---|
| **Gap classification precedes intervention** — earliest failed handoff classified into exactly one gap with cited evidence; worker-limitation requires >1 comparable failure | Phase 3 (earliest failed handoff, artifact-cited) → Phase 4 (taxonomy table, exactly-one rule, `unclassified` as surfaced outcome, the binding multi-failure guard). Phase 5 is ordered strictly after Phase 4, and the result-record template forces `Suspected gap` + `Baseline evidence` before `Intervention`. |
| **Relevance gate** — successful rerun where the intervention was never retrieved/invoked reports no-evidence-for-intervention, not retain | Phase 7 relevance gate (positive-retrieval evidence required; absence ≠ evidence) → Phase 8 decision table row mapping that case to `Verdict: no-evidence-for-intervention` / `Decision: test-without`, plus §7 bullet 2. |
| **Bounded authority** — intervention larger than the smallest owning change files a proposed-intervention ticket instead of implementing, and stops | Phase 5 "larger than the smallest owning change" five-condition test + the file-and-STOP rule via `lisa-tracker-write`; §6 makes the same outcome unconditional in headless mode; Rules bullet "Bounded authority". |
| **Result record lands on the ticket** — completed loop leaves the record with decision retain / revise / remove / test-without | Phase 8 (post to the originating item) + §4 result-record template (`Decision` restricted to the four for completed loops; early terminations carry `n/a` + reason and are not completed loops) + §2 (a trajectory with no originating item gets one filed first) + §5 marker dedupe so the record lands exactly once. |

## `## Rules` — closing bullets (verbatim)

- **Headless-safe.** No interactive prompts anywhere, in either mode. Under an automation the skill proposes and reports; it does not mutate.
- **Never block.** A failed investigation, unreachable evidence, missing tooling, or an unrunnable rerun degrades to a stated verdict with the gap named — it never raises an error that stops the caller's build, intake, or verification flow.
- **Evidence-cited.** Every claim about the baseline, the handoff, the gap, and the rerun names a concrete artifact. An uncited classification is `unclassified`; an uncited rerun is `not run`.
- **Idempotent per trajectory.** Same trajectory in → same fingerprint → no duplicate record, no duplicate ticket, no duplicate branch. Dedupe before every write.
- **Bounded authority.** Direct change only at the single authoritative owner, only within the recorded authority envelope, only on a branch, only through a PR. Anything larger is a proposed-intervention ticket and a full stop.
- **Bounded claims.** One trajectory supports one trajectory's claim. No comparative, longitudinal, or population claims; `Known limits` is never empty.
- **One write path for learnings.** Durable lessons route through `lisa-persist-learning`; this skill never edits the learnings ledger, `PROJECT_RULES.md`, or a rules tree, and never promotes a learning to a higher rung.

## Risks

- **Rerun cost/flake.** A full representative job can be expensive and non-deterministic — mitigated by the job contract's budget field, "smallest faithful slice" allowance in Layer 2, and treating unexplained rerun success as `no-evidence-for-intervention` rather than credit.
- **Fresh-session contamination.** Passing investigation context to the rerun agent silently destroys the only evidence Phase 7 produces — mitigated by the explicit "the rerun agent receives the job, not the investigation" instruction.
- **Worktree leakage.** An abandoned rerun worktree pollutes the repo — mitigated by the pinned `harness/<fingerprint>` naming and mandatory removal step.
- **`Agent`/`Edit`/`Write` in allowed-tools** widens this skill's blast radius versus its read-only peers — mitigated by the authority envelope, branch-only mutation, and headless propose-only mode.
- **Description length drift.** The frontmatter description sits near the 1024 cap; any edit must re-check `tests/unit/core/skill-frontmatter-contract.test.ts`.

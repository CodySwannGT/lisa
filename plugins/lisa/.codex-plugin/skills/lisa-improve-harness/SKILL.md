---
name: lisa-improve-harness
description: "Investigate ONE failed or…"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep", "Edit", "Write"]
---

# Improve Harness

Run ONE bounded baseline → intervention → fresh-rerun loop on a single failed or expensive
trajectory. Trajectory: $ARGUMENTS

A factory that fails and moves on keeps failing the same way. This loop takes exactly one
trajectory, finds the earliest place a handoff produced something unusable, fixes that one
place at its owner, and then tries to prove — in a fresh session that knows nothing about the
investigation — that the fix is what made the difference. The discipline that makes it worth
anything is the refusal to claim more than one trajectory can support.

**Every terminal state posts a result record to the originating item before stopping — there is
no silent exit.** That includes `already-improved` (Phase 0), `no-checkable-outcome` (Phase 1),
`insufficient-evidence` (Phases 2–3), `unclassified` (Phase 4), `bounded-authority-stop`
(Phase 5), and `headless-proposal-only`. A stop with no record on the work item is a bug in the
run, not a quiet success.

## Input — the trajectory

Accept the input as JSON or `key=value` fields. Exactly one of the first two is required.

- `item_ref` — a work-item ref: tracker URL/key, PR URL, or session/run ref. Resolve in order:
  - **tracker key/URL** → `lisa-tracker-read` for the full context bundle (comments, linked
    PRs, status history). This is also the **originating item** the result record posts to.
  - **PR URL** → `gh pr view <pr-url-or-number> --json number,title,body,commits,files,reviews,comments`;
    the originating item is the tracker item the PR links to, else the PR itself.
  - **session/run ref** (CI run URL, automation run id, transcript path) → read the run or
    transcript directly; the originating item is the tracker item it names, else `none`.
- `observed_failure` — a described failure in prose when no ref exists. The description IS the
  baseline claim; Phase 2 must still find at least one durable artifact (commit, log, PR,
  comment) corroborating it, or the loop stops with `Verdict: insufficient-evidence`.
- `job_class` — optional short slug naming the class of job (e.g. `implement-leaf-ticket`,
  `verify-prd`). Derived in Phase 1 when absent.
- `mode` — optional `interactive` (default) | `headless`. See "Headless-safe mode".

**No originating item** (a bare `observed_failure` with no tracker item): run the Phase 0
marker search FIRST (see "Idempotency"); adopt any marker-bearing item found as the originating
item. Only when the search finds nothing, file ONE tracker item via `lisa-tracker-write`
(`issue_type: Task`, label `type:harness`) carrying the job contract, and that item becomes the
originating item. The result record is never posted nowhere, and a re-invocation never mints a
second item for the same trajectory.

**Missing tool access** at any point (no `gh`, no tracker credentials, no worktree): follow the
`tool-access-gate` rule's break-out protocol — report the missing access on the work item and
stop. Never substitute a weaker step.

## Phase 0 — Idempotency check

Before anything else: compute the fingerprint (see "Idempotency"), search for the marker —
on the originating item's comments when one was supplied, and across the tracker when one was
not — and stop with `already-improved` on a match (posting nothing new; the existing record
stands). Nothing in Phases 1–8 runs on a duplicate invocation.

## Phase 1 — Record the job contract

Write the job-contract block into the result-record draft. This is the loop's frame of
reference: everything later is measured against it. **The base revision is pinned here** — the
rerun in Phase 7 uses this exact revision, not `HEAD`.

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
Budget: 1 initial intervention + at most 1 revised attempt + their reruns
  + 1 optional test-without rerun; wall-clock/token bound: <bound>
Stop conditions: bounded-authority breach | unclassified gap | missing tool access
  (tool-access-gate) | insufficient baseline evidence | budget exhausted
```

If the accepted outcome cannot be stated observably ("done correctly" is not checkable by
someone who did not run the job), stop: `Verdict: insufficient-evidence`, reason
`no-checkable-outcome`, and post the record. An unfalsifiable contract makes every later phase
unfalsifiable too.

## Phase 2 — Observe the baseline trajectory

Reconstruct what actually happened, from artifacts only — never from reconstruction-by-
plausibility. Sources, in priority order:

1. The run/session transcript.
2. The PR: diff, commits (especially late `fix:` / `revert:` follow-ups), review threads.
3. Tracker comments and status history.
4. The `git-history-analyzer` agent for the surrounding file evolution.
5. CI logs.

Per the `empirical-inquiry` rule, every claim about what the worker did or knew cites a concrete
artifact. Record which sources were reachable and which were not — an unreachable source is a
stated limit in the result record, never a silent gap.

## Phase 3 — Locate the earliest failed handoff

A **handoff** is any point where work, information, or authority moves: intake → plan,
plan → ticket, ticket → worker, worker → gate, gate → next worker, worker → human.

Walk the baseline forward and name the **first** handoff whose output was already wrong,
incomplete, or unusable — not the point where the failure became visible. Record: the handoff
(from → to), the artifact that crossed it, what was wrong with it, and the citation.

Downstream symptoms are explicitly noted as symptoms of this handoff, not as separate findings.
If two handoffs are genuinely tied, take the earlier one. If the earliest cannot be established
from artifacts, stop with `Verdict: insufficient-evidence` and post the record.

## Phase 4 — Classify the gap

Classify the earliest failed handoff into **exactly one** taxonomy gap, with cited evidence.

| Gap | Definition |
|---|---|
| `context` | The worker had the tools, ownership, and authority to do the step but lacked a fact it needed — a spec detail, convention, prior decision, or state of the world — at the moment it acted. |
| `capability` | The worker lacked a tool, command, skill, credential, or environment the step actually required, and proceeded degraded instead of stopping. |
| `domain-ownership` | The step crossed into a surface no configured worker owns, so the handoff had no responsible recipient and fell through. |
| `authority` | The worker knew what to do and could do it, but was not permitted to (gate, protected environment, approval boundary) and worked around the boundary instead of breaking out. |
| `proof` | The output was genuinely wrong and no gate, test, or check existed that would have observed that class of defect. |
| `feedback-delivery` | A signal that would have caught it did exist, but never reached the worker in a usable form or in time — buried in a log, emitted as a non-blocking warning, or produced after the decision was already made. |
| `worker-limitation` | The worker itself could not perform the step even with full context, tools, ownership, authority, proof, and feedback — the other six are affirmatively excluded. |

**The worker-limitation multi-failure guard (binding).** `worker-limitation` requires **≥2
comparable failed trajectories** — same job class, same handoff, same failed step, different
runs — each cited by ref, AND an explicit exclusion line for each of the other six gaps. A
single trajectory can **never** establish `worker-limitation`; this skill has exactly one
trajectory by construction, so reaching this classification requires citing prior recorded
trajectories. Find them by searching the originating repo/tracker for prior markers carrying the
same `job_class=<slug>` field (the marker, not prose — see "Idempotency"). When the second
comparable failure cannot be produced, classify as the best-supported of the other six, or
`unclassified`.

`unclassified` is a **surfaced terminal outcome**, never a silent default: the loop stops, posts
the result record with `Verdict: unclassified`, and no intervention is made. Guessing a gap to
avoid this outcome is forbidden.

**`lisa-attribute-failure` runs here.** Invoke it (Skill tool) on the failed handoff — `defect`,
`implicated_files`, `surface_in_play`, `failure_class` seeded from Phases 2–3 — to decide
whether the owning surface is **Lisa's** or the **project's**. That verdict does not choose the
taxonomy gap; it chooses the *owner* in Phase 5:

- `project` → the owner is a project surface; local intervention is in scope.
- `lisa` **and we are in a host project** → per the `upstream-to-lisa` rule the fix belongs
  upstream. Do not edit Lisa-managed surfaces from the host: **submit** the finding to
  `lisa-persist-learning` as a candidate whose evidence supports the `handoff-upstream`
  disposition — that skill's hostile-default judge decides the disposition and owns the filing,
  dedupe marker, per-run cap, and redaction; it is not caller-selectable, and it opens its own
  branch/PR distinct from `harness/<fingerprint>`. Terminate with
  `Verdict: bounded-authority-stop` and `Decision: n/a (routed upstream, <url>)`. If the judge
  drops the candidate, record that in `Known limits` — never report it as routed or owned. Any
  local stopgap is recorded as a stopgap, never as the intervention under test.
- `lisa` **and we are inside `CodySwannGT/lisa`** → the `upstream-to-lisa` rule does not apply;
  the owning surface is local (`plugins/src/...`) and the intervention proceeds normally.
- `ambiguous` → terminal-local; no upstream filing. Continue only if a project-owned surface can
  still be named; otherwise `unclassified`.

## Phase 5 — The smallest owning intervention (bounded authority)

**Authoritative owner by gap** — the intervention lands where the gap lives, never where the
symptom appeared:

| Gap | Authoritative owner |
|---|---|
| `context` | The knowledge surface that should have carried the fact — wiki page, ticket/PRD template, the relevant rule, or a candidate submitted to `lisa-persist-learning` |
| `capability` | Tool/credential provisioning (a `type:tooling` ticket) or the skill that should have wrapped the tool |
| `domain-ownership` | The worker roster / routing config that assigns the surface |
| `authority` | The gate or authority-envelope configuration that should have stopped the worker |
| `proof` | The missing gate, test, lint, or ast-grep control (see the `promotion-contract` rule when prose is being replaced by a control) |
| `feedback-delivery` | Where the signal is emitted, escalated, or blocked — severity, timing, or delivery surface |
| `worker-limitation` | No local intervention; upstream/roster decision only |

**Smallest owning change** = the minimal edit at that one owner that closes this gap and nothing
else. An intervention is **larger than the smallest owning change** — and therefore out of
authority — if any of these hold:

1. It touches more than one owning surface.
2. It changes a contract other workers depend on (a shared schema, a status/label vocabulary, a
   skill's input/output shape).
3. It requires a new tool, dependency, credential, or environment.
4. It changes product behavior, not harness behavior.
5. It falls outside the authority envelope recorded in the job contract.

**On any of those: file a proposed-intervention ticket via `lisa-tracker-write` and STOP.** The
ticket carries the job contract, the earliest failed handoff, the gap classification with
evidence, and the proposed change with its expected mechanism; labels `type:harness`,
`status:blocked` (human-flipped to `status:ready` when approved). Post the result record with
`Verdict: bounded-authority-stop`, `Decision: n/a (proposed-intervention, <url>)`, and
terminate. Implementing it anyway is the failure mode this phase exists to prevent.

Otherwise: make the change on a branch (`harness/<fingerprint>`), never a direct commit to the
default branch, and state the **expected mechanism** — the specific causal chain by which this
change makes the failed handoff succeed — *before* verifying. An intervention with no stated
mechanism cannot be relevance-gated in Phase 7.

A durable lesson produced along the way is **submitted** to `lisa-persist-learning` as a
candidate; its judge decides whether anything persists. This skill never writes the learnings
surface itself and never assumes the candidate was kept.

## Phase 6 — Two-layer verification

Both layers, in order, per the `verification` rule:

- **Layer 1 — native gates.** The project's own lint/typecheck/test/build for the changed
  surface, plus (in the Lisa repo) `bun run build:plugins` + `bun run check:plugins` when the
  surface is under `plugins/src/`. These are **quality checks, not verification** — the
  `verification` rule is explicit that a green suite is a prerequisite and never the proof.
- **Layer 2 — the operational journey.** Exercise the harness the way the factory does: run the
  representative job (or the smallest faithful slice of it) and observe the previously failing
  handoff now producing a usable output. Delegate to `lisa-verification-lifecycle` where the
  surface has one. Capture typed `[EVIDENCE: <artifact-type>: <name>]` artifacts from the
  `verification` rule's fixed taxonomy.

Layer 1 red → fix or revert; never proceed to Phase 7 on red gates.

**Layer 2 unrunnable caps the Decision at `revise`, whatever Phase 7 returns** — a rerun cannot
promote an unverified journey to `retain`. Record the cap and its reason in `Known limits`, and
never claim a journey that was not run.

For a `proof`-gap intervention, `lisa-codify-verification` applies: the new control is the
codification.

## Phase 7 — Fresh-session rerun + the relevance gate

1. **Isolated starting state.** `git worktree add` off the base revision pinned in Phase 1, with
   the intervention applied — and only the intervention. No investigator working-tree state
   leaks in. Remove the worktree in a `finally`-equivalent step.
2. **Fresh session.** Rerun in a session with no inherited context: a subagent where the runtime
   provides one, otherwise a headless CLI re-invocation of the same runtime. The rerun session
   receives the representative job and the worker config from the job contract — **not** the
   investigation, not the gap classification, not the intervention's existence. Telling it about
   the intervention contaminates the only evidence this phase produces.
3. **Same job class, same worker config.** Any deviation from the job contract is recorded as a
   limit.

**The relevance gate (binding).** A rerun credits the intervention **only** if the rerun
transcript shows the intervention was **retrieved or invoked** — the changed file was read, the
skill was called, the gate fired, the new message was surfaced, the added test ran. Positive
evidence is required; absence of evidence is not evidence. The gate applies to every rerun
outcome, not only the successful ones.

- Rerun **succeeded** and the intervention **was** retrieved/invoked →
  `Verdict: intervention-supported`.
- Rerun **succeeded** and the intervention was **not** retrieved/invoked →
  `Verdict: no-evidence-for-intervention`. **Never `retain`.** The success is attributed to
  run-to-run variance until proven otherwise, and the honest next action is
  `Decision: test-without` — rerun with the intervention deliberately withheld to see whether
  the local evidence already suffices.
- Rerun **failed at the same handoff** → the intervention did not close the gap →
  `Verdict: intervention-refuted`, `Decision: remove` (or `revise` when the mechanism was right
  and the surface was wrong).
- Rerun **failed at a later handoff, with the relevance gate satisfied** → this gap closed and a
  new one exists → `Verdict: intervention-supported`, `Decision: retain` for this gap, and the
  new handoff is a *separate* trajectory: file it, do not chain a second loop inside this one.
  Without the relevance gate, this case is `no-evidence-for-intervention` like any other.

## Phase 8 — Decision, result record, learnings

Two fields, deliberately separate:

- `Verdict` (evidence status): `intervention-supported` | `intervention-refuted` |
  `no-evidence-for-intervention` | `insufficient-evidence` | `unclassified` |
  `bounded-authority-stop` | `headless-proposal-only`
- `Decision` (action): `retain` | `revise` | `remove` | `test-without`. A completed loop always
  carries exactly one. Early terminations (`insufficient-evidence`, `unclassified`,
  `bounded-authority-stop`, `headless-proposal-only`) carry `Decision: n/a (<reason>, <url>)`,
  because the loop did not complete.

| Verdict | Rerun outcome | Decision |
|---|---|---|
| `intervention-supported` | succeeded, intervention invoked | `retain` — merge the branch through `lisa-git-submit-pr` |
| `intervention-supported` | failed at a later handoff (this gap closed) — relevance gate satisfied | `retain` (this gap) + file the new trajectory |
| `no-evidence-for-intervention` | succeeded, intervention never invoked | `test-without` |
| `intervention-refuted` | failed at the same handoff, mechanism wrong | `remove` — revert the branch |
| `intervention-refuted` | failed at the same handoff, mechanism right / surface wrong | `revise` — one revised attempt inside budget, else file a proposed-intervention ticket |

A Layer-2 journey that could not be run caps any of the above at `revise`.

### `test-without` is deferred, not done

`test-without` leaves the loop **explicitly unfinished**: the branch stays unmerged, no PR is
opened, and nothing is claimed for the intervention. The follow-up is a re-invocation of this
skill on the same trajectory that posts under `key=<fingerprint>-r<N>` and runs the rerun with
the intervention deliberately **withheld**. Map its outcome:

| Withheld rerun | Reading | Decision |
|---|---|---|
| Fails the same way | The intervention was never what mattered — the original success was variance | `remove` |
| Succeeds without the intervention | The pre-existing state already sufficed | `remove` |
| Fails without it, where the earlier run with it succeeded | The intervention plausibly mattered after all | `retain` |

Until that follow-up runs, the trajectory's `What happens next` line says so explicitly.

### The result record

Post it to the originating item, with its marker:

```text
<!-- [lisa-improve-harness] key=<fingerprint> job_class=<slug> -->
[lisa-improve-harness] Result record (job class: <job_class>)

Target: <repo / harness surface under improvement>
Worker config: <agent type / model / runtime / skill+plugin set that ran the job>
Accepted outcome: <what "done correctly" meant for this job, verbatim from the job contract>
Gap: <gap> — <one plain-language sentence a non-technical operator can read>
Baseline evidence: <2-4 lines, each citing a concrete artifact (transcript line, commit sha, PR review, log)>
Earliest failed handoff: <from> -> <to>; artifact <what crossed>; wrong because <...>
Owner: <authoritative owner surface, path or name> (attribution: <lisa | project | ambiguous>)
Intervention: <the smallest owning change, with path> | none (<reason>)
Expected mechanism: <the causal chain by which this change makes the handoff succeed>
Change: <PR url | branch harness/<fingerprint> (unmerged) | none>
Verification:
  - native gates: <commands run + result>
  - operational journey: <what was run, what was observed, evidence artifacts>
Fresh rerun: worktree @ <base sha>, fresh session, same worker config
  - outcome: <succeeded | failed at same handoff | failed at later handoff | not run (<why>)>
  - relevance gate: <retrieved/invoked — cited proof> | <not retrieved/invoked>
Verdict: <intervention-supported | intervention-refuted | no-evidence-for-intervention | insufficient-evidence | unclassified | bounded-authority-stop | headless-proposal-only>
Decision: <retain | revise | remove | test-without> — <inline plain gloss> | n/a (<reason>, <url>)
What this means: <one plain sentence, no taxonomy terms>
What happens next: <concrete action + WHO (agent | human), or "nothing — closed">
Recorded owner: <who/what surface now owns this behavior>
Known limits: <what this record does NOT establish — always non-empty. This does not mean the
  factory is fixed — one run, one job, one step.>
```

The `Decision` gloss is written for someone who has never read this skill, e.g.
`test-without — not yet convinced the fix is what helped; re-run once without it to check`,
`retain — the fix was used and the step worked; keeping it`,
`remove — the fix did not help; taking it back out`,
`revise — the idea looks right but this version did not work; one more attempt`.

Any durable lesson the loop produced is **submitted** to `lisa-persist-learning` (the ledger's
only write path per the `project-learnings` rule) as a candidate; its hostile-default judge — not
this skill, and not the caller — decides the disposition. A dropped candidate is recorded in
`Known limits`, never reported as routed or owned. This skill never writes the learnings file,
`PROJECT_RULES.md`, or `CLAUDE.md` itself, and never promotes a learning to a higher rung (that
is the gardener's ticket-gated job).

## Idempotency

The fingerprint is keyed to the **trajectory alone**, deliberately independent of the work item,
so it stays stable when this skill has to file the originating item itself:

```text
fingerprint = "ih1-" + first 12 hex chars of sha1(normalized_trajectory_ref)
normalized_trajectory_ref = lowercased, whitespace runs collapsed to single spaces, trimmed
trajectory_ref = the failing run identifier (PR url/number, CI run URL, session/transcript id);
                 when none exists, the normalized `observed_failure` text
```

```bash
NORM_TRAJ=$(printf '%s' "$TRAJ_REF" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ *//; s/ *$//')
FP="ih1-$(printf '%s' "$NORM_TRAJ" | { shasum -a 1 2>/dev/null || sha1sum; } | cut -c1-12)"
```

Marker discipline follows `lisa-persist-learning`: match on the **marker, never the title or
text**; **exactly one marker per body**; **never write a markerless body**.

**Dedupe before write** (Phase 0, and again immediately before posting):

1. **With an originating item**: read its comments and grep for the marker
   (`gh issue view <n> --json comments --jq '.comments[].body'`, or the vendor comment read).
2. **Without one**: search the tracker before filing anything —
   `gh issue list --state all --search '"[lisa-improve-harness] key=<fingerprint>" in:body' --json number,state,url`
   (all states: a closed marker-bearing item still owns this trajectory). Adopt any match as the
   originating item.
3. **Stale-index guard**: when the search returns nothing, also enumerate bodies directly
   (`gh issue list --state all --json number,body`, plus the comment read above) and grep for
   the marker before concluding no record exists.
4. **Anchor the match** on the literal `key=<fingerprint> ` — including the trailing space
   before `job_class=` — so a follow-up `key=<fingerprint>-r1` never matches the base
   fingerprint. When several records match a trajectory, the highest `-rN` is the current one.
5. Match found and its `Decision` is not `test-without` → report `already-improved` and stop;
   make no mutation.
6. Match found and its `Decision` **is** `test-without` → a follow-up run is the recorded next
   action: post under `key=<fingerprint>-r<N>`, where `N` = 1 + the count of existing markers
   with the `<fingerprint>-r` prefix.
7. Branch and worktree names reuse the same key — `harness/<fingerprint>` for the first run and
   `harness/<fingerprint>-r<N>` for follow-ups — so a re-entrant run collides with its own
   artifacts instead of forking new ones.
8. Prefer markers in comments authored by the running identity; a marker from another identity
   is still honored (safety over noise) but the record notes it was foreign.

## Headless-safe mode

Trigger, mechanically: `mode=headless` was passed explicitly, or the invocation context carries
an explicit automation marker (a cron/routine invocation, an intake or CI dispatch). Everything
else — including any human- or session-initiated run inside an agent harness — is
**interactive**. Terminal detection is not a trigger: agent harnesses routinely run without a
TTY, so a TTY test would make interactive mode unreachable.

In headless mode:

- **No mutation of the working tree, any managed surface, or the default branch.** Phase 5 does
  not edit, branch, or commit; it *drafts* the smallest owning change and files it as a
  proposed-intervention ticket via `lisa-tracker-write` (`type:harness`, `status:blocked`), with
  the drafted diff sketch, the expected mechanism, and the verification plan.
- Phases 6 and 7 do not run (there is nothing applied to verify); the result record carries
  `Verdict: headless-proposal-only`, `Decision: n/a (proposed-intervention, <url>)`, and a
  `Known limits` line saying no rerun evidence exists. This verdict is deliberately distinct
  from `bounded-authority-stop`, so an operator can tell "the fix was too big to make" from
  "the automation never touches anything".
- **The only writes are the result record and the proposed-intervention ticket(s).** Anything
  further requires a human flipping that ticket to `status:ready`, after which the normal
  factory (or an interactive invocation) implements it.
- Never a prompt, never a question, never a blocked wait — anywhere in this skill, in either
  mode.

Interactive mutation still never touches the default branch directly — it lands on
`harness/<fingerprint>` and ships through `lisa-git-submit-pr`.

## Bounded-claim discipline

The result record **may** claim:

- What this one trajectory did, with cited artifacts.
- Which handoff failed earliest in it, and which single gap the evidence supports.
- That the intervention was, or was not, retrieved/invoked in one fresh rerun of one job.
- That one rerun of this job class, at this revision, with this worker config, succeeded or
  failed.

The result record **may not** claim:

- **`worker-limitation` from one trajectory.** One failure never establishes it — the
  multi-failure guard is not a formality.
- **That the intervention caused a rerun success it was never retrieved for.** No-retrieval
  success is `no-evidence-for-intervention`, full stop.
- **Any comparative or longitudinal claim** — "better than", "improved the harness", "reduced
  failures by", "the model is worse at X", pass-rate or eval framing. Those need a population
  and a control; this loop has one trajectory.
- **Generalization to other job classes, workers, repos, or revisions** than the ones pinned in
  the job contract.
- **That a green Layer-1 gate proves anything about behavior** — quality checks are not
  verification (`verification` rule).

`Known limits` is a **required, never-empty** field. A record with nothing in it is invalid on
its face, because a single-trajectory loop always has limits.

## Overlap boundaries

- **vs `lisa-attribute-failure`** — that skill answers one narrow question about a single event
  (is this Lisa's fault or the project's) and is read-only; this skill **calls it** during
  Phase 4 to pick the authoritative owner, and owns everything before and after it.
- **vs `lisa-rework-triage`** — that skill fires only on confirmed QA/staging bounces and
  classifies the *previous agent attempt* into its six causes; this one is the generic
  single-trajectory loop that runs on any failed or expensive run, bounce or not, and actually
  makes and tests an intervention.
- **vs `lisa-debrief`** — that mines a whole shipped initiative across many tickets and PRs for
  candidate learnings; this investigates exactly one trajectory in depth and proves a fix.
- **vs `lisa-persist-learning`** — that is the ledger's judged write path; this skill never
  writes the learnings surface itself and submits every durable lesson (and every
  Lisa-attributed upstream candidate) **to** it for judgment.
- **vs the gardener (`lisa-learnings-audit`)** — that is the periodic, ticket-gated
  promotion/demotion/retirement pass over accumulated knowledge; out of scope here, and this
  skill never promotes a learning to a higher rung.

## Rules

- **Headless-safe.** No interactive prompts anywhere, in either mode. Under an automation the
  skill proposes and reports; it does not mutate the working tree, a managed surface, or the
  default branch.
- **Never block.** A failed investigation, unreachable evidence, missing tooling, or an
  unrunnable rerun degrades to a stated verdict with the gap named — it never raises an error
  that stops the caller's build, intake, or verification flow.
- **Always leave a record.** Every terminal state posts a result record to the originating item
  before stopping; there is no silent exit.
- **Evidence-cited.** Every claim about the baseline, the handoff, the gap, and the rerun names
  a concrete artifact. An uncited classification is `unclassified`; an uncited rerun is
  `not run`.
- **Idempotent per trajectory.** Same trajectory in → same fingerprint → no duplicate record, no
  duplicate ticket, no duplicate branch. Dedupe before every write.
- **Bounded authority.** Direct change only at the single authoritative owner, only within the
  recorded authority envelope, only on a branch, only through a PR. Anything larger is a
  proposed-intervention ticket and a full stop.
- **Bounded claims.** One trajectory supports one trajectory's claim. No comparative,
  longitudinal, or population claims; `Known limits` is never empty.
- **One write path for learnings.** Durable lessons are submitted to `lisa-persist-learning` for
  judgment; this skill never edits the learnings ledger, `PROJECT_RULES.md`, or a rules tree,
  and never promotes a learning to a higher rung.

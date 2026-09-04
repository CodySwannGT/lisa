# Rejection Detection at Claim Time (load-bearing)

A QA rejection — an item that reached a `review`/`done`-ward state and is now back in the build-ready lane — is a **teaching signal**, not fresh work. Detect it at claim time so the re-claim can reflect on the rejection instead of repeating it.

**One vendor-neutral contract, cited by every build-intake arm** (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never three divergent implementations).

## When it runs

At the **top of build-intake step 3b (Claim), BEFORE the relabel** `$READY → $CLAIMED`. After the relabel the current-lane signal is gone, so detection must read history first. Detection is a pure read — idempotent, headless-safe, no side effects.

## Classify the claimed item

Return exactly one of:

- **`rejection-reclaim`** — history shows the item reached a `review`/`done`-ward lane and is now back in `$READY`.
- **`forward-only`** — history shows only forward moves (never returned to `$READY` from a later lane).
- **`never-left-ready`** — history shows the item never left `$READY`.
- **`unknown`** — the vendor history query failed, was inconclusive, or is absent.

## Vendor history sources (through the access layers only — `integration-access-layer`)

- **GitHub** — `LABELED` / `UNLABELED` timeline events on the configured **ready** label (the Label-Event History surface from `lisa-github-read-issue`).
- **JIRA** — the `changelog` operation on `lisa-atlassian-access` (`?expand=changelog`, status items).
- **Linear** — the `history` operation on `lisa-linear-access`, keyed on **workflow-state** history (`fromState.name` / `toState.name`, inlined on each node — no label-ID resolution needed).

**Lane names ALWAYS come from `.lisa.config.json` lanes** (`github.labels.build.{ready,claimed,done}` for GitHub, `jira.workflow.*` and `linear.workflow.*` for the status/state trackers; `src/sync/registry.ts` `BUILD_LABEL_DEFAULTS` and `LINEAR_WORKFLOW_DEFAULTS`). **Never hardcode** `status:ready`, `Ready`, `Todo`, etc.

## Never block the build

`unknown` is a first-class result, not an error. A failing/absent history yields `unknown` and **the build proceeds** to implement the item. Detection never stops a claim.

## Learning-loop exclusion (no learning about learning)

An artifact this flow produced is **never** a rejection-reflection trigger, no matter how it moves. Before classifying as `rejection-reclaim`, exclude items carrying any learning marker — `[lisa-learning-drop]`, `[lisa-learning-pr]`, `[lisa-learning-upstream-handoff]` — or the `learning:needs-triage` label. Such items short-circuit to `forward-only` (treated as normal work) so the detector never fires on the flow's own learning PRs/issues.

## Reflect on a `rejection-reclaim`

On `rejection-reclaim` only, before re-implementing: read the rejection evidence (comments after the backward transition, review threads on the rejected PR) through the access layers, assemble **one** candidate learning with the rejection linked as provenance, and route it to the `lisa-persist-learning` skill. If that skill is absent, record the candidate as a comment that carries a **visible prose line** plus the marker (a bare marker renders as an empty comment bubble) — `Recorded a candidate learning from this rejection (queued for the judgment gate): <one-line candidate rule>.` followed by `<!-- [lisa-rejection-candidate] key=<issue>-<transition-ts> -->` — and proceed. **Marker-dedupe** on `<issue>-<backward-transition-timestamp>`: re-claiming twice produces no duplicate. Unreadable/absent evidence → proceed without a candidate, never block.

## Proposal rejection memory (proposal-side — orthogonal to the reclaim path above)

A **loop-proposed** item that a human **closed as _not planned_** is a durable decline. Every *proposing* loop (`lisa-exploratory-qa`, `lisa-project-ideation`, `lisa-monitor`, `lisa-repair-intake`; `lisa-learnings-audit` is the shipped precedent) MUST consult it **before filing a candidate**. This is orthogonal to the `rejection-reclaim` path above — that classification and its reflection are untouched. The memory lives in the **tracker, not a new state file**.

- **Signal:** the prior item is closed *not planned* (GitHub `stateReason == "not_planned"`; the JIRA/Linear equivalent resolved via `config-resolution` — never hardcode). The GitHub compare is **case-insensitive** — raw `gh --json stateReason` returns `NOT_PLANNED` UPPERCASE, so normalize to lowercase (or read via `lisa-github-read-issue`) before comparing, never string-match raw `gh` JSON. Closed as **completed** is NOT a decline — a recurrence after a completed fix is a regression and may file.
- **Marker:** `<!-- [<loop-marker>] key=<candidate-key> -->`, key computed deterministically `printf '%s' "$normalized" | shasum -a 256 | cut -c1-12`. Search **open AND closed** items for the marker before filing (body-enumeration fallback on search-index lag); **match on the marker, never the title.**
- **Rule:** a hit on a closed-**not-planned** item **suppresses** the proposal. Re-file **only** with evidence postdating the decline, carrying BOTH the machine token (`declined <date>; recurred <date> in <ref>`) and a human acknowledgment sentence (`You declined this on <date>. It has recurred (<date>, <ref>), so we're raising it once more for your review.`).
- **Operator footer:** every loop-filed proposal ticket MUST carry, as visible prose, `To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.` — so the operator knows which close-reason produces which outcome.
- **Outcomes:** an all-suppressed cycle ends `nothing-needed` naming the **suppression count**; a memory check that cannot read the tracker ends `recovery-required`, never a silent `nothing-needed` (e.g. `Tracker unreachable during the decline check — restore credentials; nothing was filed this run.`).
- **Concurrency:** search-then-write = convergence, not mutual exclusion — a transient duplicate is closed by the next run; no cross-run lock.

## Automation-reversal memory (repair-side — orthogonal to both halves above)

A human who **undoes a lifecycle transition this flow made** is correcting the flow, not supplying new state. Every loop that writes a lifecycle role as a **repair** (`lisa-repair-intake`) consults this before re-making a transition. It is a third classification, never merged into `rejection-reclaim`: that one is anchored on the ready lane and answers a rejection with re-implementation; this one lands in `$BLOCKED` and answers a correction by withdrawing a decision.

- **Seam:** top of the repair walk for each item, **before any lifecycle write** — after the write the current-lane signal is gone.
- **Classify:** `automation-reversal` — a role change **authored by** this flow, then a later **backward** move of that role **authored by** a human, with no automation move after it. Otherwise `no-reversal`. Authorship unavailable or history unreadable → `unknown`.
- **Authorship is the signal, not the backward move.** An item can return to `$BLOCKED` because a real new blocker appeared — that is the world moving on. Read the `actor` (GitHub timeline, Linear history) or `author` (JIRA changelog) through the access layers; an unexposed actor is `unknown`, never an assumed human. **A marker and a transition on the same item say nothing until you know their order** — compare timestamps, and treat an unorderable pair as `unknown`.
- **Lanes from config** (`github.labels.build.blocked` + the JIRA/Linear equivalents, `config-resolution`) — never hardcode.
- **Degrade:** `unknown` is **neither a reversal nor a clearance** — the item is judged by the loop's normal rules and detection **never blocks the sweep**. The learning-loop exclusion above applies unchanged.
- **Rule:** on `automation-reversal`, do not re-apply the reversed classification; leave the item where the human put it, ensure `human_needed`, and **name the reversed transition in the run record**. Re-attempt **only** on evidence that **postdates the reversal**, cited in the run record — mirroring the re-proposal rule the proposal half enforces.
- **A changed lifecycle role is no longer a sufficient warrant on its own.** A consuming loop's recurrence brake must carry **authorship and an overturn bit**, not state alone.
- **Signed per path.** Apply the inversion only where the loop decides whether to re-make a transition. A staleness/keep-alive path where a human comment already *suppresses* action is protective — leave it. One global sign reads as tightening and removes that protection.

Full contract (classification table, per-vendor bindings, reflection & evidence handoff, Proposal rejection memory, Automation-reversal memory): [reference/rejection-detection.md](../reference/rejection-detection.md).

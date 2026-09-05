# Claim-Time Guards

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Claim-Time Guards (load-bearing)

Two guards that run when build-intake claims a ready item, both from failures observed in the fleet: an item built twice because it had already shipped, and a loop burning cycles re-attempting an item that was never going to succeed.

**One vendor-neutral contract, cited by every build-intake arm** (the `leaf-only-lifecycle` / `repo-scope-split` / `rejection-detection` / `claim-archaeology` precedent: one shared slug, never three divergent implementations).

## When they run

Inside build-intake step `3b`, after `rejection-detection` and `claim-archaeology`, still before the `$READY → $CLAIMED` transition. The `two-failed-attempts` valve runs first — it is cheaper and it is the only pass that can stop the claim outright.

## `already-implemented` → `verify-and-close`

A ready item may already be implemented, because agents ship without transitioning. Before implementing, probe for the item's **own** key:

```bash
git log --all --grep "<key>" --format='%H %aI %s' -n 10
gh pr list --repo <org>/<repo> --state all --search "<key>" --json number,state,mergedAt,url
```

On a hit, do not build it twice — switch `3c` to **verify-and-close**: verify what shipped against this item's acceptance criteria, post evidence naming the shipping PR/commit, then run the ordinary `3d` transition and rollup. If the shipped change only partially satisfies the criteria, implement the remaining gap instead of closing.

Distinct from `claim-archaeology` (finds a **different** ancestor issue) and from `DUPLICATE_ALREADY_FIXED` (a **different** canonical issue). Unreadable history degrades to "no hit"; the guard never blocks the claim.

## `two-failed-attempts` → blocked

Every non-success terminal outcome records a durable marker on the item — a visible line plus `<!-- [lisa-build-attempt] n=<N> outcome=<outcome> measures=<work|machine> -->` (match on the marker, never the title). A cron holds no memory between cycles, so the item carries the count.

**Two filters before counting.** Count a marker only when it is `measures=work` — a run terminated by a signal, or whose outcome was `recovery-required`, measures the box and not the item — and only when it was recorded **after the item most recently entered the ready lane**. An unlabelled marker counts as `work`; an unreadable lane history falls back to counting every `work` marker. Both defaults keep the valve shut rather than open (CodySwannGT/lisa#3854).

With **two or more** surviving markers at claim time: do not claim. Move the item to the configured `blocked` role (resolved per `config-resolution`, never hardcoded), post an operator-readable comment naming both attempts and what a human must decide or supply, and **stop the loop** for this cycle. Recovery is deliberate and it works — a human or a `lisa-repair-intake` cycle with the blocker provably cleared returns it to the queue, which ends the period the old markers describe without deleting them.

---

Two guards that run when build-intake claims a ready item. Both come from acmeorgb's hand-rolled `sprint-loop` and both address failures actually observed there — an item built twice because it had already shipped, and a loop burning cycles re-attempting an item that was never going to succeed.

It is a **single vendor-neutral contract** consumed by all three build-intake skills (`lisa-github-build-intake`, `lisa-jira-build-intake`, `lisa-linear-build-intake`). Each arm cites this slug in its claim step rather than growing its own copy, exactly as the arms cite `leaf-only-lifecycle`, `repo-scope-split`, `rejection-detection`, and `claim-archaeology`. One slug is what keeps a guard that fires on GitHub from being absent on Linear.

## Sequencing

The shared claim phase is `3a.0` repo-scope gate → `3a` leaf-only claim gate → `3b` Claim → `3c` run lifecycle → `3d` transition to done. Inside `3b`, the pre-transition window now runs four passes in a fixed order:

1. **`rejection-detection`** — needs the current-lane signal the relabel destroys.
2. **`claim-archaeology`** — consumes the rejection classification.
3. **`two-failed-attempts` valve** (this rule) — may end the cycle before any claim happens.
4. **`already-implemented` check** (this rule) — decides whether `3c` implements or verifies.

The valve runs before the already-implemented probe because it is cheaper and it is the only one of the four that can stop the claim outright: there is no point spending git and PR queries on an item that is about to be blocked.

## Guard 1 — already-implemented → verify-and-close

**Why it exists.** A ready item may already be implemented. Agents ship without transitioning: the PR merges, the work is done, and the item sits in the ready lane looking untouched. Claiming it normally means building the same change a second time — at best a no-op PR, at worst a conflicting reimplementation of work that already landed.

**The probe.** Two deterministic searches for the item's **own** canonical key (the ref carried by the `Work-Item:` trailer), bounded and never interactive:

```bash
# Commits anywhere in history — branches and merged work included — that carry the key.
git log --all --grep "<key>" --format='%H %aI %s' -n 10

# Open and merged PRs referencing the key (GitHub shown; JIRA and Linear use the
# equivalent search through their access layers, never a direct vendor API call).
gh pr list --repo <org>/<repo> --state all --search "<key>" --json number,state,mergedAt,url
```

A hit counts only when it names **this** key. Branch-name coincidence, a similar title, or a reference from an unrelated item is not a hit — that is `claim-archaeology`'s job, not this one.

**The outcome.** On a hit, do not implement. Switch `3c` to **verify-and-close**:

1. Read the referenced commits/PR and establish what actually shipped.
2. Verify the shipped change against this item's acceptance criteria — the ordinary verification path, not a fresh build.
3. On a pass: post evidence naming the shipping PR/commit, then run the normal `3d` transition (which still gates on the PR being merged) and the `3d.1` rollup.
4. On a fail — the shipped change does not satisfy the criteria — record that the item is only **partially** implemented, and proceed with the ordinary implement path for the remaining gap. A partial hit must never close an item whose criteria are unmet.

**What this is not.** Three nearby behaviors it must not be conflated with:

- **`claim-archaeology`** answers "is this item round 2 of a *different* past failure?" — it looks for an **ancestor** issue. This guard looks for **this same item** already having shipped. Different question, different key, different outcome.
- **`DUPLICATE_ALREADY_FIXED`** (from `lisa-ticket-triage`) is about a **different canonical issue** whose fix covers this one; it closes as a duplicate. This guard finds work done **under this item's own key** and closes it as completed, not as a duplicate.
- **Rejection reclaim** is about work that shipped and was pushed back. Verify-and-close applies to work that shipped and nobody noticed.

**Never block.** An unreadable history, an absent `gh`, or a failed search degrades to "no hit" and the ordinary implement path proceeds. A speculative probe must never strand a ready item.

## Guard 2 — two-failed-attempts → blocked

**Why it exists.** Without a valve, a scheduled loop re-claims the same failing item every cycle forever. Each attempt costs a full build flow, and the third attempt is not more likely to succeed than the second — what changed between them was nothing.

**The counter.** Attempts are counted from durable markers on the item itself, not from session memory (a cron process holds no state between cycles). On every **non-success terminal outcome** for a claimed item — errored, blocked by a gate, PR abandoned unmerged — the intake arm records a visible comment plus a marker:

```text
Build attempt <N> did not complete: <one-line operator-readable reason>.
<!-- [lisa-build-attempt] n=<N> outcome=<outcome> measures=<work|machine> -->
```

The marker line is verbatim. Match on the **marker, never the title**. A successful build records no marker, so an item that shipped after one bad attempt starts clean if it is ever re-filed.

**`measures=` says what the attempt is evidence about, and only `work` is counted.**

- `measures=work` — the build ran and did not satisfy the item. That is evidence about *this item*: the code, the criteria, the spec.
- `measures=machine` — the run was terminated rather than answered, or the loop could not complete for a reason outside the item: a gate killed under load, a substrate or access failure, an out-of-memory reap. That is evidence about *the box*, and the item is a bystander.

A run whose exit code is one of the terminating signals — the set `gate-failure-diagnosis` already names as *"the ones that actually terminate a gate on this fleet: an operator's Ctrl-C, an out-of-memory reap, a CPU-time limit, and the SIGTERM a saturated box hands out"* — is `measures=machine`. So is any run whose own outcome is `recovery-required`, which the automation runbook contract already defines as *"the loop itself could not complete (access, tooling, or substrate broken)"*. Both discriminators are shipped and already correct; this field is what carries their answer to the counter.

**Why this is not optional.** A pre-push gate killed by machine contention is errored, gate-blocked, and unmerged all at once — three non-success outcomes from one event that proved nothing about the work. Counting it retires items during exactly the busy periods when nobody is watching, and the item's own history then testifies that it failed twice, which is true and completely misleading.

**Both fields must be written even when the answer is obvious.** A marker with no `measures=` is counted as `work` — the conservative reading, because an unlabelled attempt is more likely an old marker than a machine failure, and a valve that fails open is the infinite re-claim loop this guard exists to prevent.

**The count is scoped to the current ready-lane period.** Count only markers recorded **after the item most recently entered the ready lane**. Markers older than that describe a period a human has already responded to; they stay on the item as history and stop being evidence about the attempt in front of you.

The lane history is already available on every tracker, and for a near-identical purpose — rejection detection reads it to spot an item that reached review and came back:

- **GitHub** — the `LabeledEvent` / `UnlabeledEvent` stream is already in the read bundle. No extra call.
- **JIRA** — `lisa-atlassian-access operation: changelog key:<K>`. `read-ticket` uses `fields=*all`, which does **not** include it; the expansion must be requested explicitly.
- **Linear** — `lisa-linear-access operation: history id:<ID>`.

**If the lane history cannot be read, count every `measures=work` marker regardless of age** and say so in the comment. Degrading to the unscoped count keeps the valve intact; degrading to "count nothing" would reopen the infinite re-claim loop. A history read failure must never *strand* an item either — it narrows recovery, it does not block the claim outright.

**The threshold is two.** At the top of the claim, count the markers that survive both filters. With **two or more**, do not claim:

1. Move the item to the configured `blocked` role (`build.blocked` / `workflow.blocked`, resolved per `config-resolution` — never a hardcoded lane).
2. Post an operator-readable comment naming both prior attempts, what each one hit, and what a human would need to decide or supply. Written for a non-technical operator, per `report-actionability`.
3. **Stop the loop** — end the cycle without claiming anything else. Stopping is the point: the next scheduled invocation should not immediately pick up the next item as though nothing happened.

**Recovery is deliberate, and it works.** A blocked item returns to the queue only when a human (or `lisa-repair-intake`, once the named blocker is provably cleared) moves it back. The attempt markers stay on the item as permanent history — nothing deletes them, and comments could not be deleted even if something wanted to. What the return *does* is end the period those markers describe: the next claim counts from the new ready-lane entry, so an item that was fixed and requeued is claimable, while an item that keeps failing accumulates fresh markers inside the new period and is stopped again by the same valve.

Re-entering the ready lane is therefore the discharge, and it is deliberate by construction — a person or a repair cycle has to do it. That is not a silent reset: nothing resets, the window moves.

**This paragraph used to describe behaviour the code did not have** (CodySwannGT/lisa#3854). The count was unscoped and taken fresh at every claim, so an item with two markers was refused on re-entry — the recovery this section documents could not run, and a human fixing the real cause and requeueing would watch the loop re-block it every cycle, forever. **The prose was doing the opposite of its job**: an auditor reading a section headed "Recovery is deliberate" sees a control that is covered and stops checking, so the documentation is what prevented anyone from noticing. Keep this note. A recovery path that is described but inert is worse than one that is absent, because an absent path invites the question "so how does this ever end?" and a documented one answers it wrongly.

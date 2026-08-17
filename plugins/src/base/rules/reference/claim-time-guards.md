# Claim-Time Guards

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
<!-- [lisa-build-attempt] n=<N> outcome=<outcome> -->
```

The marker line is verbatim; the count is the number of `[lisa-build-attempt]` markers on the item. Match on the **marker, never the title**. A successful build records no marker, so an item that shipped after one bad attempt starts clean if it is ever re-filed.

**The threshold is two.** At the top of the claim, count existing markers. With **two or more**, do not claim:

1. Move the item to the configured `blocked` role (`build.blocked` / `workflow.blocked`, resolved per `config-resolution` — never a hardcoded lane).
2. Post an operator-readable comment naming both prior attempts, what each one hit, and what a human would need to decide or supply. Written for a non-technical operator, per `report-actionability`.
3. **Stop the loop** — end the cycle without claiming anything else. Stopping is the point: the next scheduled invocation should not immediately pick up the next item as though nothing happened.

**Recovery is deliberate.** A blocked item returns to the queue only when a human (or `lisa-repair-intake`, once the named blocker is provably cleared) moves it back. The attempt markers stay on the item as history; re-entering the ready lane after a real fix is a fresh claim whose markers describe why it was hard, not a silent reset of the counter.

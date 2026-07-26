# Accountability

<!-- lisa-accountability:v1 -->

This is Lisa's own filled-in copy of the register it ships blank to every project
it governs (`all/create-only/.lisa/ACCOUNTABILITY.md`) — the proof that the
pattern survives contact with a real repository, and the same reason Lisa keeps
its own `DEPENDENCY_DECISIONS.md`.

It records **who answers for autonomous work here**, and **who may decide not to
fix something**. Attribution and accountability are different: the machinery
already records which agent acted, and this records which person answers when
that agent got it wrong.

## Status: partially filled, deliberately

**This file was created by an agent, and an agent must not assign accountability.**
Assigning it is a decision a person makes about people; a record an agent wrote
about who is answerable is not a record of anything.

So the rows below carry only what the repository itself evidences, and every
judgement a person owes is listed under **Known gaps** rather than guessed at. An
unfilled row here is more useful than a plausible name — under the specification
this register serves, unknown is never reported as conforming.

## Accountable parties

| Scope | Accountable | Deputy | Reviewed |
| --- | --- | --- | --- |
| This repository as a whole | GitHub repository owner: `CodySwannGT` — *evidenced, not assigned; confirm this is the intended accountable party* | — **gap** | not yet |
| Production deployment | — **gap** | — **gap** | not yet |
| Scheduled automations | n/a — no registered scheduled loop in this repository at time of writing | — | — |
| Duties that stay human | — **gap**, see below | — **gap** | not yet |

## Standing to accept risk

| Who | May accept | Scope limit | Reviewed |
| --- | --- | --- | --- |
| Repository owner | Observed to have exercised this for dependency advisories — *see the log; formal scope not yet declared* | — **gap** | not yet |

### Acceptance log

| Date | What was accepted | Accepted by | Reason | Expires | Status |
| --- | --- | --- | --- | --- | --- |
| 2026-07-26 | `GHSA-mh99-v99m-4gvg` (brace-expansion) and `GHSA-r28c-9q8g-f849` (postcss) added to `audit.ignore.local.json` | Repository owner, in session | Believed unfixable — **the belief was wrong** | n/a | **Withdrawn.** Both advisories had published fixes (`5.0.8`, `8.5.18`); `main` already carried the bumps and the entries were never needed. Recorded because a withdrawn acceptance is part of the history, not something to delete |

That single entry is the argument for keeping this log. The acceptance was made in
good faith on a claim an agent asserted without checking — that no patched version
existed — and nothing in the repository would have surfaced it later. A log makes
a bad acceptance findable; an ignore file with a comment does not.

## Known gaps

Each needs a person, not an agent, to decide:

1. **Confirm the accountable party for the repository.** The owner is recorded
   above because GitHub says so, which evidences who *administers* it, not who has
   agreed to answer for its autonomous output.
2. **Name a deputy for every scope.** Accountability with no backup is vacant the
   first time somebody is unavailable.
3. **Name the accountable party for production deployment**, which is the scope
   where being unreachable costs the most.
4. **Declare the scope limits on standing to accept risk** — which classes of
   decision, up to what severity, and whether any require a second party.
5. **Enumerate the duties that deliberately stay human here** and name a holder
   and backup for each, with the response time each is expected to meet.
6. **Set a review cadence** for this file, so a name that has gone stale is caught
   by the calendar rather than by an incident.

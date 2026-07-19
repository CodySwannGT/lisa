# Rejection Detection at Claim Time

When QA rejects an item, it moves the item **backward** — from a `review`/`done`-ward lane back to the build-ready lane — usually with a comment naming the defect. Today the re-claiming agent treats that bounced item as fresh work and repeats the rejected approach. This rule turns the backward move into a detectable, teachable signal.

It is a **single vendor-neutral contract** consumed by all three build-intake skills (`lisa-jira-build-intake`, `lisa-github-build-intake`, `lisa-linear-build-intake`). Each vendor arm cites this slug at its claim step rather than re-implementing detection, exactly as the vendor arms cite `leaf-only-lifecycle` and `repo-scope-split`. That is what keeps a rejection detected on JIRA from being missed on Linear.

## Seam — where detection runs

The three build-intake skills share a uniform claim phase: `3a.0` repo-scope gate → `3a` leaf-only claim gate → `3b` Claim → `3c` run lifecycle (culminating in `lisa-implement`) → `3d` transition to done.

Detection runs at the **top of `3b`, BEFORE the relabel** `$READY → $CLAIMED`. The relabel is what makes the claim idempotent, but it also overwrites the current lane — after it, "the item is currently in `$READY`" is no longer observable, and part of the rejection signal (reached-a-later-lane AND now-back-in-ready) depends on reading the current lane against history. So detection reads history first, classifies, and only then does `3b` perform the relabel.

**`lisa-implement` is NOT the seam** — it never sees the claim. Detection belongs to the build-intake claim phase.

## Classification

Detection is a pure read of the item's transition history (via the vendor access layers). It returns exactly one classification:

| Classification | Condition |
|---|---|
| `rejection-reclaim` | History shows the item reached a `review`/`done`-ward lane, then returned to the ready lane; it is now in the ready lane being claimed. |
| `forward-only` | History shows only forward lane moves — the item never returned to the ready lane from a later lane. |
| `never-left-ready` | History shows the item never left the ready lane. |
| `unknown` | The vendor history query failed, was inconclusive, or returned nothing usable. |

Running detection twice on the same item yields the same classification and produces no side effects (idempotent, headless-safe — safe under intake crons with no interactive prompts).

## Vendor history bindings

History is always obtained through the vendor access layer — never a direct vendor API call from a build-intake skill (`integration-access-layer`).

- **GitHub** — read the issue via `lisa-github-read-issue`, whose Label-Event History surface returns chronological `LabeledEvent` / `UnlabeledEvent` entries. A backward move is: the configured **ready** label was removed (item advanced) and later re-added (item bounced back). Non-status label churn is ignored for classification.
- **JIRA** — call `lisa-atlassian-access operation: changelog key:<K>`. A backward move is a status changelog entry whose `to` is the configured ready status, following an earlier entry that reached a `review`/`done`-ward status.
- **Linear** — call `lisa-linear-access operation: history id:<ID>`, keyed on `status:*` **label** history (Linear build lanes are label-driven — `lisa-linear-build-intake` keys the queue on `status:*` labels). Resolve `addedLabelIds` / `removedLabelIds` against `list-issue-labels`; a backward move is the configured ready label re-added after a later-lane label was applied. Linear workflow-state moves (`fromState`/`toState`) are a secondary corroborating signal where the project maps lanes to states.

### Lane names are configuration, never literals

The ready / claimed / done lane names ALWAYS come from `.lisa.config.json` lanes:

- `github.labels.build.{ready,claimed,done}` (GitHub),
- the JIRA status equivalents, and
- the Linear label equivalents,

resolved per the `config-resolution` rule with the `src/sync/registry.ts` `BUILD_LABEL_DEFAULTS` (`ready: status:ready`, `claimed: status:in-progress`, `done: {dev: status:on-dev, staging: status:on-stg, production: status:done}`) as the fallback. **Never hardcode** a lane string in the detection logic — a project that renames its ready lane must still detect rejections.

## Never block the build

`unknown` is a **first-class result**, not an error. If the history query fails (network, revoked credentials, missing substrate), is inconclusive, or the vendor returns nothing usable, detection returns `unknown` and the build **proceeds** to implement the item normally. Reflection is a bonus signal layered on top of the claim; it never gates it. A history failure, an unreadable history, or an absent history all degrade gracefully to "implement the item anyway".

## Learning-loop exclusion (no learning about learning)

This flow persists learnings via PRs and files upstream issues, so its own artifacts are themselves rejectable. If a learning PR or an auto-filed upstream issue is ever moved backward, a naive detector would fire `rejection-reclaim` on it and reflect on the flow's own output — a learning about learning, recursively.

The trigger is therefore **suppressed at the source**. Before an item is classified `rejection-reclaim`, exclude it if it carries any of the learning producer markers — `[lisa-learning-drop]`, `[lisa-learning-pr]`, `[lisa-learning-upstream-handoff]` (embedded in the artifact body/PR the same way other Lisa markers are) — or the `learning:needs-triage` label. An excluded item is treated as `forward-only` (normal work); the rejection-reflection path never fires on it, no matter how the artifact moved. (These markers ship with the learning-persistence flow; reference them by name — do not assume their files are present in this branch.)

This is the **trigger-side** half of the no-learning-loops guard. The claim-time archaeology path carries the symmetric **scan-side** exclusion ("a learning PR is never treated as an ancestor").

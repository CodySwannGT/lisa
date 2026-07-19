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

## Reflection at re-claim (`rejection-reclaim` only)

When detection returns `rejection-reclaim`, the build-intake claim phase reflects on the rejection **before re-implementing** — the QA comment describing the defect, the review threads, and any linked failure output are the teaching material. This runs in the `3b`/`3c` claim seam, not in `lisa-implement` (which never sees the claim). On any other classification (`forward-only`, `never-left-ready`, `unknown`) there is nothing to reflect on — proceed to the normal claim.

1. **Read the rejection evidence — through the access layers only** (`integration-access-layer`): the issue/ticket comments posted **after** the backward transition (the QA rejection comment), the review threads on the rejected PR, and any linked failure output. Read via `lisa-github-read-issue` / `lisa-atlassian-access` / `lisa-linear-access` as the vendor dictates — never a direct vendor API call.
2. **Assemble ONE candidate learning** from that evidence:

   | Field | Content |
   |---|---|
   | `rule` | The candidate rule/lesson the rejection teaches. |
   | `why` | Why it matters — the defect the rejection named. |
   | `provenance` | The rejection linked as provenance: the issue, the backward transition, the QA comment link, the rejected PR. |
   | `evidence_links` | The comment / review-thread / failure-output URLs. |
   | `scope_hint` | Where the learning applies (repo / stack / global). |
   | `triggering_issue` | The re-claimed item's ref. |
   | `fingerprint` | `sll4-` + `sha1(<normalized-rule> + "\n" + <triggering_issue>)` truncated to 12 chars (the learning-persistence flow's formula). |

3. **Route the candidate into the judgment gate** via the `lisa-persist-learning` skill (the learning-persistence flow — cite it by name; it ships with that flow, so do not assume its file is present in this branch). Pass the candidate with the rejection as provenance.

### Graceful degrade — `lisa-persist-learning` unavailable

If `lisa-persist-learning` is not installed when reflection runs (e.g. the learning-persistence flow has not merged yet), do **not** fail. Record the candidate as a marked comment on the item and proceed. The comment MUST carry a **visible prose line** as well as the marker — a bare HTML marker renders as an empty comment bubble on GitHub/Linear, defeating the "visible paper trail" this reflection exists to create:

```text
Recorded a candidate learning from this rejection (queued for the judgment gate): <one-line candidate rule>.
<!-- [lisa-rejection-candidate] key=<issue>-<transition-ts> -->
```

so a human sees the paper trail, a later run (once the skill exists) can pick it up, and the build still proceeds to implement the item. The marker line is verbatim — the dedupe contract keys on it, not on the prose.

### Idempotency — marker dedupe

The candidate marker key is `<issue>-<backward-transition-timestamp>` (the ISO timestamp of the backward transition that produced the rejection). Reuse the marker-dedupe discipline from `lisa-github-write-prd` Phase 2 — search for an existing candidate carrying this exact key before producing one; **match on the marker, never the title**. Re-claiming the same rejected item twice must **not** produce a duplicate candidate: the second run finds the existing marker and short-circuits. The backward-transition timestamp (not "now") makes the key stable across re-claims of the same rejection.

### Never block the build

Unreadable or absent rejection evidence (no comment, deleted PR) ends with **no candidate produced and the item still implemented** — degraded, not stopped. Reflection is layered on top of the claim; it never gates it.

## Evidence handoff into implementation (`rejection-reclaim` only)

Mining a learning is not enough — if the agent then rebuilds the same rejected thing, the item is re-bounced. So the same rejection evidence read in reflection is **also** handed into the implementation, so the re-implementation consumes it instead of repeating the rejected approach.

- **The handoff is at claim time.** `lisa-implement` never sees the claim and cannot fetch this itself; the build-intake `3c` lifecycle dispatch passes the rejection evidence summary into `lisa-implement` as part of the context bundle. Reuse the evidence already read in the reflection step — do not fetch it twice.
- **The evidence summary** names: what was rejected, why (the defect the QA comment named), and the specific approach the rejection named as wrong.
- **The plan must reckon with it.** On a `rejection-reclaim`, the re-implementation plan MUST explicitly address the rejection evidence and MUST NOT re-propose the specific approach the rejection named as wrong.
- **Absence never blocks.** If the rejection evidence is unreadable or absent, the agent still implements the item — degraded, not stopped.

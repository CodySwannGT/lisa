# Claim-Time Archaeology

Lisa lifecycles are ONE-WAY — a done issue never reopens, so residual failures come back as NEW issues, and the causal link "issue B exists because issue A was done wrong" is invisible unless someone digs. Reopening terminal issues is out of scope, so claim-time archaeology is the only way to recover that link: at claim time, determine whether the item being claimed is round 2 of a past failure, and if so, what specifically went wrong the first time.

It is a **single vendor-neutral contract** consumed by all three build-intake skills (`lisa-jira-build-intake`, `lisa-github-build-intake`, `lisa-linear-build-intake`). Each vendor arm cites this slug in its claim step rather than growing its own archaeology, exactly as the arms cite `leaf-only-lifecycle`, `repo-scope-split`, and `rejection-detection`. One slug is what keeps an ancestor found on JIRA from being missed on Linear.

## Seam and sequencing — after rejection detection, before the claim transition

The three build-intake skills share a uniform claim phase: `3a.0` repo-scope gate → `3a` leaf-only claim gate → `3b` Claim → `3c` run lifecycle (culminating in `lisa-implement`) → `3d` transition to done.

Within `3b`, the pre-transition window runs two passes in a fixed order:

1. **`rejection-detection` runs first** (top of `3b`, before the relabel — it needs the current-lane signal that the relabel destroys).
2. **Archaeology runs second** — after the rejection classification exists, still **before the relabel/transition** `$READY → $CLAIMED`.

The ordering is load-bearing: rejection-detection's classification is an **input** to archaeology's. A `rejection-reclaim` detected in pass 1 flows straight into archaeology's classification — it is reused, **not re-derived**. Archaeology never re-reads transition history to second-guess the rejection detector; forking that signal would guarantee drift between the two passes.

**`lisa-implement` is NOT the seam** — it never sees the claim. Archaeology belongs to the build-intake claim phase, like the two gates before it.

## Ancestry signals

Three signal sources, tried in order of cheapness. Every query counts against the cost budget below.

### 1. Tracker metadata (typed relations)

The cheapest and most reliable signal: the relations the vendor read skills already parse. Read them from the context bundle the intake flow already fetched — do not re-fetch:

- The typed relation lines — `Blocks` / `Blocked by` / `Relates to` / `Duplicates` / `Cloned from` — that `lisa-github-read-issue`, `lisa-jira-read-ticket`, and `lisa-linear-read-issue` parse into the relations table of their context bundles.
- GitHub's native `closingIssuesReferences` (PR↔issue closure links) and timeline cross-references, surfaced by the same `lisa-github-read-issue` GraphQL read. JIRA issue links and Linear native relations (`blocks` / `blocked_by` / `relates_to` / `duplicates`) are the vendor equivalents, read through the access layers (`integration-access-layer`) — never a direct vendor API call.

A relation pointing at a **closed, done** issue whose shipped work plausibly covers this issue's surface is an ancestor candidate. An "introduced by"-shaped link (this issue references the PR or issue that shipped the defect) is the strongest form.

### 2. Text similarity (bounded, lexical)

**The honest bound, stated plainly: no embedding machinery exists in Lisa, and none is introduced here. This signal is lexical overlap over tracker search primitives — not semantic similarity — and it will miss paraphrased descriptions.** That is acceptable: it exists to catch the common case of a new issue describing a defect in something recently shipped, using roughly the words the shipping issue used.

Scope: **recently-closed** issues (closed within the recent window the budget affords, newest first) **touching the same implicated files** where file paths are named or inferable, ranked by **title/label overlap** with the issue being claimed. The primitives:

- **GitHub** — `gh search issues "<key terms>" --repo <org>/<repo> --state closed --sort updated` (and `--label` narrowing where labels overlap).
- **JIRA** — `lisa-atlassian-access operation: search-issues jql: "project = <P> AND statusCategory = Done AND resolved >= -30d AND text ~ \"<key terms>\" ORDER BY resolved DESC"`.
- **Linear** — `lisa-linear-access operation: list-issues` filtered to completed state types, matched client-side on title/label overlap.

A hit is a candidate only when the overlap is specific (shared distinctive terms, same component labels, same files named) — generic word overlap alone never promotes an ancestor.

### 3. Git ancestry (deterministic, machine-readable)

For the files the issue implicates (named in the body, or inferred from the similarity hits), answer "which PR last shipped this file" with **direct deterministic git commands**:

```bash
git log --follow --format='%H %aI %s' -n 5 -- <file>   # last commits touching the file
git blame -L <range> --line-porcelain <file>            # who last shipped the implicated lines
# The PR that shipped the file. --full-history is required: path-limited git log
# simplifies away merge commits by default, silently dropping the merge-PR answer.
# Two --grep patterns (OR'd) cover both merge conventions: classic merge commits
# ("Merge pull request #<n>") and squash/rebase merges (subject ending "(#<n>)").
git log --full-history --grep "Merge pull request #" --grep "(#[0-9]\+)" --format='%H %aI %s' -n 5 -- <file>
```

Keep the result **parseable**: a `{file, sha, pr, date}` tuple per implicated file (PR number extracted from the subject — `Merge pull request #<n>` for merge commits, the trailing `(#<n>)` for squash/rebase merges; empty when the history matches neither convention). The PR maps back to its issue via `closingIssuesReferences` / the PR body's issue reference.

**Do NOT delegate this to the `git-history-analyzer` agent.** That agent can answer the question, but it returns a **prose report with no machine-readable contract** (nothing downstream can reliably parse it), it is explicitly forbidden from judging past decisions, and it reads the local repo only. For programmatic claim-time archaeology, run the deterministic query directly and keep the `{file, sha, pr, date}` result.

## Learning-loop exclusion (scan-side — a learning artifact is never an ancestor)

This flow produces learning PRs, candidate comments, and upstream handoffs. Those artifacts touch the same files and reference the same issues as the failures they describe — which makes them **near-perfect false-positive ancestors**. Without an explicit exclusion the flow learns from itself, recursively.

Before any candidate is promoted to ancestor, exclude every artifact carrying any of these markers or labels — such an artifact is **never an ancestor**, no matter how strong its other signals:

- `[lisa-learning-drop]`
- `[lisa-learning-pr]`
- `[lisa-learning-upstream-handoff]`
- `[lisa-rejection-candidate]`
- `[lisa-archaeology-candidate]` (this rule's own producer tag — archaeology's output must not seed the next claim's input)
- the `learning:needs-triage` label

This is the **scan-side** half of the no-learning-loops guard; `rejection-detection` carries the symmetric **trigger-side** half ("a learning artifact is never a rejection-reflection trigger").

## Classification

Exactly one of three states:

| Classification | Condition |
|---|---|
| `rejection-reclaim` | The `rejection-detection` pass classified this claim `rejection-reclaim`. Taken directly from that result — reused, never re-derived here. Its reflection path (the `[lisa-rejection-candidate]` candidate) already covers the learning; archaeology adds nothing on top. |
| `retry-of-done-issue` | Not a rejection-reclaim, AND an ancestry signal (§ above, post-exclusion) names a closed done issue whose shipped work this issue exists to fix. |
| `fresh` | Everything else: no ancestor, weak/inconclusive signals, budget exhausted, or the pass errored. |

Classification itself is **stateless** — a pure function of the signals read this pass, holding no cache or stored state between claims. Re-running it on the same inputs yields the same answer; idempotency of the *side effect* (the candidate) is carried by marker dedupe below.

## Candidate derivation (`retry-of-done-issue` only)

An ancestor alone teaches nothing — "B relates to A" is trivia. The learning lives in the **delta**: the gap between what agent A actually did and what issue B proves was actually needed.

1. **Reconstruct what the ancestor shipped**, through the access layers: its merged PR (diff, description), the review threads on that PR, and the evidence comments on the ancestor issue.
2. **Derive ONE candidate learning citing the delta** — **what was done** versus **what this issue proves was needed**. The shape is "A shipped X; B proves Y was required; the mistake was assuming X sufficed" — never "A had a bug". A **vague summary** that does not name the specific mistake is worthless and must be rejected (produce nothing rather than noise).
3. **Route it to `lisa-persist-learning`** exactly like the rejection-reflection path: candidate fields (rule, why, provenance linking the ancestor issue + its PR + this issue, evidence links, scope hint, triggering issue) with fingerprint `sll4-sha1(rule\ntriggering_issue)[:12]`.

### Graceful degrade — `lisa-persist-learning` unavailable

Same fallback pattern as the rejection path, with this rule's own distinct marker. Record the candidate as a comment on the claimed item carrying a **visible prose line** plus the marker (a bare marker renders as an empty comment bubble):

```text
Recorded a candidate learning from this retry's ancestry (queued for the judgment gate): <one-line candidate rule>.
<!-- [lisa-archaeology-candidate] key=<issue>::<ancestor> -->
```

The marker line is verbatim — the dedupe contract keys on it, not on the prose.

### Idempotency — marker dedupe

The key is `<issue>::<ancestor>` (the claimed item's ref, `::`, the ancestor's ref — the `::` separator keeps the key unambiguous when vendor refs themselves contain hyphens, e.g. `PROJ-123`; it is stable across re-claims of the same pair). Before producing a candidate, search for an existing `[lisa-archaeology-candidate]` comment/artifact carrying this exact key — match on the **marker, never the title** (the `lisa-github-write-prd` Phase 2 discipline). Dedupe is per **(issue, ancestor) pair**: re-claiming an issue whose archaeology already resolved the same ancestor finds the marker and short-circuits — no duplicate candidate for that pair. A re-claim that resolves a **different** ancestor is new evidence and may legitimately produce a second candidate under its own key — that is intended, not a dedupe failure.

### `fresh` produces silence

A `fresh` classification produces **no candidate and zero comments**. Silence is the correct output — emitting a low-value candidate on every claim is precisely the rule-pollution failure mode the learning loop names as its existential risk.

## Cost budget — enforced here, configured in one place

Archaeology is speculative digging on the critical path of every claim. The budget is what makes that safe.

- **`archaeology.maxSteps`** — the maximum number of tracker/git queries one archaeology pass may spend, read from `.lisa.config.json`:

  ```bash
  MAX_STEPS=$(jq -r '.archaeology.maxSteps // 8' .lisa.config.json 2>/dev/null || echo 8)
  ```

  The conservative default is **8** — enough for the metadata read (free, already fetched), one or two similarity searches, and git ancestry over a handful of implicated files, and small enough that a fruitless dig on a large repo ends quickly. `lisa sync` seeds the key (registry default), and **this rule pair is the single documented place** for what the budget means — do not restate its semantics in the vendor skills.
- **`archaeology.maxSeconds`** — optional wall-clock ceiling for the whole pass, read the same way (`jq -r '.archaeology.maxSeconds // empty'`); unset means steps alone bound the pass.

**Budget exhaustion is a NORMAL outcome, not an error.** When the pass hits either ceiling with no confident ancestor, it classifies `fresh` and the claim proceeds immediately — no retry, no escalation, no blocking warning.

## Never block the claim

The invariant everything above hangs on: **archaeology never blocks the claim**. By construction:

- Weak or inconclusive signals → degrade to `fresh`, claim proceeds.
- Budget exhausted → degrade to `fresh`, claim proceeds.
- The pass throws or errors (tracker outage, malformed history, missing config) → the exception is caught, classification degrades to `fresh`, and the **claim still proceeds** — a crash inside a speculative bonus feature must never strand a ready issue in the queue.
- Unreadable ancestor evidence on a genuine retry → no candidate produced, the item is still implemented — degraded, not stopped.

Headless-safe throughout: no interactive prompts, safe under intake crons.

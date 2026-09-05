# Deployed-State Readback

> Demoted from the always-on eager tier by CodySwannGT/lisa#3992. The
> section below is the former eager head, preserved verbatim; the full
> contract follows it. Reachable on demand via `rules/eager/00-rule-index.md`.

## Deployed-State Readback (load-bearing)

**A build ticket asserts that something is missing from a running system. That assertion must come from reading the running system, never from reading the source.** Source tells you what the code says; only the environment tells you what is deployed. A ticket authored from source alone specifies work against a system it has not observed.

**One vendor-neutral contract, cited by** the Phase 2 research step of `lisa-notion-to-tracker`, `lisa-github-to-tracker`, `lisa-linear-to-tracker`, and `lisa-confluence-to-tracker` (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never four divergent forks).

## The waiver this replaces was scoped to the wrong axis

Phase 2 has two halves — codebase research and a live product walkthrough — and the walkthrough was waived for work that is *"purely backend with no user-visible surface."*

"Is it user-facing?" is a question about the **observation method**: browser, API client, or resource readback. It was being used to answer a different question — **"should we observe live state at all?"** Backend, infrastructure, CI, and dependency work all have live state. It simply is not visible through a browser. Waiving the browser step correctly, and live grounding along with it, is what let tickets be authored for work that had already shipped.

So the skip is **not** "no live check". It is **a different probe**.

## Routing

| The work | Probe |
|---|---|
| User-facing surface | `lisa-product-walkthrough` against the running app |
| HTTP / API backend | Call the deployed endpoint and read the response |
| Infrastructure / IaC | **Describe the deployed resource in the account** |
| CI / workflow config | Read the config the running pipeline actually used |
| Dependency / package pin | Read the **installed** artifact, and the registry |
| Screen that does not exist yet | No probe; record why |

## What is never accepted as evidence of deployment

**Git ancestry, a merge check, and `cdk synth` are not deployment evidence.** A commit can be an ancestor of the default branch and never have shipped: a pipeline running `executionMode: SUPERSEDED` discards queued executions, so an intermediate commit's deploy is silently dropped. `git log`, a merge check, and a synth all report "present" while the environment does not have it.

Read the deployed thing back. Do not infer it from anything upstream of the deploy.

**This does not conflict with `blocker-containment`, which requires exactly the ancestry test this rule rejects.** The two answer different questions and both are right:

- `blocker-containment` asks a **development** question — *is the blocker's code on the branch I will build from?* Ancestry is the correct and sufficient test.
- This rule asks a **deployment** question — *is this live?* Ancestry is provably insufficient, per the discarded-execution case above.

Neither may be used to answer the other's question.

## An unanswerable probe is not a "no"

If the deployed state cannot be read back — no credentials, no such environment, the resource is not addressable — **record that the check could not be performed**. Absence of evidence is not evidence of absence, and defaulting an unreadable probe to "not deployed" reintroduces the whole defect while appearing to satisfy the rule.

## Record the readback on the ticket

Write what was probed, how, and what came back. Claim-time triage then inherits evidence instead of re-deriving it from source — which is the same mistake one stage later.

---

A build ticket is a claim about a running system: *this is missing, build it.* The claim is only as good as the observation behind it, and until this rule the observation was optional for everything that did not render in a browser.

It is a **single vendor-neutral contract** consumed by the Phase 2 research step of `lisa-notion-to-tracker`, `lisa-github-to-tracker`, `lisa-linear-to-tracker`, and `lisa-confluence-to-tracker`. Each cites this slug rather than restating the routing, exactly as they would cite `leaf-only-lifecycle` or `repo-scope-split`. Phase 2 had already forked into four near-identical copies; this is what stops them drifting further.

## The failure this replaces

Phase 2 is titled "Codebase + Live Product Research" and has two halves:

- **2a — codebase research.** Source only, by construction.
- **2b — live product walkthrough.** The only live-state input anywhere in the PRD-to-ticket path, gated on *"If the PRD touches existing user-facing surfaces"* and then waived outright: *"Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist in dev/prod."*

So user-facing work got one live check and everything else got none. Backend, infrastructure, CI-config and dependency-pin work reached the build queue with **zero deployed-state evidence**, and nothing downstream closed the gap at authoring time: the `*-validate-issue` skills treat "live" as the live *tracker item*; the write skills' only "already exists" concept is the tracker-to-tracker `duplicates` relation; and `lisa-use-the-product`'s IaC lane defaults to `cdk synth` / `cdk diff` — still derived from source — and Phase 2 never routed non-user-facing work into it anyway.

### The waiver was scoped to the wrong axis

This is the whole diagnosis, and the fix follows from it.

*"Is it user-facing?"* is a question about the **observation method** — do you need a browser, an API client, or a resource description call? It was being used to answer *"should we observe live state at all?"*

Those come apart precisely outside the browser case. An infrastructure change has live state; a dependency pin has live state; a CI workflow has live state. None of them are visible through a browser, all of them are readable. The waiver treated "not observable *this way*" as "not observable", and every measured failure sat in that gap: tickets aimed at the wrong repository, tickets specifying the defect rather than the fix, tickets whose target version matched none of the four live version numbers in play, tickets for work that needed verification rather than implementation, and a ticket for behavior that had been in production for a month with a code comment already stating its intent verbatim.

This is the same shape as `blocker-containment`'s defect: a proxy that holds in the common case, used as though it held in general.

## The doctrine this applies

Lisa already says this, three times over, in eager load-bearing rules — none of which the authoring path cited:

- **`empirical-inquiry`** — *"find out empirically before you act… Do not reason your way to a confident-sounding answer from documentation, prior assumption, or training knowledge when the real system is right there and a quick probe would tell you the truth."*
- **`verification`** — *"Never claim success without runtime evidence. 'The code looks correct' is not evidence."*
- **`stale-state-claims`** — on assertions of state that expire. A PRD's *"X doesn't exist yet"* is exactly such a claim, and that rule names this outcome in advance: work *"re-planned as undone when it already shipped."*

This rule is not new doctrine. It is those three, wired into the one path that was authoring claims about running systems without consulting any of them.

## Routing — the skip is a different probe, never no probe

Phase 2 selects a probe for each thing the candidate tickets would create or change:

| The work | Probe | Reads |
|---|---|---|
| User-facing surface | `lisa-product-walkthrough` against `E2E_BASE_URL` | The running app |
| HTTP / API backend | Call the deployed endpoint as the test identity | The running service |
| Infrastructure / IaC | Describe the deployed resource in the account (`aws … describe-*`, provider read API) | The account |
| CI / workflow config | Read the configuration the most recent pipeline run actually used | The pipeline |
| Dependency / package pin | Read the **installed** artifact in the deployed tree, plus the registry | The artifact |
| CLI / library | Invoke the published build's `--version` / read-only command | The published build |
| Screen or resource that does not exist yet | None — record why, per the unanswerable-probe rule below | — |

The probe is chosen by **what kind of thing it is**, never by whether a human could have clicked it.

## What is never accepted as evidence of deployment

**Git ancestry, a merge check, and `cdk synth` are not deployment evidence.**

A commit can be an ancestor of the default branch and never have shipped. A deploy pipeline running `executionMode: SUPERSEDED` discards queued executions, so an intermediate commit's deploy is silently dropped. `git log` reports the commit present, a merge check reports it merged, and a synth reports the resource declared — while the environment does not have it. Every one of those signals is upstream of the deploy, and the deploy is the step that can fail silently.

Read the deployed thing back. Do not infer it from anything upstream of the deploy.

### This does not conflict with `blocker-containment`

`blocker-containment` requires exactly the ancestry test this rule rejects. Both are correct, because they answer different questions:

| Rule | Question | Ancestry |
|---|---|---|
| `blocker-containment` | **Development** — is the blocker's code on the branch I will build from? | Correct and sufficient |
| this rule | **Deployment** — is this live? | Provably insufficient |

An `is blocked by` link is satisfied when the code you need is on your base branch; whether it has reached production is irrelevant to whether you can build against it. A "this already exists" claim is satisfied only when the thing is running. **Neither test may be used to answer the other's question**, and a surface that needs both runs both.

## An unanswerable probe is not a "no"

If the deployed state cannot be read back — no credentials for the account, no such environment provisioned, the resource is not addressable from here — **record that the check could not be performed, and say which probe was attempted.**

Defaulting an unreadable probe to "not deployed" reintroduces the entire defect while appearing to satisfy this rule, and it is the single most likely way to implement it wrongly. It is the same error `blocker-containment` guards with its fail-closed table and `lisa-repair-intake` guards with *"'No blocker found' is inconclusive, never clearance."* Absence of evidence is not evidence of absence.

A ticket authored on an unanswerable probe is still allowed — some work genuinely cannot be grounded before it starts — but it carries the unanswered probe on its face, so the human at the gate and the agent at claim time both know the claim is ungrounded rather than confirmed.

## Record the readback on the ticket

Write what was probed, how, and what came back — the command or call, and the result. Two reasons:

1. **Claim-time triage inherits evidence instead of re-deriving it.** `lisa-ticket-triage`'s `DUPLICATE_ALREADY_FIXED` verdict already demands empirical evidence; without a recorded readback it must reconstruct one from source, which is the same mistake one stage later.
2. **An ungrounded ticket becomes visible as ungrounded.** A missing readback section is a signal, where a silently source-derived ticket looked identical to a grounded one.

## What this rule does not do

It does not decide whether the work is worth doing, size it, or govern anything after authoring. It governs one step: before a build ticket asserts that something is absent from a running system, that absence is observed rather than assumed.

It also does not require a probe for work that creates something genuinely new — a resource with no deployed predecessor has nothing to read back, and that is the "does not exist yet" row above, recorded rather than skipped silently.

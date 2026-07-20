# Claim → Evidence Mapping Contract (load-bearing)

**Every claim about the software declares a boundary, and a claim is established only by evidence of
a kind that reaches that boundary.** Unit tests are a quality prerequisite, not a claim discharger:
a passing unit `test-run-log` reaches only the **code-unit** boundary. Citing evidence whose *kind*
does not reach a claim's *boundary* — a unit log offered as proof that a button works in the browser
— is a contract violation, and a review-rejectable defect.

## The claim-boundary taxonomy (closed set)

Every claim binds to exactly one boundary, and each boundary is discharged only by evidence of the
kind(s) that reach it. The boundaries and their establishing evidence kinds are seeded verbatim from
the `verification` rule's artifact-type taxonomy — no new vocabulary is invented here:

- **`code-unit`** — pure-logic behavior in isolation → unit `test-run-log`. Reaches no boundary
  below it.
- **`browser`** — user-visible UI behavior → `screenshot`, `recording`. **Never** a unit
  `test-run-log`.
- **`http-api`** — request/response contract → `http-transcript`. **Never** a unit `test-run-log`.
- **`cli`** — command behavior → `cli-output`.
- **`data`** — persisted state → `db-query-output`, `state-dump`.
- **`deploy-health`** — a healthy running deployment → `deploy-log`. **Never** any pre-deploy
  artifact.
- **`performance`** — latency/throughput/frame timing → `perf-trace` (with methodology).
- **`standards-compat`** — conformance to an external standard → `cli-output` / `test-run-log` from
  the compat runner.

## The core inequality

**unit tests ≠ browser behavior ≠ healthy deployment ≠ standards compatibility.** Each is a distinct
boundary; evidence at one never discharges a claim at another. "Verified" must name the boundary its
evidence actually reaches, so a report read at the gate states its own limits (`factory-model`
rule 5).

## Field names (fixed here, made executable later)

A claim carries three fields — `claim_id`, `boundary`, and `required_evidence_kinds` — named here so
every downstream surface uses one spelling. This ticket only writes the contract down; the schema and
gate that make these fields executable ship with **BCE-2 (#1836)** — do not assume that surface is
present in this branch. The conservative security-bucket default is set in **BCE-5 (#1839)** — named
here, defined there.

## Artifact identity (pinned, never assumed)

A claim applies only to the artifact its evidence was collected against. Every verdict pins
`artifact.head_sha` — the commit the run observed — and every evidence entry pins the
`artifact_head_sha` in force when it was captured, its `sha256` content digest, and `captured_at`.
Evidence collected on a pre-merge head is valid for the merge commit **only** when that head is a
parent of the merge, per the ancestry + deploy-run definition of "what shipped" that
`lisa-drive-pr-to-merge` already owns — cite it, never write a second one. A mismatched SHA or a
recomputed digest that disagrees fails loudly, naming both SHAs / the evidence id, and verification
re-runs against the merged head before completion is declared. Full definition: the reference body.

## Not established (required, never omitted)

A claim with no reaching evidence is **Not established**, and every report says so out loud. Each
evidence comment and verdict carries a `Not established` section listing what was *not* proved —
boundaries not exercised, environments not tested, behavior consciously out of scope. It is never
omitted and never blank: with nothing outstanding it still renders `None outstanding — reviewed`, and
`not_established_reviewed` attests the list was reviewed even when the list itself is empty. This
generalizes the required, never-empty `Known limits` field of `lisa-improve-harness`. Full definition
and operator-voice exemplars: the reference body.

## No behavior change; degrade, never block

This rule is documentation, not a gate: it changes no schema, no skill, and no check. Where a later
surface it names is not yet installed, cite the boundary a claim reaches and continue — never block
on the absent surface. Read the contract to someone who has never seen Lisa and they should be able
to say why a unit-test log does not prove a button works in the browser.

Full contract (claim-boundary taxonomy, core inequality, worked example, field names): [reference/claim-evidence-mapping.md](../reference/claim-evidence-mapping.md).

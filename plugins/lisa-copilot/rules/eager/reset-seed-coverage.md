# Reset/Seed Coverage & State Classification (load-bearing)

**Every persistent entity a project owns carries exactly one declared reset policy, and a work item that adds or changes persistent state is not done until the reset/seed contract covers it.** An entity the running system holds but the contract does not classify is a contract violation, and the check that finds it **fails closed** — an unclassified entity is never treated as safe to keep and never treated as safe to delete.

**One vendor-neutral contract, cited by** `lisa-research`, `lisa-acceptance-criteria`, `lisa-task-decomposition`, `lisa-test-strategy`, `lisa-implement`, `lisa-codify-verification`, `lisa-verification-lifecycle`, and `lisa-verify` (the `leaf-only-lifecycle` / `repo-scope-split` precedent: one shared slug, never divergent per-skill prose). It never names a database engine, cloud, identity provider, or test runner — those are project configuration.

## Why this exists

Test suites create state. Without a contract, cleanup is a habit: a flow creates a uniquely-marked record and deletes it on the happy path only, so every early failure leaks one more. Nothing sweeps it, nothing complains, and the suite degrades until someone reads a flake as a product bug. The observed shape is always the same — leaked records accumulate silently until a list view, a uniqueness constraint, or a count assertion breaks. Per-flow self-cleanup is not coverage; it is the failure mode.

## Membership

Membership is **state, not repo name, ticket label, or storage engine**: an entity is in scope the moment something the project writes **outlives the process that wrote it**. That includes rows and tables, but rows are only one kind of state. Also in scope: identity-provider objects (accounts, groups, memberships, sessions), object storage (buckets, prefixes, uploaded files), search indexes, queues and topics (in-flight and dead-letter), caches with a persistence tier, materialized/derived views and projections, feature-flag and configuration overrides, scheduled jobs created at runtime, and analytics or third-party side effects a run leaves behind. Out of scope: values that live only in memory for the duration of one process.

A work item is in scope when it **adds** such an entity, **changes what owns or writes** one, or **changes the lifetime** of one. Renames count as changes, not as new entities plus deletions.

## The four policies

Every entity is classified as exactly one of:

- **`fixture-owned`** — the reset may create, mutate, and delete rows here, but only those it owns. Ownership is declared as a predicate (a reserved id shape, a reserved account or namespace, a marker attribute), never as "everything in this entity."
- **`preserve`** — the reset must leave this untouched. Catalog, reference data, anything a migration seeds, anything expensive or impossible to rebuild, and any state belonging to someone who is not the fixture.
- **`derived-rebuild`** — not authored by anyone; recomputed from its sources after the reset (projections, materialized views, search indexes, caches). The reset rebuilds it rather than clearing or preserving it, and proves it converged.
- **`forbidden`** — the reset must be structurally unable to touch it: ledgers, payments, wallets, withdrawals, audit trails, anything irreversible. Declaring `forbidden` obliges naming the enforcement outside the script — a least-privilege role, a revoked grant, a separate account or credential boundary — because a script-only promise dies in the refactor that drops the safe caller.

**Classify by provenance, never by observation.** "The table looked empty" is not evidence it is unused; runtime statistics are approximations, and a table that has never been analyzed reports rows it holds. Ask who writes it and whether anything can put it back.

## Keep-lists are a detector, not the safety model

Deriving the clear-list by subtracting a keep-list from a schema listing is a **useful detector** — run it, and let it flag entities the contract has not seen. It is not the boundary. It cannot model renames, multiple schemas, framework-generated entities, views, partitions, row-level ownership, or any of the non-DB state above, and "new entities are cleared unless exempted" erases unrelated data the first time something adds one. The boundary is the classification; subtraction only tells you the classification is stale.

## Required assurances

A reset contract is not complete until it declares, and points at evidence for, all of: non-fixture and catalog data survive; reserved fixture identifiers are rejected on collision with anything real; foreign references into preserved entities are refused rather than cascaded; every write is **acknowledged** (a mutation reported by the caller and not confirmed by the system is a failure, not a success); a second apply converges to the same state and reports no further change; the post-state is verified by **exact expected counts**, not "at least one"; and production fails closed with no override of any kind. Where the platform can enforce a boundary with roles, grants, or constraints, it does — the in-process guard remains as defense in depth, never as the primary control.

## Definition of done

A work item that adds or changes persistent state is not done until: (1) every entity it introduces or changes is classified in the project's state contract with a reason and an owner; (2) `fixture-owned` entities it introduces declare their ownership predicate **and** are actually swept by the reset — an entity a suite creates but nothing removes is the leak this rule exists to prevent; (3) `preserve`/`forbidden` entities it introduces name their enforcement; (4) any seed the suite depends on covers the new state, with the verify step asserting exact counts; and (5) the state-classification check passes in the same PR. **A missing or stale classification is a verification failure, not a warning** — it blocks completion exactly as a `PARTIAL` spec-conformance verdict does, and is never demoted to "optional", "if cheap", or a follow-up without a linked build-ready ticket created before merge.

## Bootstrap, noop, and degradation

A project with no state contract yet is not exempt: the first work item touching persistent state scaffolds the minimum (the contract file, its own entities classified, the check wired into CI) and covers **its own** state. It never backfills the whole system — pre-existing unclassified entities are recorded as burndown with an owner and a date, not treated as this item's blocker. A project that genuinely holds no persistent state declares a **machine-readable noop** (`mode: "declared-noop"` with reason, owner, and a capability-manifest reference) which the check verifies against the repo rather than taking on faith — a bare exit 0 is indistinguishable from a successful destructive run and never satisfies this rule. A project that cannot produce a runtime inventory records the checked sources and the absence, exactly as the regression-spec absence path in `verification` does; a silent skip is never one of the exits.

## Command envelope

Every reset, seed, verify, inventory, and classification adapter answers the **same interface** — one validated JSON result on stdout, exit 0 only when the operation both completed **and** verified, `--dry-run` mandatory before anything destructive, and a requested stage always re-checked against server-resolved identity rather than trusted. The envelope is specified in the reference body and is what makes "every repo answers the same question the same way" checkable instead of aspirational.

**The production arm of this is executable, not advisory.** `scripts/lisa-destructive-guard.mjs` ships to every adopter and is wired into the envelope itself: a destructive run against a production-resolved — or unresolvable — environment has **no representable success envelope**, so it can never exit 0, and there is no parameter, field, or environment variable anywhere in the guard that changes the answer. A dry run is not an exemption, and `--dry-run` is the default rather than an opt-in. Read this as what it is: a check at the one interface every adapter passes through, which an adapter that misreports its own environment still defeats. The end state is a destructive capability that is **not deployed to production at all** — non-existence beats refusal — and that design, with the failure modes it must still close, is recorded in `docs/design/reset-production-absence.md`.

Full contract (state-contract schema, check semantics, detectors, envelope schema, enforcement patterns, bootstrap procedure): [reference/reset-seed-coverage.md](../reference/reset-seed-coverage.md).

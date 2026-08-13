---
name: lisa-codify-verification
description: "Convert empirical verification…"
allowed-tools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Skill"]
---

# Codify Verification: $ARGUMENTS

Take the empirical verification that just passed and encode it as an automated regression test. The manual proof becomes a repeatable check that catches future regressions.

This skill is invoked from the verification lifecycle (between Execute and Spec Conformance) and from each work-type sub-flow (Build / Fix / Improve) after the local verification step.

## When to invoke

Invoke once per empirical verification that produced PASS evidence. If a single change had three verifications (UI flow, API endpoint, DB query), this skill runs three times — or once with the three verifications batched, but each must produce its own committed test.

## When to skip

Skip codification only for verification types whose proof is inherently non-behavioral:

- **PR** — proof is the PR description itself
- **Documentation** — proof is content review
- **Deploy** — proof is deployment output and health endpoints (already covered by ops-verify-health)
- **Investigate-Only spikes** — produce findings, not shipped code

For every other verification type, codification is mandatory. If the codification is not possible (e.g., the test framework doesn't exist and can't be installed in scope), escalate via the lifecycle's Escalation Protocol — do not silently skip.

## Inputs

The caller must provide:

- The verification type (UI, API, Database, Auth, Security, Performance, Background Jobs, Cache, Configuration, Email/Notification, Observability, Infrastructure)
- The exact steps that were performed (URL visited, request made, query run, etc.)
- The expected outcome (status code, UI state, row count, log entry, etc.)
- The proof artifact captured (screenshot path, response body, query output, log excerpt)

If any of these are missing, ask the caller before generating a test — a test built on guesswork will not match the verification it claims to encode.

## Process

### 1. Discover existing test infrastructure

Before creating anything new, find what the project already has. Use the Tool Discovery Process from `verification-lifecycle`. Specifically check for:

- **Browser/E2E**: `playwright.config.*`, `cypress.config.*`, `e2e/` directory, `tests/e2e/`, Playwright/Cypress in `package.json` devDependencies
- **API/integration**: `tests/integration/`, `spec/`, `test/integration/`, supertest/fetch helpers, Vitest/Jest integration configs
- **Database**: integration test setup with migrations, factory files, seed scripts
- **Performance**: existing benchmark suite (`benchmarks/`, `bench/`), `vitest bench`, k6 scripts
- **Mobile (RN/Expo)**: Detox config, Maestro flows
- **Backend jobs**: existing job-test harness, queue integration tests

Do NOT install a new framework if one already exists for the verification type. Use what's there.

If the empirical proof came from Kane, consume its exact objective, observable assertions, URL, and local evidence pack as inputs. Do not commit Kane `_test.md` recordings, generated code, or auto-healed selectors as the authoritative regression. Encode the same behavior in the project's existing native runner under the deterministic rules below.

### 2. Map verification type → framework

| Verification type | Preferred framework (use whichever the project already has) |
|---|---|
| UI (web, mobile, or any frontend surface) | **The project's configured runner for every platform the behavior requires** — see "Frontend multi-runner codification" below. This row is authoritative for any UI work covered by a `bdd-e2e-coverage` scenario (in practice, essentially all user-facing UI work); it supersedes any generic runner preference — a project's web runner might be Playwright, Cypress, or Selenium, and its device runner might be Maestro, Detox, or a Playwright mobile-emulation profile, but the choice is read from `runnerPlatforms`, never assumed |
| API | project's integration test runner (Vitest / Jest / RSpec / pytest) with HTTP client (supertest / fetch / faraday) |
| Database | integration test with real DB + migrations applied |
| Auth | API or UI test asserting role-gated access (multi-role coverage) |
| Security | regression test that reproduces the attack and asserts safe handling |
| Performance | benchmark in the project's bench harness, asserting against the baseline captured in the verification |
| Background Jobs | integration test that enqueues, drains the queue, and asserts terminal state |
| Cache | integration test asserting hit/miss/invalidation behavior |
| Configuration | integration test that loads config and asserts effect |
| Email/Notification | test capturing outbound message via project's mailer test mode |
| Observability | test asserting structured log/metric/trace emission |
| Infrastructure | test or script asserting infra state (terraform plan diff, CDK snapshot test) |

If the project lacks the preferred framework AND no acceptable substitute exists, escalate.

### 2a. Frontend multi-runner codification (non-demotable)

For **frontend work** — any verification whose validation journey exercised a user-facing UI surface — codification is not one-runner-or-the-other. The `bdd-e2e-coverage` rule is the contract; this section is only how codification satisfies it. After the validation journey is complete and verified:

1. **Locate the behavior's scenario** in the project's behavior contract (`bdd/features/**` by default) — its stable `@BDD-*` ID and the platforms it declares. If the verified behavior has no scenario yet, write it now; that is part of codification, not a separate task. If the project has no contract yet, take the rule's bootstrap path, scoped to this behavior only.
2. **Codify into the project's configured runner for EVERY platform that scenario requires.** The runner→platform mapping is project configuration, declared in `bdd/coverage-map.json` under `runnerPlatforms` — read it rather than assuming a tool. Wire each new spec/flow where its runner already picks work up, following the project's existing directory and tagging conventions.
3. **Record the mapping.** Add one `mappings` entry per scenario-platform obligation naming the runner, platforms, file, and an `evidence` string that actually appears in that file, then regenerate the matrix and burndown so the gate reflects the new coverage.
4. **Run the coverage gate.** Invoke the project's configured `bdd-e2e-coverage` check command (the same one wired into CI) and confirm it passes. Regenerating the matrix and burndown only recomputes the report; it does not itself prove the gate is green. Record the command and its result in the codification evidence — a regenerated matrix with no observed gate run is not proof of coverage.

Every artifact encodes the SAME verified journey against a different platform. One is never a substitute for another, and a passing test on one platform never seals another platform's obligation.

### 2b. Codifying persistent state (non-demotable)

When the verified journey **created, changed, or depended on persistent state**, the `reset-seed-coverage` rule governs what else this codification owes. Classify every entity the work touched in the project's state contract, give anything `fixture-owned` an ownership predicate and a sweep, and run the project's state-classification check the same way the coverage gate is run above — a contract edited but never checked is not proof. Where the journey depended on seeded state, the seed's verify step asserts **exact expected counts** for that state: "at least one" passes against a leak, which is precisely the condition being guarded. Cite the rule for the policy vocabulary and the assurances; do not restate them here.

Permitted exits, mirroring the regression-spec rule in `lisa-implement` (never a silent skip, never "optional", and never a bare `N/A`):

- The project genuinely has no runner configured for that platform → record a dated `platformWaivers` entry naming the locations checked and "no runner configured" as the reason, exactly like any other unsealable obligation, per the rule. This is never left as a bare `N/A` — an undated absence has no forcing function to ever get revisited.
- The runner exists but genuinely cannot decide this behavior on that platform (no camera on the simulator, no request interception, an unprovisioned provider credential) → record a dated `platformWaivers` entry with the reason, per the rule. A waiver is an IOU, never coverage.
- A runner is configured and capable but the spec cannot be added or executed in this PR (genuine technical blocker) → create a linked build-ready follow-up ticket before merge, reference it from the PR and work item, and record the blocker — the same follow-up path as the regression-spec blocker.

Either of the first two exits also gets a linked build-ready follow-up ticket, referenced from the waiver's reason, whenever the runner could reasonably be added or the limitation could reasonably be lifted — the waiver records the IOU, the ticket is what pays it down.

### 3. Generate the test

The generated test must:

- **Encode the exact verification that passed**, not a paraphrase. Same URL, same input, same assertion target.
- **Assert the observable outcome**, not implementation details. If the verification confirmed "user sees order confirmation", the test asserts that text/element is visible — not that a particular function was called.
- **Be deterministic.** No reliance on timing, network flakiness, real third-party services, or mutable shared state. Use the project's existing fixtures, factories, mocks, and seed data conventions.
- **Be self-contained.** Set up its own preconditions and clean up after itself, following the project's existing test isolation patterns.
- **Be named after the behavior, not the bug/ticket.** `displays order confirmation after checkout` not `fixes PROJ-1234`.
- **Live in the project's existing test directory** for that type. Do not create a parallel test tree.

For Playwright UI tests specifically:
- Use the project's existing `test` fixture / `page` fixture / auth helper if one exists
- Prefer role/text selectors (`getByRole`, `getByText`) over CSS/XPath — they survive markup churn
- Capture a trace or screenshot only if the project's existing tests do; do not invent a new artifact convention
- Mirror the project's existing config for base URL, retries, and test isolation

**Concrete verification (UAT) contract.** Verification *is* UAT — codifying it is
how the playthrough becomes durable. For a runtime/behavioral `feat`/`fix`: place
the codified test wherever the project's own configured e2e runner(s) already look
for tests — its own directory conventions, never a Lisa-assumed path or tool —
so CI re-runs it, and commit the evidence artifact to `evidence/<ticket>/`
(`verdict.json` + state + screenshots). For a Phaser game, drive the canvas
through the in-game verification test bridge (seed RNG, read state, inject input,
step frames) with deterministic rendering. CI's `verification-coverage` check
requires a verification-spec delta on every behavioral change. See the
`reference/verification.md` "Making verification concrete (UAT)" section.

### 3a. Drift-aware live-environment assertions

When the codified test — or the remote re-verification it encodes — runs against a **live, deployed environment**, the environment will not hold still between the original verification and any later run: deploys, out-of-band infra applies, and data churn are normal, not exceptional. Encode the verification accordingly:

- **Assert invariants, not snapshot equality.** Pin the properties that define correctness — document shape, exact paths, forbidden values/hosts, internal coherence (e.g. every URL in a discovery document uses the same host) — never a byte-for-byte diff against a captured baseline. A snapshot diff false-fails the moment the environment legitimately moves.
- **Classify drift, don't just detect it.** When observed state differs from the baseline evidence, treat that as a classification problem, and record the classification in the verdict's canonical `drift` field (`none | progress | regression | unrelated_churn`, defined by the `verdict.json` contract in `reference/verification.md`): **progress** (the change being verified, or a related fix, landed), **regression** (an invariant broke), or **unrelated churn**. Drift classified as progress or unrelated churn passes, with the environment change surfaced as evidence; only a broken invariant fails.
- **Never encode "the environment will hold still" as an implicit assumption.** Evidence capture that only makes sense if nothing changed between baseline and re-check has that assumption baked in even when no assertion states it — e.g. an OAuth discovery document whose host legitimately flipped from a provider-prefix domain to the canonical vanity host between a local baseline and a remote re-check ~30 minutes later would false-fail a snapshot verifier, while an invariant-asserting verifier passes correctly and records the drift as progress.

### 4. Run the test in isolation

Run only the new test, using whatever per-test invocation the project supports:

- Playwright: `npx playwright test path/to/new.spec.ts`
- Maestro: `maestro test .maestro/flows/new-flow.yaml`
- Vitest: `npx vitest run path/to/new.spec.ts`
- Jest: `npx jest path/to/new.test.ts`
- RSpec: `bundle exec rspec path/to/new_spec.rb`

Confirm:
1. The test PASSES against the current code (the change being shipped)
2. The test ACTUALLY FAILS without the change — observed, not reasoned about

**Step 2 is mandatory for every codified test, and "mentally reverting" does not satisfy it.** Mental reversion is the exact mechanism by which non-functional guards ship: the author believes the assertion is load-bearing, and it is not. Break the guarded property for real, run the test, and read the failure. See `.claude/rules/falsifiable-checks.md` for the four observed ways a check passes while asserting nothing.

Do it one of these ways, in order of preference:

- **Run against the pre-fix commit** (bug fixes): check out the failing commit, run the new test, see it fail, return to the fix branch.
- **Break the property in place**: delete the field, revert the line, flip the condition; run; restore. Prefer this when there is no single pre-fix commit.
- **Unit-test the checker against synthetic bad input**: required when the input is generated, schema-validated, or cached — a revert can silently fail to change what the test reads (a generator that errors leaves the previous artifact in place, and the test then "passes" on stale input).

Two properties the failure itself must have:

- It must **name the right location**. A failure that does not localize is weak evidence the test is measuring the intended thing.
- It must not be satisfiable by the test's own fixture. If the assertion can be met by data the test supplies rather than by the artifact under test, add an explicit assertion against the real artifact (the document, the config, the component's actual output) — or reuse an existing source-bound test.

Record the falsification in the codification report (what you broke, how it failed). A codified test whose failure has not been observed is reported as **unvalidated**, not as a regression gate.

### 5. Wire it into the suite

Confirm the test is picked up by the project's standard test command (the one CI runs). Run that command and confirm the count went up by exactly the number of tests added.

If the test is in a directory the standard test command excludes (e.g., E2E suite that runs separately in CI), confirm the appropriate CI workflow includes it.

### 6. Commit

Commit the test in the same PR as the change it codifies, in its own atomic commit:

- Build/feature: `test: add e2e for <behavior>`
- Bug fix: `test: add regression test for <bug behavior>`
- Performance: `test: add benchmark asserting <metric> <baseline>`

The commit message body should reference the verification it encodes (one line linking to the proof artifact or the verification report section).

### 7. Record evidence

Append to the verification report (or PR description):

```markdown
### Codified Verifications

| # | Verification | Framework | Test file | Status | Falsified by |
|---|--------------|-----------|-----------|--------|--------------|
| 1 | <description> | Playwright | `e2e/checkout.spec.ts::displays order confirmation after checkout` | PASS | removed the confirmation render → failed at `checkout.spec.ts:42` |
| 2 | <same journey, native surface> | Maestro | `.maestro/flows/checkout-confirmation.yaml` | PASS | same break → flow failed on the confirmation assertion |
```

This evidence shows the verification is now guarded. **The `Falsified by` column is required** — it names the deliberate break and the observed failure. `UNVALIDATED` is the only permitted alternative, and it means the test is not yet a regression gate.

## Output

For each empirical verification passed in:

- A new test file (or extension to an existing test file) committed to the PR
- Confirmation that the test passes against the current branch
- The test file path + test name recorded in the verification report

If codification was skipped, an explicit reason recorded in the report (one of the skip conditions above) — never silent.

## Rules

- Never claim a verification is codified without running the new test and observing it pass
- Never claim it is codified without observing it **FAIL** on a real break — mental reversion is not observation, and a test whose failure was never seen is unvalidated, not a gate (`.claude/rules/falsifiable-checks.md`)
- Never let the assertion be satisfiable by the test's own fixture instead of the artifact under test — bind it to the real document/config/output
- Never trust a revert-to-verify on generated, schema-validated, or cached input without confirming the input actually changed; a failed generator silently leaves the old artifact and the test "passes" on stale bytes
- Never disable, skip, or `.skip()` the new test "temporarily" to make CI green — fix the test or fix the underlying change
- Never use `expect(true).toBe(true)` placeholders or smoke-only assertions that don't actually exercise the verified behavior
- Never reuse the verification's manual artifact (screenshot, curl output) as a "test" — those are evidence, not regression coverage
- If the project lacks the appropriate framework, escalate via Human Action Packet rather than installing one mid-task without approval

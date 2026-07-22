---
name: lisa-codify-verification
description: "Convert empirical verification into a regression test so it never has to be re-proven manually. Runs after a verification passes — picks the appropriate test framework for the verification type (Playwright for UI/browser, integration test for API/DB/auth, benchmark for performance, etc.), generates the test, wires it into the project's test runner, and confirms it executes. Mandatory step in the verification lifecycle and in the Build/Fix/Improve flows."
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
| UI (web) | Playwright > Cypress > Selenium |
| UI (mobile) | Maestro > Detox > Playwright (mobile emulation) |
| UI (frontend, project supports multiple runners) | **ALL supported UI runners** — see "Frontend dual-runner codification" below |
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

### 2a. Frontend dual-runner codification (non-demotable)

For **frontend work** — any verification whose validation journey exercised a user-facing UI surface — codification is not one-runner-or-the-other. After the validation journey is complete and verified, the verified behavior MUST be codified in **every UI runner the project supports**:

1. **A Playwright spec in the project's Playwright test runner** (where its web e2e tests live, e.g. `tests/e2e/**` / `e2e/**`) — required whenever the project has a Playwright (or equivalent web e2e) harness.
2. **A Maestro flow in the project's Maestro test runner** — required whenever the project supports Maestro. Detect support by any of: a `.maestro/` directory (flows live in `.maestro/flows/`), a `maestro:test` script in `package.json`, or a Maestro CI workflow (e.g. `maestro-native-e2e`). Wire the new flow where the runner picks it up (`maestro test .maestro/flows`), tagging per the project's tier convention (e.g. `smoke`) when one exists.

Both artifacts encode the SAME verified journey — the Playwright spec drives the web surface, the Maestro flow drives the native surface. One is not a substitute for the other: they guard different platforms of the same behavior.

Permitted exits, mirroring the regression-spec rule in `lisa-implement` (never a silent skip, never "optional"):

- The project genuinely has no runner of that kind (no web e2e harness, or no Maestro support by the detection above) → record the checked locations and the absence in the codification evidence; that runner is N/A.
- A runner is supported but the flow/spec cannot be added or executed in this PR (genuine technical blocker) → create a linked build-ready follow-up ticket before merge, reference it from the PR and work item, and record the blocker — the same follow-up path as the regression-spec blocker.

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
the codified test where the project's e2e/Playwright tests live (`tests/e2e/**`)
so CI re-runs it, and commit the evidence artifact to `evidence/<ticket>/`
(`verdict.json` + state + screenshots). For a Phaser game, drive the canvas
through the in-game verification test bridge (seed RNG, read state, inject input,
step frames) with deterministic rendering. CI's `verification-coverage` check
requires a verification-spec delta on every behavioral change. See the
`reference/verification.md` "Making verification concrete (UAT)" section.

### 3a. Drift-aware live-environment assertions

When the codified test — or the remote re-verification it encodes — runs against a **live, deployed environment**, the environment will not hold still between the original verification and any later run: deploys, out-of-band infra applies, and data churn are normal, not exceptional. Encode the verification accordingly:

- **Assert invariants, not snapshot equality.** Pin the properties that define correctness — document shape, exact paths, forbidden values/hosts, internal coherence (e.g. every URL in a discovery document uses the same host) — never a byte-for-byte diff against a captured baseline. A snapshot diff false-fails the moment the environment legitimately moves.
- **Classify drift, don't just detect it.** When observed state differs from the baseline evidence, treat that as a classification problem, and record the classification in the verdict: **progress** (the change being verified, or a related fix, landed), **regression** (an invariant broke), or **unrelated churn**. Drift classified as progress or unrelated churn passes, with the environment change surfaced as evidence; only a broken invariant fails.
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
2. The test would have FAILED before the change (sanity check by mentally reverting, or for bug fixes, by running against the pre-fix commit if cheap)

For a bug fix, step 2 is mandatory and easy: check out the failing commit, run the new test, see it fail, return to the fix branch. This proves the test actually guards the regression.

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

| # | Verification | Framework | Test file | Status |
|---|--------------|-----------|-----------|--------|
| 1 | <description> | Playwright | `e2e/checkout.spec.ts::displays order confirmation after checkout` | PASS |
| 2 | <same journey, native surface> | Maestro | `.maestro/flows/checkout-confirmation.yaml` | PASS |
```

This evidence shows the verification is now guarded.

## Output

For each empirical verification passed in:

- A new test file (or extension to an existing test file) committed to the PR
- Confirmation that the test passes against the current branch
- The test file path + test name recorded in the verification report

If codification was skipped, an explicit reason recorded in the report (one of the skip conditions above) — never silent.

## Rules

- Never claim a verification is codified without running the new test and observing it pass
- Never disable, skip, or `.skip()` the new test "temporarily" to make CI green — fix the test or fix the underlying change
- Never use `expect(true).toBe(true)` placeholders or smoke-only assertions that don't actually exercise the verified behavior
- Never reuse the verification's manual artifact (screenshot, curl output) as a "test" — those are evidence, not regression coverage
- If the project lacks the appropriate framework, escalate via Human Action Packet rather than installing one mid-task without approval

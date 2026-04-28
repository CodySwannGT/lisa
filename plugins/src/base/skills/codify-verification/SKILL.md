---
name: codify-verification
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

### 2. Map verification type → framework

| Verification type | Preferred framework (use whichever the project already has) |
|---|---|
| UI (web) | Playwright > Cypress > Selenium |
| UI (mobile) | Maestro > Detox > Playwright (mobile emulation) |
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

### 4. Run the test in isolation

Run only the new test, using whatever per-test invocation the project supports:

- Playwright: `npx playwright test path/to/new.spec.ts`
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

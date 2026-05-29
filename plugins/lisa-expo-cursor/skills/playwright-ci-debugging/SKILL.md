---
name: playwright-ci-debugging
description: Debug Playwright E2E tests that pass locally but fail in CI (or vice versa) in Expo web projects. Covers local reproduction, network interception, CI environment discovery, commit SHA verification, and robust interaction patterns that eliminate flake. Use this skill when a Playwright test is failing in CI, a test is flaky, a PR is blocked by E2E checks, or you need to investigate CI-specific test behavior. Trigger on mentions of CI failure, failing Playwright test, flaky E2E test, or debugging E2E in CI.
---

# Debugging Playwright E2E Failures in CI

The authoring-side rules (selectors, testID forwarding, naming) are in the `playwright-selectors` skill. This skill is for the other half of the job: when a test fails in CI and you need to find out why.

## Debugging Order

When a Playwright E2E test fails in CI, follow this exact order.

### 1. Reproduce locally first — before anything else

Start the project's dev server, then run the failing test in isolation:

```bash
# Start the dev server (discover the script from package.json — commonly `start`, `dev`, `start:dev`, or `web`)
<pkg-manager> run <dev-script>

# In another terminal, run the exact failing test with no retries
BASE_URL=http://localhost:8081/ npx playwright test <file> --grep "<test name>" --retries=0
```

`--retries=0` is critical — retries mask flake. `--grep` isolates the single failing test so you're not waiting on a full suite.

**Do NOT read source code, CI logs, or theorize until you can reproduce locally.** Most CI failures reproduce locally if you run the same test against the same served build. Guessing from logs is slow and usually wrong.

### 2. Intercept the network request

When a test involves an API call, set up a Playwright response listener and inspect the status code and response body. A 400/500 response tells you everything.

```typescript
page.on("response", async (response) => {
  if (response.url().includes("/api/")) {
    console.log(response.status(), response.url(), await response.text());
  }
});
```

UI failures are often downstream of a failed API call. The network log is cheaper evidence than the DOM.

### 3. If it doesn't reproduce locally, understand the CI environment first

CI runs against a different environment than your laptop. Before changing anything:

- Find the CI job that runs Playwright (usually `.github/workflows/*.yml`).
- Identify which `.env.*` file it loads — this varies by target branch (e.g., dev → `.env.development`, staging → `.env.staging`).
- Note that CI typically builds a static web bundle (`expo export --platform web`) then serves it on `localhost:8081` via `serve dist`. It is NOT hitting your dev server. Timing, bundling, and env vars all differ.
- Reproduce the CI setup locally: build the static bundle, serve it the same way, then run the test. If it now fails locally, you've isolated an env/build difference.

### 4. Verify commit SHA before trusting CI results

After pushing, confirm the CI run's `headSha` matches your latest commit:

```bash
gh run list --branch "$(git branch --show-current)" --limit 1 --json headSha,status,conclusion
git rev-parse HEAD
```

Bots (review-response, auto-update, dependabot) can push commits between your push and the CI run, overwriting your changes. A green check on a stale SHA tells you nothing about your fix.

## Patterns That Eliminate Flake

### Never use fixed waits before interactions

`waitForTimeout()` as the sole wait before a click is a silent failure waiting to happen — animations and rendering take variable time, especially on slower CI runners. Poll for the expected state, then act.

```typescript
// BAD — fixed wait; click silently fails if element not yet visible
await clickVisibleText(page, "Translate");
await page.waitForTimeout(1000);
await clickVisibleText(page, "Spanish");

// GOOD — poll for visibility, then click
await clickVisibleText(page, "Translate");
await expect
  .poll(() => hasVisibleText(page, "Spanish"), { timeout: TIMEOUT.expect })
  .toBe(true);
await clickVisibleText(page, "Spanish");
```

### Never silently swallow click return values

Any helper that can return `false` on a missed click (e.g., `clickVisibleText`) should either have its return value asserted or be preceded by a visibility poll. A click that silently returns `false` is a hidden test bug — the test proceeds as if the click happened and fails downstream with a confusing error.

```typescript
// BAD — return value ignored; test continues on failed click
await clickVisibleText(page, "Submit");

// GOOD — assert the click happened
expect(await clickVisibleText(page, "Submit")).toBe(true);

// GOOD — precede with visibility poll
await expect
  .poll(() => hasVisibleText(page, "Submit"), { timeout: TIMEOUT.expect })
  .toBe(true);
await clickVisibleText(page, "Submit");
```

### E2E tests must not depend on external API success

Any test that calls an external service (AWS Bedrock, third-party APIs, rate-limited providers) must handle the failure case. Tests should verify UI behavior, not external service uptime. If an external call might fail, the test must accept both outcomes or skip the dependent assertion.

```typescript
// BAD — assumes translation always succeeds
await expect
  .poll(() => hasVisibleText(page, "Show Original"), { timeout: TIMEOUT.expect })
  .toBe(true);

// GOOD — handle both success and failure
await expect
  .poll(
    async () =>
      (await hasVisibleText(page, "Show Original")) ||
      (await hasVisibleText(page, "Translate")),
    { timeout: TIMEOUT.expect }
  )
  .toBe(true);

const translated = await hasVisibleText(page, "Show Original");
if (!translated) return; // External API failed; skip downstream assertions
```

The alternative — mocking the external call — is a valid approach when the goal is to test the UI's handling of a successful response. Pick one strategy per test and commit to it.

### E2E assertions must not depend on specific test data

Do not assert specific text (e.g., "No lists detected") when the test user's data state varies across environments. If a zero-row state could have different empty-state messages depending on the user's data, either check for multiple possible states or skip the assertion entirely.

See the `playwright-selectors` skill's "Data independence" section for authoring patterns that avoid this class of bug in the first place.

## Escalation

If you've worked through steps 1–4 and still cannot explain the failure:

- Do NOT disable, skip, or `.fixme` the test to unblock the PR.
- Do NOT use `--admin` or force-merge to bypass the check.
- Escalate to a human with: the failing test name, your local reproduction attempt, the network trace, and the commit SHA verification. A real flake that cannot be root-caused is a legitimate reason to pause; it is never a reason to merge red.

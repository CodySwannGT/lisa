# Empirical Verification

This repository supports AI agents as first-class contributors.

This file is the operational contract that defines how agents plan work, execute changes, verify outcomes, and escalate when blocked.

If anything here conflicts with other repo docs, treat this file as authoritative for agent behavior.

---

## Core Principle

Agents must close the loop between code changes and observable system behavior.

No agent may claim success without evidence from runtime verification.

Never assume something works because the code "looks correct." Run a command, observe the output, compare to expected result.

---

## Roles

### Builder Agent

Implements the change in code and infrastructure.

### Verifier Agent

Acts as the end user (human user, API client, operator, attacker, or system) and produces proof artifacts.

Verifier Agent must be independent from Builder Agent when possible.

### Human Overseer

Approves risky operations, security boundary crossings, and any work the agents cannot fully verify.

---

## Verification Levels

Agents must label every task outcome with exactly one of these:

- **FULLY VERIFIED**: Verified in the target environment with end-user simulation and captured artifacts.
- **PARTIALLY VERIFIED**: Verified in a lower-fidelity environment or with incomplete surfaces, with explicit gaps documented.
- **UNVERIFIED**: Verification blocked, human action required, no claim of correctness permitted.

---

## Verification Types Quick Reference

| Type | Use Case | Example |
|------|----------|---------|
| `test` | Unit/integration tests | `npm test -- path/to/file.spec.ts` |
| `api-test` | API endpoints | `curl -s localhost:3000/api/endpoint` |
| `test-coverage` | Coverage thresholds | `npm run test:cov -- --collectCoverageFrom=...` |
| `ui-recording` | UI changes | Start local server; recorded session with Playwright/Maestro/Chrome Browser |
| `documentation` | Doc changes | `grep "expected" path/to/doc.md` |
| `manual-check` | Config/setup | `cat config.json \| jq '.setting'` |

---

## Verification Surfaces

Agents may only self-verify when the required verification surfaces are available.

Verification surfaces include:

### Action Surfaces

- Build and test execution
- Deployment and rollback
- Infrastructure apply and drift detection
- Feature flag toggling
- Data seeding and state reset
- Load generation and fault injection

### Observation Surfaces

- Application logs (local and remote)
- Metrics (latency, errors, saturation, scaling)
- Traces and correlation IDs
- Database queries and schema inspection
- Browser and device automation
- Queue depth and consumer execution visibility
- CDN headers and edge behavior
- Artifact capture (video, screenshots, traces, diffs)

If a required surface is unavailable, agents must follow the Escalation Protocol.

---

## Tooling Surfaces

Many verification steps require tools that may not be available by default.

Tooling surfaces include:

- Required CLIs (cloud, DB, deployment, observability)
- Required MCP servers and their capabilities
- Required internal APIs (feature flags, auth, metrics, logs, CI)
- Required credentials and scopes for those tools

If required tooling is missing, misconfigured, blocked, undocumented, or inaccessible, agents must treat this as a verification blocker and escalate before proceeding.

---

## Proof Artifacts Requirements

Every completed task must include proof artifacts stored in the PR description or linked output location.

Proof artifacts must be specific and re-checkable.

Examples of acceptable proof:

- Playwright video and screenshots for UI work
- HTTP trace and response payload for API work
- Before/after DB query outputs for data work
- Metrics snapshots for autoscaling
- Log excerpts with correlation IDs for behavior validation
- Load test results showing threshold behavior

Statements like "works" or "should work" are not acceptable.

---

## Standard Workflow

Agents must follow this sequence unless explicitly instructed otherwise:

1. Restate goal in one sentence.
2. Identify the end user of the change.
3. Choose the verification method that matches the end user.
4. List required verification surfaces and required tooling surfaces.
5. Confirm required surfaces are available.
6. Implement the change.
7. Run verification from the end-user perspective.
8. Collect proof artifacts.
9. Summarize what changed, what was verified, and remaining risk.
10. Label the result with a verification level.

---

## Task Completion Rules

1. **Run the proof command** before marking any task complete
2. **Compare output** to expected result
3. **If verification fails**: Fix and re-run, don't mark complete
4. **If verification blocked** (missing Docker, services, etc.): Mark as blocked, not complete
5. **Must not be dependent on CI/CD** if necessary, you may use local deploy methods found in `package.json`, but the verification methods must be listed in the pull request and therefore cannot be dependent on CI/CD completing

---

## End-User Verification Patterns

Agents must choose the pattern that fits the task.

### UI and UX Feature or Bug

End user: human in browser or native device.

Required proof:

- Automated session recording (Playwright preferred)
- Screenshots of key states
- Network calls and console errors captured when relevant

#### Example: UI Feature (Playwright browser verification)

**Task**: Add logout button to the dashboard header

**Wrong verification**: "I added the button component to the header"

**Correct verification** -- use Playwright to interact with the app as a real user:

```bash
npx playwright test --headed -g "logout button" 2>&1 | tail -20
```

Or for ad-hoc verification without a test file, use the Playwright CLI browser tools or `browser_run_code`:

```javascript
async (page) => {
  await page.goto('http://localhost:3000/dashboard');
  const logoutButton = page.getByRole('button', { name: 'Logout' });
  await logoutButton.waitFor({ state: 'visible' });
  await logoutButton.click();
  await page.waitForURL('**/login');
  return { url: page.url(), title: await page.title() };
}
```

**Expected**: Browser navigates to `/login` after clicking the logout button

#### Example: UI Visual/Behavioral (Screenshot comparison)

**Task**: Fix mobile nav menu not closing after link click

**Wrong verification**: "I added an onClick handler that closes the menu"

**Correct verification** -- open a browser and perform the exact user action:

```javascript
async (page) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('http://localhost:3000');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'About' }).click();
  const menu = page.locator('[data-testid="mobile-nav"]');
  const isVisible = await menu.isVisible();
  return { menuVisibleAfterClick: isVisible, url: page.url() };
}
```

**Expected**: `menuVisibleAfterClick: false`, url contains `/about`

### API, GraphQL, or RPC Change

End user: API client.

Required proof:

- Curl or a minimal script checked into the repo or attached to PR
- Response payload showing schema and expected data
- Negative case if applicable (auth failure, validation error)

#### Example: API Endpoint (E2E with curl)

**Task**: Add health check endpoint

**Wrong verification**: "I added the route handler"

**Correct verification**:

```bash
curl -s http://localhost:3000/health | jq '.status'
```

**Expected**: `"ok"`

#### Example: API Workflow (Multi-step E2E)

**Task**: Add user registration endpoint

**Wrong verification**: "The route handler creates a user record"

**Correct verification** -- write a small client script that exercises the full flow:

```bash
# Create user
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test User"}')
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')
echo "Create status: $HTTP_CODE"
echo "Create body: $BODY"

# Verify the user exists by fetching it back
USER_ID=$(echo "$BODY" | jq -r '.id')
curl -s "http://localhost:3000/api/users/$USER_ID" | jq '.email'
```

**Expected**: Create returns `201`, fetch returns `"test@example.com"`

### Authentication and Authorization

End user: user with specific identity and role.

Required proof:

- Verification across at least two roles (allowed and denied)
- Explicit status codes or UI outcomes
- Artifact showing enforcement (screenshots or HTTP traces)

#### Example: API with Authentication (E2E flow)

**Task**: Add rate limiting to the search endpoint

**Wrong verification**: "I added the rate limiter middleware"

**Correct verification** -- actually hit the rate limit:

```bash
# Fire requests until rate limited
for i in $(seq 1 25); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TEST_TOKEN" \
    "http://localhost:3000/api/search?q=test")
  echo "Request $i: $CODE"
done | tail -5
```

**Expected**: First requests return `200`, later requests return `429`

### Database Migration or Backfill

End user: application and operators.

Required proof:

- Schema verification
- Backfill verification with before/after counts
- Rollback plan validated when possible

#### Example: Database Migration

**Task**: Add `last_login_at` column to users table

**Wrong verification**: "The migration file creates the column"

**Correct verification**:

```bash
# Run migration
npm run migration:run

# Verify column exists and has correct type
psql "$DATABASE_URL" -c "\d users" | grep last_login_at
```

**Expected**: `last_login_at | timestamp with time zone |`

### Background Jobs, Queues, Events

End user: system operator and downstream consumers.

Required proof:

- Evidence of enqueue, processing, and final state change
- Queue depth and worker logs
- Idempotency check when relevant

### Caching and Performance

End user: API consumer or UI user.

Required proof:

- Measured latency or throughput before and after
- Cache hit evidence (logs, metrics, key inspection)
- TTL behavior where relevant

### Infrastructure and Autoscaling

End user: operator and workload.

Required proof:

- Load simulation that triggers scaling or behavior change
- Metrics showing scale-out and scale-in
- Evidence of stability (error rates, latency) during the event

### Security Fixes

End user: attacker and defender.

Required proof:

- Reproduction of exploit pre-fix
- Demonstration of exploit failure post-fix
- Evidence of safe handling (sanitization, rejection, rate limit)

---

## Escalation Protocol

Agents must escalate when verification is blocked, ambiguous, or requires tools that are missing or inaccessible.

Common blockers:

- VPN required
- MFA, OTP, SMS codes
- Hardware token requirement
- Missing CLI, MCP server, or internal API required for verification
- Missing documentation on how to access required tooling
- Production-only access gates
- Compliance restrictions

When blocked, agents must do the following:

1. Identify the exact boundary preventing verification.
2. Identify which verification surfaces and tooling surfaces are missing.
3. Attempt safe fallback verification (local, staging, mocks) and label it clearly.
4. Declare verification level as PARTIALLY VERIFIED or UNVERIFIED.
5. Produce a Human Action Packet.
6. Pause until explicit human confirmation or tooling is provided.

Agents must never proceed past an unverified boundary without surfacing it to the human overseer.

### Human Action Packet Format

Agents must provide:

- What is blocked and why
- What tool or access is missing
- Exactly what the human must do
- How to confirm completion
- What the agent will do immediately after
- What artifacts the agent will produce after access is restored

Example:

- Blocked: Cannot reach DB, VPN required.
- Missing: `psql` access to `db.host` and internal logs viewer MCP.
- Human steps: Connect VPN "CorpVPN", confirm access by running `nc -vz db.host 5432`, provide MCP endpoint or credentials.
- Confirmation: Reply "VPN ACTIVE" and "MCP READY".
- Next: Agent runs migration verification script and captures schema diff and query outputs.

Agents must pause until explicit human confirmation.

Agents must never bypass security controls to proceed.

---

## Environments and Safety Rules

### Allowed Environments

- Local development
- Preview environments
- Staging
- Production read-only, only if explicitly approved and configured for safe access

### Prohibited Actions Without Human Approval

- Writing to production data stores
- Disabling MFA or security policies
- Modifying IAM roles or firewall rules beyond scoped change requests
- Running destructive migrations
- Triggering external billing or payment flows

If an operation is irreversible or risky, escalate first.

---

## Repository Conventions

### Code Style and Structure

- Follow existing patterns in the codebase.
- Do not introduce new frameworks or architectural patterns without justification in the PR.
- Prefer small, reviewable changes with clear commit messages.

### Tests

- Run the fastest relevant test suite locally.
- Expand to integration or end-to-end tests based on impact.
- If tests are flaky or slow, document it and propose a follow-up.

### Logging and Observability

- Include correlation IDs where supported.
- Prefer structured logs over ad hoc strings.
- For behavior changes, include log evidence in proof artifacts.

---

## Artifact Storage and PR Requirements

Every PR must include:

- Goal summary
- Verification level
- Proof artifacts links or embedded outputs
- How to reproduce verification locally
- Known limitations and follow-up items

Preferred artifact locations:

- PR description
- Repo-local scripts under `scripts/verification/`
- CI artifacts linked from the build

---

## Quick Commands

Document the canonical commands agents should use here.

Replace placeholders with real commands.

### Local

- Install: `REPLACE_ME`
- Run app: `REPLACE_ME`
- Run unit tests: `REPLACE_ME`
- Run integration tests: `REPLACE_ME`
- Lint and format: `REPLACE_ME`

### UI Verification

- Playwright tests: `REPLACE_ME`
- Record a flow: `REPLACE_ME`

### API Verification

- Example curl: `REPLACE_ME`
- GraphQL query runner: `REPLACE_ME`

### Deployment

- Deploy to preview: `REPLACE_ME`
- Deploy to staging: `REPLACE_ME`
- Rollback: `REPLACE_ME`

### Observability

- Tail logs: `REPLACE_ME`
- Query metrics: `REPLACE_ME`
- Trace lookup: `REPLACE_ME`

---

## Definition of Done

A task is done only when:

- End user is identified
- Verification pattern is applied
- Required verification surfaces and tooling surfaces are used or explicitly unavailable
- Proof artifacts are captured
- Verification level is declared
- Risks and gaps are documented

If any of these are missing, the work is not complete.

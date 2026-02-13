# Empirical Verification

Every task and plan requires a **proof command** - a single command that empirically demonstrates the work is done.

## Core Principle

Never assume something works because the code "looks correct." Run a command, observe the output, compare to expected result.

## Verification Types

| Type | Use Case | Example |
|------|----------|---------|
| `test` | Unit/integration tests | `npm test -- path/to/file.spec.ts` |
| `api-test` | API endpoints | `curl -s localhost:3000/api/endpoint` |
| `test-coverage` | Coverage thresholds | `npm run test:cov -- --collectCoverageFrom=...` |
| `ui-recording` | UI changes | Start local server; recorded session with Playwright/Maestro/Chrome Browser  |
| `documentation` | Doc changes | `grep "expected" path/to/doc.md` |
| `manual-check` | Config/setup | `cat config.json \| jq '.setting'` |

## Task Completion Rules

1. **Run the proof command** before marking any task complete
2. **Compare output** to expected result
3. **If verification fails**: Fix and re-run, don't mark complete
4. **If verification blocked** (missing Docker, services, etc.): Mark as blocked, not complete
5. **Must not be dependent on CI/CD** if necessary, you may use local deploy methods found in `package.json`, but the verification methods must be listed in the pull request and therefore cannot be dependent on CI/CD completing

## Examples

### API Endpoint (E2E with curl)

**Task**: Add health check endpoint

**Wrong verification**: "I added the route handler"

**Correct verification**:
```bash
curl -s http://localhost:3000/health | jq '.status'
```
**Expected**: `"ok"`

### API Workflow (Multi-step E2E)

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

### UI Feature (Playwright browser verification)

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

### UI Visual/Behavioral (Screenshot comparison)

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

### API with Authentication (E2E flow)

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

### Database Migration

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

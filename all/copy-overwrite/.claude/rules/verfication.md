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

## Example

**Task**: Add health check endpoint

**Wrong verification**: "I added the route handler"

**Correct verification**:
```bash
curl -s http://localhost:3000/health | jq '.status'
```
**Expected**: `"ok"`

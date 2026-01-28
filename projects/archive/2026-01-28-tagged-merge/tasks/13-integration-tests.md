# Task 13: Integration Tests

## Description

Write integration tests that verify tagged-merge works correctly with the full Lisa apply process.

## File to Create

`tests/integration/strategies/tagged-merge.integration.test.ts`

## Key Responsibilities

1. Test strategy in actual file system (not mocks)
2. Test with real tagged-merge/package.json files from all project types
3. Test strategy applied through strategy registry
4. Test with actual Lisa directory structure
5. Test cascade/inheritance with parent types
6. Test manifest recording
7. Test backup creation
8. Test validation mode
9. Test non-interactive mode (yesMode)

## Acceptance Criteria

- [ ] Integration tests verify end-to-end functionality
- [ ] Tests use real file system operations
- [ ] Tests verify registry integration
- [ ] Tests verify manifest updates

## Verification Command

```bash
bun test tests/integration/strategies/tagged-merge.integration.test.ts --reporter=verbose
```

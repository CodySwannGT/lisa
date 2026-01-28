# Task 08: Unit Tests - Core Functionality

## Description

Write comprehensive unit tests for core functionality: strategy initialization, file operations, and basic flow.

## File to Create

`tests/unit/strategies/tagged-merge.spec.ts`

## Key Responsibilities

1. Test strategy name is "tagged-merge"
2. Test copying when destination doesn't exist
3. Test skipping when files are identical
4. Test handling of missing closing tags (error)
5. Test error handling for invalid JSON
6. Test dryRun mode (no file modifications)
7. Test context callbacks are invoked correctly (recordFile, backupFile)
8. Test normalization comparison logic

## Acceptance Criteria

- [ ] All core flow tests pass
- [ ] Error cases are tested
- [ ] Dry-run mode is tested
- [ ] Context callbacks are verified as called

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "core|initialization|copies|skips" --reporter=verbose
```

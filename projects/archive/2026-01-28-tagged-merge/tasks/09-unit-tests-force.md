# Task 09: Unit Tests - Force Behavior

## Description

Write unit tests for force behavior (//lisa-force-* tags).

## File

`tests/unit/strategies/tagged-merge.spec.ts`

## Key Responsibilities

1. Test force section replaced entirely
2. Test project modifications to force section are ignored
3. Test multiple force sections in same object
4. Test force section followed by defaults section
5. Test force section followed by untagged content
6. Test untagged content preserved when force section modified
7. Test tags preserved in output
8. Test force with empty section
9. Test force with complex nested values

## Acceptance Criteria

- [ ] Force behavior tests provide 90%+ coverage of force logic
- [ ] All edge cases for force behavior are tested
- [ ] Tests verify output structure matches expectations

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "force" --reporter=verbose
```

# Task 11: Unit Tests - Array Merge Behavior

## Description

Write unit tests for array merge behavior (//lisa-merge-* tags).

## File

`tests/unit/strategies/tagged-merge.spec.ts`

## Key Responsibilities

1. Test arrays combined from both Lisa and project
2. Test deduplication by JSON.stringify() equality
3. Test duplicate detection for strings, objects, numbers
4. Test order: Lisa items first, project items second
5. Test empty arrays in Lisa or project
6. Test missing array in project (use Lisa's)
7. Test missing array in Lisa (keep project's)
8. Test non-array values (error or appropriate handling)
9. Test mixed array and non-array items (error)
10. Test merge with deeply nested objects in array

## Acceptance Criteria

- [ ] Array merge tests provide 90%+ coverage of merge logic
- [ ] Deduplication tests verify JSON.stringify() equality
- [ ] Order is verified in tests
- [ ] Edge cases for empty/missing arrays tested

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "merge" --reporter=verbose
```

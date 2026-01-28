# Task 12: Unit Tests - Complex Scenarios

## Description

Write unit tests for complex scenarios with multiple tags, nested structures, and edge cases.

## File

`tests/unit/strategies/tagged-merge.spec.ts`

## Key Responsibilities

1. Test package.json with all three behaviors (scripts, devDependencies, engines, trustedDependencies)
2. Test multiple tags in same object in various orders
3. Test untagged content interspersed between tagged sections (preserved at end)
4. Test deeply nested tagged sections
5. Test tags with underscores, hyphens in category names
6. Test very large JSON files
7. Test inheritance scenarios (parent/child type conflicts)
8. Test malformed JSON in source or dest
9. Test permission errors (read/write failures)
10. Test concurrent modifications (race conditions)

## Acceptance Criteria

- [ ] Complex scenario tests cover edge cases
- [ ] Inheritance scenarios are tested
- [ ] Error scenarios are tested with proper error messages
- [ ] Test coverage exceeds 90%

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "complex|scenario|inheritance" --reporter=verbose
```

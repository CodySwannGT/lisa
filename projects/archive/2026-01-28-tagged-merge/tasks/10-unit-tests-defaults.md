# Task 10: Unit Tests - Defaults Behavior

## Description

Write unit tests for defaults behavior (//lisa-defaults-* tags).

## File

`tests/unit/strategies/tagged-merge.spec.ts`

## Key Responsibilities

1. Test defaults section preserved when project has it
2. Test defaults section added when project doesn't have it
3. Test multiple defaults sections
4. Test defaults section with nested objects
5. Test project can completely override defaults section
6. Test tags preserved in output
7. Test defaults with empty section
8. Test mixed with force and merge sections

## Acceptance Criteria

- [ ] Defaults behavior tests provide 90%+ coverage of defaults logic
- [ ] Tests verify project overrides work correctly
- [ ] Tests verify Lisa defaults are added when missing

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "defaults" --reporter=verbose
```

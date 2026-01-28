# Task 05: Array Merge Behavior Implementation

## Description

Implement the "merge" behavior for arrays where Lisa and project items are combined with deduplication.

## Key Responsibilities

1. Identify all `//lisa-merge-*` tagged sections
2. For each merge section:
   - Extract array from Lisa section
   - Extract array from project section (if exists)
   - Combine both arrays
   - Deduplicate by JSON.stringify() equality
   - Preserve order: Lisa items first, then project items
3. Handle non-array values (error or skip)
4. Handle missing arrays from either source

## Acceptance Criteria

- [ ] Arrays are combined from both Lisa and project
- [ ] Items are deduplicated using JSON.stringify() equality
- [ ] Deduplication preserves first occurrence
- [ ] Lisa items appear before project items
- [ ] Tag structure is preserved
- [ ] Order of items within each array is maintained

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "merge" --reporter=verbose
```

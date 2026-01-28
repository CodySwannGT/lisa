# Task 07: Strategy Registration and Configuration

## Description

Register the new TaggedMergeStrategy in the strategy registry and add it to the list of available copy strategies.

## Files to Modify

- `src/strategies/index.ts`
- `src/core/config.ts`

## Key Responsibilities

1. Import TaggedMergeStrategy in `src/strategies/index.ts`
2. Export TaggedMergeStrategy class
3. Instantiate TaggedMergeStrategy in StrategyRegistry constructor
4. Add "tagged-merge" to CopyStrategy type union in `src/core/config.ts`
5. Add "tagged-merge" to COPY_STRATEGIES array after "merge"

## Acceptance Criteria

- [ ] TaggedMergeStrategy is imported in index.ts
- [ ] TaggedMergeStrategy is exported from index.ts
- [ ] TaggedMergeStrategy is instantiated in StrategyRegistry
- [ ] "tagged-merge" is added to CopyStrategy type
- [ ] "tagged-merge" is added to COPY_STRATEGIES array
- [ ] Strategy can be retrieved via registry.get("tagged-merge")

## Verification Command

```bash
bun run build && bun test tests/unit/strategies/ -t "registry|registration"
```

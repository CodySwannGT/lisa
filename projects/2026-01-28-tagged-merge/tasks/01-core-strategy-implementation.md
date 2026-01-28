# Task 01: TaggedMergeStrategy Core Implementation

## Description

Create the core strategy class that implements `ICopyStrategy` interface in `src/strategies/tagged-merge.ts`. This is the foundation for parsing tagged sections and applying merge logic.

## Key Responsibilities

1. Implement `apply()` method signature from ICopyStrategy
2. Handle file existence checks (copy if dest doesn't exist)
3. Parse both source (Lisa) and destination (project) JSON files
4. Implement tag parsing logic to identify `//lisa-force-*`, `//lisa-defaults-*`, and `//lisa-merge-*` tags
5. Extract content between opening and closing tags
6. Apply merge logic based on behavior type
7. Preserve key ordering from Lisa template
8. Reconstruct JSON maintaining order
9. Compare normalized versions to detect changes
10. Backup and write modified files

## Acceptance Criteria

- [ ] Strategy correctly implements ICopyStrategy interface
- [ ] Strategy name is "tagged-merge"
- [ ] Returns FileOperationResult with appropriate action ("copied", "skipped", or "merged")
- [ ] Respects config.dryRun flag
- [ ] Calls context.backupFile() before modifying files
- [ ] Calls context.recordFile() for all files processed
- [ ] Handles file I/O errors gracefully

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts --reporter=verbose
```

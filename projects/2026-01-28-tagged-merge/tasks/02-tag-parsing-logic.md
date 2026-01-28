# Task 02: Tag Parsing Logic Implementation

## Description

Implement the tag parsing logic that extracts tagged sections from JSON files and identifies their behavior type.

## Key Responsibilities

1. Create parser that identifies all comment keys (keys starting with "//")
2. Parse tag format: `//lisa-<behavior>-<category>`
3. Validate tag format and extract behavior type (force/defaults/merge) and category name
4. Extract closing tag: `//end-lisa-<behavior>-<category>`
5. Build map of tagged sections with:
   - Opening tag key
   - Closing tag key
   - Behavior type
   - Content keys between tags
6. Preserve order of tags as they appear in template
7. Handle multiple tags in same object
8. Handle nested tags at any level (based on existing tagged-merge/package.json files)

## Acceptance Criteria

- [ ] Parser correctly identifies all tag patterns
- [ ] Parser validates that closing tags match opening tags
- [ ] Parser extracts behavior type correctly
- [ ] Parser builds accurate map of tagged sections preserving order
- [ ] Parser handles nested tags
- [ ] Parser throws descriptive errors for malformed tags
- [ ] Parser preserves key ordering during extraction

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "parsing" --reporter=verbose
```

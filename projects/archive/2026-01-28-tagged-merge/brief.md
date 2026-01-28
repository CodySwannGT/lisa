# Tagged Merge Strategy Implementation

## Overview

Implement a new `tagged-merge/` copy strategy for Lisa that enables fine-grained control over JSON file sections through comment-based tags. This allows Lisa to manage specific sections (like CI/CD scripts or required dependencies) while permitting projects to customize or extend other sections.

## Problem Statement

Current strategies are limited:
- `merge/` applies global deep merge: either Lisa's defaults win or project's values win
- No way to force certain values while allowing project overrides in other areas
- No way to merge array values (e.g., `trustedDependencies`)

The tagged-merge strategy solves this by allowing multiple tagged regions within a single JSON file, each with different merge semantics.

## Design

### Tag Format

Tags use JSON comment keys with consistent naming: `//lisa-<behavior>-<category>`

```json
{
  "//lisa-force-scripts": "Description of what Lisa manages here",
  "script1": "value1",
  "script2": "value2",
  "//end-lisa-force-scripts": "",
  "custom-script": "user's own script"
}
```

### Behaviors

| Behavior | Tag Pattern | Behavior |
|----------|-------------|----------|
| **Force** | `//lisa-force-*` | Lisa replaces entire section; project changes are ignored |
| **Defaults** | `//lisa-defaults-*` | Lisa provides values; project can override entire section |
| **Merge** | `//lisa-merge-*` | For arrays: combine Lisa's items + project's items (deduplicated) |

### Closing Tags

Every opening tag must have a matching closing tag: `//end-lisa-<behavior>-<category>`

## Implementation Plan

### Phase 1: Core Strategy Class

**File**: `src/strategies/tagged-merge.ts`

Create a new strategy class that:

1. **Parse tagged sections** from Lisa's JSON template
   - Identify all `//lisa-<behavior>-*` tags
   - Extract content between opening and closing tags
   - Track order and behavior for each section

2. **Parse project's JSON** to identify existing tags
   - Build a map of existing tagged sections
   - Preserve untagged content

3. **Merge logic per behavior**:
   - **Force**: Replace entire section with Lisa's version
   - **Defaults**: Keep project's section if exists, add Lisa's if missing
   - **Merge** (arrays): Combine both, deduplicate by JSON value equality

4. **Preserve order**
   - Maintain JSON key ordering (most modern tools preserve this)
   - Keep untagged content in original position
   - Maintain tag order from Lisa template

### Phase 2: Integration

**File**: `src/strategies/index.ts`

Register the new strategy in the strategies object.

### Phase 3: Configuration

Update `src/core/config.ts` to support both `merge/` and `tagged-merge/` directories:
- Detect which strategy to use based on directory structure
- Default to `merge/` for backward compatibility
- Use `tagged-merge/` if directory exists

### Phase 4: File Structure

Create initial `tagged-merge/` directories for all project types and migrate existing merge/package.json files.

### Phase 5: Testing

Create comprehensive test suite in `tests/unit/strategies/tagged-merge.spec.ts` covering:
- Force behavior
- Defaults behavior
- Array merge behavior
- Multiple tags in one object
- Edge cases
- Inheritance resolution

### Phase 6: Migration Path

Keep both strategies available, use tagged-merge for new files, maintain backward compatibility.

## Success Criteria

1. ✅ Strategy correctly parses and extracts tagged sections
2. ✅ Force behavior replaces entirely
3. ✅ Defaults behavior preserves project overrides
4. ✅ Merge behavior combines arrays without duplicates
5. ✅ Order is preserved (Lisa's content, then project's content)
6. ✅ Multiple tags in same object work correctly
7. ✅ Untagged content is preserved
8. ✅ Inheritance chain resolves conflicts correctly
9. ✅ All tests pass with 90%+ coverage
10. ✅ No regressions in existing `merge/` strategy

## Notes

- Keep `merge/` directories for backward compatibility
- Both strategies will coexist
- Future deprecation with documentation

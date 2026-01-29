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

| Behavior | Tag Pattern | Description |
|----------|-------------|----------|
| **Force** | `//lisa-force-*` | Lisa replaces entire section; project changes are ignored |
| **Defaults** | `//lisa-defaults-*` | Lisa provides values; project can override entire section |
| **Merge** | `//lisa-merge-*` | For arrays: combine Lisa's items + project's items (deduplicated) |

### Closing Tags

Every opening tag must have a matching closing tag: `//end-lisa-<behavior>-<category>`

Example:
```json
{
  "//lisa-force-deps": "Required dependencies",
  "@package/a": "1.0.0",
  "@package/b": "2.0.0",
  "//end-lisa-force-deps": ""
}
```

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

Register the new strategy:
```typescript
import { taggedMergeStrategy } from "./tagged-merge";

export const strategies = {
  "copy-overwrite": copyOverwriteStrategy,
  "copy-contents": copyContentsStrategy,
  "create-only": createOnlyStrategy,
  "merge": mergeStrategy,
  "tagged-merge": taggedMergeStrategy,
};
```

### Phase 3: Configuration

Update `src/core/config.ts` to support both `merge/` and `tagged-merge/` directories:
- Detect which strategy to use based on directory structure
- Default to `merge/` for backward compatibility
- Use `tagged-merge/` if directory exists

### Phase 4: File Structure

Create initial `tagged-merge/` directories:

```text
typescript/tagged-merge/package.json
cdk/tagged-merge/package.json
expo/tagged-merge/package.json
nestjs/tagged-merge/package.json
npm-package/tagged-merge/package.json
```

Move existing `merge/package.json` files to `tagged-merge/` and update tags to use new naming convention.

### Phase 5: Testing

Create comprehensive test suite in `tests/unit/strategies/tagged-merge.spec.ts`:

1. **Basic force behavior**
   - Lisa section replaces project's entire section
   - Project changes outside tags are preserved

2. **Default behavior**
   - Project's section takes precedence if exists
   - Lisa's section added if project doesn't have it
   - Project can completely override with custom values

3. **Array merge behavior**
   - Combine items from both Lisa and project
   - Deduplicate identical items
   - Preserve order (Lisa's items first, then project's)

4. **Multiple tags in one object**
   - Multiple force/defaults/merge sections in same file
   - Order preservation between sections
   - Untagged content preservation

5. **Edge cases**
   - Missing closing tag
   - Mismatched tag names
   - Empty tagged sections
   - Nested objects with tags (not supported initially)
   - Arrays with object items (deduplicate by reference equality vs. value equality)

6. **Inheritance resolution**
   - Conflicting tags across `all/` → `typescript/` → `cdk/` hierarchy
   - Later types override earlier types for same tag name

### Phase 6: Migration Path

**Decisions needed from user**:
1. Keep `merge/` directories for backward compatibility, or deprecate?
2. Create both `merge/` and `tagged-merge/` initially while transitioning?
3. Timeline for full migration?

Current plan:
- Keep both strategies available
- New files use `tagged-merge/`
- Existing `merge/` files continue to work
- Future: Deprecate `merge/` with documentation

## Example: package.json

Before (current merge strategy):
```json
{
  "scripts": { ... },
  "devDependencies": { ... }
}
```

After (tagged-merge):
```json
{
  "scripts": {
    "//lisa-force-scripts-quality": "Required by Lisa for CI/CD enforcement",
    "lint": "eslint .",
    "build": "tsc",
    "test": "vitest",
    "//end-lisa-force-scripts-quality": "",
    "my-custom-script": "my-custom-implementation"
  },
  "devDependencies": {
    "//lisa-force-dev-deps": "Required by Lisa for standard governance",
    "eslint": "^9.39.0",
    "prettier": "^3.3.3",
    "//end-lisa-force-dev-deps": ""
  },
  "engines": {
    "//lisa-defaults-engines": "Defaults; projects can override",
    "node": "22.21.1",
    "bun": "1.3.8",
    "//end-lisa-defaults-engines": ""
  },
  "//lisa-merge-trusted-dependencies": "Lisa's + project's combined",
  "trustedDependencies": ["@ast-grep/cli"],
  "//end-lisa-merge-trusted-dependencies": ""
}
```

Project receives and can modify:
```json
{
  "scripts": {
    "//lisa-force-scripts-quality": "...",
    "lint": "eslint .",
    "build": "tsc",
    "test": "vitest",
    "//end-lisa-force-scripts-quality": "",
    "my-custom-script": "my-custom-implementation",
    "deploy": "custom-deployment"  // ✓ Can add outside tags
  },
  "engines": {
    "//lisa-defaults-engines": "...",
    "node": "22.21.1",
    "pnpm": "please-use-npm",  // ✓ Can override
    "//end-lisa-defaults-engines": ""
  },
  "trustedDependencies": [
    "@ast-grep/cli",
    "esbuild"  // ✓ Can add to array
  ]
}
```

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

## Future Enhancements

1. **Nested tag support**: Tags inside nested objects (e.g., `jest.//lisa-force-preset`)
2. **Conditional tags**: Tags that only apply to certain project types
3. **Comment preservation**: Preserve non-tag comments in JSON files
4. **Validation tags**: Optional tags that validate project values against Lisa's constraints
5. **tsconfig.json support**: Extend tagged-merge to other JSON config files

## Timeline

- **Phase 1-2**: Core implementation and integration (~2-3 sessions)
- **Phase 3-4**: Configuration and file structure (~1 session)
- **Phase 5**: Comprehensive testing (~2 sessions)
- **Phase 6**: Migration planning and execution (as needed)

## Questions for User

1. Should deprecated `merge/` directories be kept for backward compatibility?
2. Should we support nested tags (e.g., tags inside `jest` config object)?
3. For array merge deduplication, use value equality or reference equality?
4. Timeline preference for migration?

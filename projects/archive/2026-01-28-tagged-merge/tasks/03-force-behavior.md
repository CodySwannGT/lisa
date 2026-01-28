# Task 03: Force Behavior Implementation

## Description

Implement the "force" merge behavior where Lisa's tagged section completely replaces the project's section.

## Key Responsibilities

1. Identify all `//lisa-force-*` tagged sections
2. For each force section in Lisa's template:
   - Get all keys between opening and closing tags
   - Replace project's section with Lisa's section entirely
   - Preserve tag structure (opening tag, content, closing tag)
3. Keep all untagged content from project as-is
4. Preserve order: Lisa tags first, then project's untagged content

## Acceptance Criteria

- [ ] Force sections are replaced entirely with Lisa version
- [ ] Project's modifications to force sections are ignored
- [ ] Tag structure is preserved in output
- [ ] Untagged content is preserved
- [ ] Multiple force sections in same object work correctly

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "force" --reporter=verbose
```

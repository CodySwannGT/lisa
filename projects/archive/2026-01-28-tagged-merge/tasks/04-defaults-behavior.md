# Task 04: Defaults Behavior Implementation

## Description

Implement the "defaults" merge behavior where Lisa provides values but projects can override the entire section.

## Key Responsibilities

1. Identify all `//lisa-defaults-*` tagged sections
2. For each defaults section:
   - If project section exists (between matching tags): keep project's section entirely
   - If project section doesn't exist: use Lisa's section
3. Preserve tag structure in output
4. Handle missing closing tags gracefully (error handling)

## Acceptance Criteria

- [ ] Project's defaults sections are preserved when they exist
- [ ] Lisa's defaults sections are added when project doesn't have them
- [ ] Tag structure is preserved
- [ ] Untagged content is preserved
- [ ] Order is maintained correctly

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "defaults" --reporter=verbose
```

# Task 06: JSON Reconstruction and Order Preservation

## Description

Implement JSON reconstruction logic that maintains key order from Lisa template while incorporating project modifications.

## Key Responsibilities

1. Parse JSON preserving key order (JSON.parse() maintains insertion order in modern JS)
2. Reconstruct JSON from tags and content:
   - Iterate through Lisa template keys in order
   - For tagged sections: apply merge logic and preserve tags
   - For untagged content from project: append at end
3. Handle objects at any nesting level
4. Preserve spacing and formatting (2-space indentation)
5. Ensure output matches `JSON.stringify(_, null, 2)` format

## Acceptance Criteria

- [ ] Key order from Lisa template is preserved
- [ ] Project's untagged content is preserved and appended
- [ ] JSON reconstruction produces valid JSON
- [ ] All keys from both sources are present in output
- [ ] Formatting matches project standards (2-space indentation)

## Verification Command

```bash
bun test tests/unit/strategies/tagged-merge.spec.ts -t "order|reconstruction" --reporter=verbose
```

# CodeRabbit Review

## Issues Found: 3

### 1. Hardcoded absolute paths in STRATEGY_TEST_PATTERNS.md (Line 7 and others)

**Type:** potential_issue
**File:** `STRATEGY_TEST_PATTERNS.md:7`

**Issue:** Absolute path `/Users/cody/workspace/lisa/tests/unit/strategies/` is machine-specific and won't work for other contributors.

**Suggested Fix:** Use repository-relative paths instead (e.g., `tests/unit/strategies/`). Apply fix to all occurrences at lines 58-62, 94-98, 109, 193, 237, 291, 320, 346, 415, 433, 509-513, 543, 570-574, 632, 687, 736, 766, 794, 839, 901, 931, 958.

---

### 2. Lisa tag markers in knip.json (Lines 60-61)

**Type:** potential_issue
**File:** `knip.json:60-61`

**Issue:** Strings `"//lisa-force-dev-dependencies"` and `"//end-lisa-force-dev-dependencies"` are in the `ignoreDependencies` array. JSON doesn't support comments, so these strings serve no functional purpose and are treated as literal dependency names.

**Suggested Fix:** Remove these marker strings from the array:
```json
-    "//lisa-force-dev-dependencies",
-    "//end-lisa-force-dev-dependencies"
```

**Note:** This is expected during transition to package.lisa.json strategy—these markers will be eliminated once the new strategy is fully implemented.

---

### 3. Redundant --check flag in format script (Line 6)

**Type:** potential_issue
**File:** `all/tagged-merge/package.lisa.json:6`

**Issue:** Script `"format": "prettier --check . --write"` specifies both `--check` and `--write`. The `--check` flag alone reports formatting issues; when combined with `--write`, it's redundant since `--write` will format the files directly.

**Suggested Fix:** Remove the `--check` flag:
```json
-    "format": "prettier --check . --write"
+    "format": "prettier --write ."
```

---

## Summary

- **Total Issues:** 3
- **Severity:** Low-to-Medium
- **Actionability:** All issues are straightforward to fix
- **Implementation Status:** Code changes needed for issues 2 and 3; documentation updates needed for issue 1

## Context

This review is part of the research/planning phase. Issues 2 and 3 are configuration artifacts that the actual implementation phase will address. Issue 1 is a documentation guideline violation (absolute paths in examples).

# Plan: Broaden Integration Test File Pattern Matching

## Problem

Lisa's `test:integration` and `test:unit` scripts only match `.integration.test.(ts|tsx)` files. Downstream projects using `.integration.spec.ts` or `.integration-spec.ts` naming conventions are not picked up by `test:integration` and are incorrectly included in `test:unit`.

## Solution

Update the regex in both `test:integration` and `test:unit` scripts to match all common integration test naming patterns:

**Old pattern:** `\.integration\.test\.(ts|tsx)$`
**New pattern:** `\.integration[\.\-](test|spec)\.(ts|tsx)$`

This matches:
- `foo.integration.test.ts` (current)
- `foo.integration.spec.ts`
- `foo.integration-test.ts`
- `foo.integration-spec.ts`
- All `.tsx` variants

## Files Modified

1. `package.lisa.json` (root template) - `force.scripts.test:unit` and `force.scripts.test:integration`
2. `typescript/package-lisa/package.lisa.json` (typescript stack template) - same
3. `package.json` (Lisa's own) - same

## Branch

`fix/inclusive-integration-test-patterns`

## PR

https://github.com/CodySwannGT/lisa/pull/149

## Sessions
| b2d1c143-0916-4447-b8f1-10b4a4b214ab | 2026-02-05T02:05:36Z | plan |
| 108d469f-4d22-4f03-a86f-05a9d18d2497 | 2026-02-05T02:08:00Z | implementation |

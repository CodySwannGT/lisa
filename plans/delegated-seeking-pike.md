# Fix: Auto-bootstrap trustedDependencies for @codyswann/lisa

## Context

When `@codyswann/lisa` is installed in a downstream project, bun won't run Lisa's postinstall script unless the package is already in `trustedDependencies`. But Lisa's postinstall is what applies templates that add `@codyswann/lisa` to `trustedDependencies` (via the `merge` section). This chicken-and-egg problem means new projects never get Lisa's postinstall to run, so trustedDependencies never gets populated.

**Observed in:** thumbwar/frontend — has `@codyswann/lisa` as a devDependency but it's missing from `trustedDependencies`.

## Solution

Add a default `postinstall` script to the downstream project's `package.json` via the `defaults.scripts` section in `typescript/package-lisa/package.lisa.json`.

**Why this works:** Bun always runs the project's OWN lifecycle scripts (they aren't gated by `trustedDependencies`). So even when Lisa's own postinstall is blocked, the project's postinstall runs, applies Lisa templates, and adds `@codyswann/lisa` to `trustedDependencies` — fixing future installs.

**Why `defaults`:** Projects with existing `postinstall` scripts (e.g., `patch-package`) keep theirs. Lisa's default only applies when no project-level postinstall exists. `lodash.merge` handles this at the individual script key level within the nested `scripts` object.

## File Changes

### 1. `typescript/package-lisa/package.lisa.json`

Add `postinstall` to the `defaults.scripts` section:

```json
"defaults": {
  "scripts": {
    "build": "tsc",
    "postinstall": "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true"
  },
  "engines": { ... }
}
```

The script is:
- **Fault-tolerant**: `2>/dev/null || true` — never breaks `bun install` even if Lisa isn't installed or fails
- **Non-interactive**: `--yes` flag
- **Safe during install**: `--skip-git-check` bypasses dirty working directory check (package.json/lockfile are uncommitted during install)

### 2. Tests in `tests/unit/strategies/package-lisa.test.ts`

Add test cases:
- Default `postinstall` is applied when project has no `postinstall`
- Default `postinstall` is NOT applied when project already has a custom `postinstall`

## How It Works End-to-End

**First install (fresh project, Lisa not yet trusted):**
1. `bun add @codyswann/lisa` — Lisa is downloaded but its postinstall is **blocked** (not trusted)
2. Bun runs the project's own `postinstall` (from `defaults`) — calls `node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check .`
3. Lisa template engine merges `@codyswann/lisa` into `trustedDependencies`
4. Next `bun install` — Lisa is now trusted, its own postinstall runs normally (installs Claude plugins, etc.)

**Subsequent installs (Lisa already trusted):**
1. Lisa's own postinstall runs (trusted) — applies templates + installs plugins
2. Project's postinstall also runs — Lisa detects no changes, returns "skipped" (no-op)

**Projects with custom postinstall (e.g., `patch-package`):**
- `defaults` doesn't override existing `postinstall` — their custom script is preserved
- These projects must already have Lisa trusted, or do a one-time `bun pm trust @codyswann/lisa`

## Verification

1. Run `bun run test:unit` — all existing + new tests pass
2. Run `bun run lint` — no new violations
3. Run `bun run typecheck` — no type errors
4. Integration test: Apply Lisa to thumbwar/frontend and verify `trustedDependencies` includes `@codyswann/lisa`

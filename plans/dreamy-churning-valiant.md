# GitHub Actions Reusable Workflows — Distributable via Lisa Repo

## Context

Currently, Lisa's CLI copies `quality.yml` (2,049 lines) and `release.yml` (1,593 lines) verbatim into every downstream project via `copy-overwrite`. When the workflow logic changes, projects must run `lisa:update` to get the update.

Both workflows already have **only** `workflow_call` triggers. Every stack has a `create-only` `ci.yml` and most have `deploy.yml` that call these local files.

**Goal**: `ci.yml` and `deploy.yml` in downstream projects should call the canonical versions in the Lisa repo directly via `@main`, so workflow updates are automatic.

**Key insight**: The `quality.yml` and `release.yml` in the Lisa repo are already the full workflows (they're deployed there by `lisa:update` via `copy-overwrite`). They can be called directly from downstream as reusable workflows — no new files or wrappers needed. The `release.yml` internally calls `./quality.yml` which resolves to the Lisa repo's own `quality.yml` — no circular reference.

**For existing projects**: A one-time manual change to ci.yml/deploy.yml is needed. Lisa prints a migration notice during `lisa:update` telling the user exactly what to change.

---

## Implementation Steps

### Step 1 — Update create-only ci.yml templates

New projects get the direct `@main` reference. Change `uses: ./.github/workflows/quality.yml` → `uses: CodySwannGT/lisa/.github/workflows/quality.yml@main` in:

- `typescript/create-only/.github/workflows/ci.yml` — line 13
- `expo/create-only/.github/workflows/ci.yml` — line 14
- `nestjs/create-only/.github/workflows/ci.yml` — line 14
- `cdk/create-only/.github/workflows/ci.yml` — line 129
- `rails/create-only/.github/workflows/ci.yml` — line 10

### Step 2 — Update create-only deploy.yml templates

Change `uses: ./.github/workflows/release.yml` → `uses: CodySwannGT/lisa/.github/workflows/release.yml@main` in:

- `expo/create-only/.github/workflows/deploy.yml` — line 61
- `nestjs/create-only/.github/workflows/deploy.yml` — line 58
- `cdk/create-only/.github/workflows/deploy.yml` — line 46

### Step 3 — Add migration notice to Lisa CLI

In `src/core/lisa.ts`, after the main update completes, check if the project's ci.yml and/or deploy.yml contain old local `uses:` references. If found, print a clear migration notice.

**Patterns to detect**:
- `uses: ./.github/workflows/quality.yml` in `.github/workflows/ci.yml`
- `uses: ./.github/workflows/release.yml` in `.github/workflows/deploy.yml`

**Notice** (printed at end of update, only for patterns actually found):

```
⚠️  Action required: Update your CI/Deploy workflows to call the Lisa repo directly.

  .github/workflows/ci.yml — change:
    uses: ./.github/workflows/quality.yml
    → uses: CodySwannGT/lisa/.github/workflows/quality.yml@main

  .github/workflows/deploy.yml — change:
    uses: ./.github/workflows/release.yml
    → uses: CodySwannGT/lisa/.github/workflows/release.yml@main

  After this one-time change, quality/release workflow updates will be automatic.
```

Implementation: add a `printMigrationNotices(projectDir: string): Promise<void>` method in `lisa.ts`, called at the end of the update flow. Read each file if it exists, check for the old pattern with a simple string search, print the notice only for patterns found.

### Step 4 — No copy-overwrite template changes, no manifest changes

`quality.yml` and `release.yml` remain as full copy-overwrite workflows. They continue to be deployed to downstream projects unchanged. Projects that have migrated their ci.yml/deploy.yml to `@main` simply won't call the local files — they sit unused but harmless.

### Step 5 — Update lisa.md template

Update `all/copy-overwrite/.claude/rules/lisa.md` to document:
- New projects' ci.yml/deploy.yml reference `CodySwannGT/lisa/.github/workflows/quality.yml@main` and `release.yml@main` directly
- Existing projects: one-time manual change to ci.yml/deploy.yml (prompted by migration notice during `lisa:update`)
- The local `quality.yml` and `release.yml` remain deployed for informational purposes

---

## Verification

```bash
# 1. Verify create-only templates reference @main
grep "CodySwannGT/lisa" typescript/create-only/.github/workflows/ci.yml
grep "CodySwannGT/lisa" expo/create-only/.github/workflows/ci.yml
grep "CodySwannGT/lisa" nestjs/create-only/.github/workflows/ci.yml
grep "CodySwannGT/lisa" cdk/create-only/.github/workflows/ci.yml
grep "CodySwannGT/lisa" rails/create-only/.github/workflows/ci.yml
grep "CodySwannGT/lisa" expo/create-only/.github/workflows/deploy.yml
grep "CodySwannGT/lisa" nestjs/create-only/.github/workflows/deploy.yml
grep "CodySwannGT/lisa" cdk/create-only/.github/workflows/deploy.yml

# 2. Verify copy-overwrite templates unchanged
wc -l typescript/copy-overwrite/.github/workflows/quality.yml  # ~2049 (unchanged)
wc -l typescript/copy-overwrite/.github/workflows/release.yml  # ~1593 (unchanged)

# 3. Verify quality/release still in manifest
grep "quality\|release" .lisa-manifest

# 4. Run quality checks
bun run typecheck && bun run lint && bun run test
```

---

## Critical Files

| File | Change |
|---|---|
| `typescript/create-only/.github/workflows/ci.yml` | quality.yml → `CodySwannGT/lisa/.../quality.yml@main` |
| `expo/create-only/.github/workflows/ci.yml` | quality.yml → `CodySwannGT/lisa/.../quality.yml@main` |
| `nestjs/create-only/.github/workflows/ci.yml` | quality.yml → `CodySwannGT/lisa/.../quality.yml@main` |
| `cdk/create-only/.github/workflows/ci.yml` | quality.yml → `CodySwannGT/lisa/.../quality.yml@main` |
| `rails/create-only/.github/workflows/ci.yml` | quality.yml → `CodySwannGT/lisa/.../quality.yml@main` |
| `expo/create-only/.github/workflows/deploy.yml` | release.yml → `CodySwannGT/lisa/.../release.yml@main` |
| `nestjs/create-only/.github/workflows/deploy.yml` | release.yml → `CodySwannGT/lisa/.../release.yml@main` |
| `cdk/create-only/.github/workflows/deploy.yml` | release.yml → `CodySwannGT/lisa/.../release.yml@main` |
| `src/core/lisa.ts` | Add `printMigrationNotices()` post-update check |
| `all/copy-overwrite/.claude/rules/lisa.md` | Document new reusable workflow pattern |
| `typescript/copy-overwrite/.github/workflows/quality.yml` | No change |
| `typescript/copy-overwrite/.github/workflows/release.yml` | No change |
| `.lisa-manifest` | No changes |

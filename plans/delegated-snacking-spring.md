## Fix Rails CI: Create stack-specific reusable workflows + fix skill

### Files to create

- `.github/workflows/quality-rails.yml` — Reusable Rails quality workflow (`workflow_call`). Content from `rails/create-only/.github/workflows/quality.yml` + inputs for `database_type` (postgres/mysql), `database_name`, `skip_jobs`, etc. + GitGuardian secret scanning (mirror `quality.yml:1249-1285`). Two conditional test jobs for postgres/mysql.
- `.github/workflows/release-rails.yml` — Reusable Rails release workflow (`workflow_call`). Content from `rails/create-only/.github/workflows/release.yml` (SSH deploy key, standard-version, skip logic).

### Files to delete

- `rails/create-only/.github/workflows/quality.yml` — Replaced by reusable `quality-rails.yml`
- `rails/create-only/.github/workflows/release.yml` — Replaced by reusable `release-rails.yml`

### Files to modify

- `rails/create-only/.github/workflows/ci.yml` — Change `uses:` to `quality-rails.yml@main`. Explicit secret mapping (matching TypeScript pattern): `GITGUARDIAN_API_KEY: ${{ secrets.GITGUARDIAN_API_KEY }}`.
- `.claude/skills/lisa-update-projects/SKILL.md` — Step 8: for Rails projects (has `Gemfile`/`bin/rails`), use `rails/create-only/` templates. Key mappings: `ci.yml` → `quality-rails.yml@main`, `deploy.yml` → `release-rails.yml@main`.
- `src/core/lisa.ts:996-997` — Skip `ci.yml` migration notice for Rails projects.
- `rails/deletions.json` — Add `.github/workflows/quality.yml` and `.github/workflows/release.yml` to clean up from existing projects.

### Verification

```bash
grep 'uses:' rails/create-only/.github/workflows/ci.yml
```

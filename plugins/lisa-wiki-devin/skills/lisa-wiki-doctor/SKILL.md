---
name: lisa-wiki-doctor
description: Verify that a wiki is correctly set up and (after migration) fully functional. Runs the deterministic checks plus functional smoke tests, writes a doctor report, and returns an overall verdict. Use as the final gate of /migrate, after /setup, or anytime to confirm wiki health. A repo is not "migrated" until its doctor verdict is READY.
---

# lisa-wiki-doctor

The post-migration / post-setup verification checklist. Orchestrates the deterministic scripts and
functional smoke tests, then writes `wiki/state/migration/doctor-report.json` and prints the blocking
items.

## Verdict
Each item is `PASS | WARN | FAIL | SKIP`; overall is `READY | READY_WITH_WARNINGS | NOT_READY`. In
hard-enforcement mode (`--migration` after phase 5) `WARN` on structure/integrity items is not
allowed; earlier phases allow documented legacy warnings. Build checks (group G) are Lisa/release-only
and `SKIP` in downstream repos.

## Checklist
- **A. Structure & config** (deterministic): `validate-config.mjs` + structure-manifest conformance;
  required files present; `schemaVersion` set and rendered `kernelVersion` matches the installed
  plugin; README mode recorded (never implicit `stub`).
- **B. Integrity & safety** (deterministic): `lint-wiki.mjs` + `diff-guard.mjs`; index/log coverage;
  state-order invariant; no broken/orphan links; secret/tenant/contamination/sensitivity scans;
  memory sources project-scoped only (no global Codex memory / Chronicle).
- **C. No-loss / parity**: pre/post manifest maps every legacy page/doc/command/ingest-path/role;
  nothing dropped; docs absorption idempotent with zero dangling links; old README ingested before
  rewrite; no leftover project-local machinery except generated overlays + role agents.
- **D. Runtime surfaces** (both runtimes): canonical commands resolve on Claude; `$lisa-wiki-*` on
  Codex; each `config.staff[]` role has its doc page + both subagents; MCP doctor passes or connector
  cleanly disabled; external-write connectors skipped unless explicit intent.
- **E. Functional smoke** (skill-orchestrated): targeted ingest of a small fixture exercises the full
  ordered pipeline (in the migration branch or dry/scratch mode — **no extra PR**); `/query` returns
  a cited answer; `/lint` clean (or expected phase warnings); `/onboard-me` completes read-mostly with
  no PII; bare `/ingest --dry-run` lists non-external-write sources; `/doctor` rerun is idempotent.
- **F. Mode-specific**: embedded self-ingest at HEAD; wrapper child-docs ingested-not-moved and not
  staged; standalone/subdir path resolution; no-PR mode does not require PR creation.
- **G. Git / CI / distribution** (deterministic): clean working tree (only intended changes); no
  secrets/OAuth committed; PR/auto-merge policy honored; CI validator green if `--with-ci`; (Lisa
  only) `bun run build:plugins` builds both artifacts and `check:plugins` passes.

## Notes
- Deterministic items are run by `scripts/verify-migration.mjs` (which emits the JSON report); this
  skill adds the functional smoke tests and interprets phase-allowed warnings.
- Read-mostly: the smoke tests must not open an extra PR or perform external writes.

## Related
`lisa-wiki-migrate`, `lisa-wiki-lint`, `lisa-wiki-setup`.

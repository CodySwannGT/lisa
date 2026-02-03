# Add OWASP ZAP Baseline Scanning for Expo and NestJS Projects

## Summary

Add OWASP ZAP (Zed Attack Proxy) DAST baseline scanning to Lisa's governance framework for **expo** and **nestjs** project types. This includes both CI (GitHub Actions) and local scanning support.

## Scope

- **Expo**: ZAP baseline scan against `expo export:web` static output
- **NestJS**: ZAP baseline scan against running NestJS server's `/graphql` endpoint
- **CI**: New `zap_baseline` job in `quality.yml` workflow
- **Local**: Shell script + Claude Code command for running ZAP locally via Docker

## Files to Modify

### 1. CI — quality.yml (shared workflow)

**File**: `typescript/copy-overwrite/.github/workflows/quality.yml`

- Add `zap_target_url` input parameter (optional, for projects that provide a known URL)
- Add `zap_baseline` job following the existing security job pattern:
  - Skip via `skip_jobs: 'zap_baseline'`
  - No secret/token required (ZAP baseline runs locally in Docker)
  - Uses `zaproxy/action-baseline@v0.14.0` GitHub Action
  - For Expo: builds web export, serves with a static server, scans
  - For NestJS: starts server, waits for health check, scans
  - Uploads ZAP HTML report as artifact
  - **Blocking** — fails the build on medium+ severity findings
- Update `security_tools_summary` job: add ZAP to `needs` array and summary output
- Update `performance_summary` job: add ZAP to `needs` array and job status table

### 2. Expo — ZAP workflow override

**File**: `expo/copy-overwrite/.github/workflows/zap-baseline.yml` (new)

Dedicated ZAP workflow for Expo that:
- Runs `npx expo export --platform web` to generate static build
- Serves the `dist/` output with `npx serve`
- Runs ZAP baseline scan against `http://localhost:3000`
- Can be called from ci.yml or run standalone via workflow_dispatch

### 3. NestJS — ZAP workflow override

**File**: `nestjs/copy-overwrite/.github/workflows/zap-baseline.yml` (new)

Dedicated ZAP workflow for NestJS that:
- Builds and starts the NestJS server
- Waits for server ready
- Runs ZAP baseline scan against `http://localhost:3000/graphql`
- Can be called from ci.yml or run standalone via workflow_dispatch

### 4. Expo ci.yml — add ZAP job

**File**: `expo/create-only/.github/workflows/ci.yml`

- Add `zap` job that calls `zap-baseline.yml`

### 5. NestJS ci.yml — add ZAP job

**File**: `nestjs/create-only/.github/workflows/ci.yml`

- Add `zap` job that calls `zap-baseline.yml`

### 6. Local scan script — Expo

**File**: `expo/copy-overwrite/scripts/zap-baseline.sh` (new)

Shell script that:
- Checks Docker is available
- Builds Expo web export
- Starts local static server
- Runs ZAP Docker baseline scan (`ghcr.io/zaproxy/zaproxy:stable`)
- Outputs HTML report to `zap-report.html`
- Cleans up server and container

### 7. Local scan script — NestJS

**File**: `nestjs/copy-overwrite/scripts/zap-baseline.sh` (new)

Shell script that:
- Checks Docker is available
- Builds and starts NestJS server
- Runs ZAP Docker baseline scan
- Outputs HTML report
- Cleans up

### 8. Package.lisa.json — add scripts

**File**: `expo/package-lisa/package.lisa.json`
- Add `"security:zap": "bash scripts/zap-baseline.sh"` to force scripts

**File**: `nestjs/package-lisa/package.lisa.json`
- Add `"security:zap": "bash scripts/zap-baseline.sh"` to force scripts

### 9. ZAP config files

**File**: `expo/copy-overwrite/.zap/baseline.conf` (new)
- ZAP baseline scan configuration (rules to ignore/modify for Expo web apps)

**File**: `nestjs/copy-overwrite/.zap/baseline.conf` (new)
- ZAP baseline scan configuration (rules to ignore/modify for NestJS APIs)

### 10. Claude Code command for local scanning

**File**: `typescript/copy-overwrite/.claude/commands/security/zap-scan.md` (new)
- Slash command that runs the local ZAP scan and summarizes results

### 11. Update .gitignore additions

**File**: `all/copy-contents/.gitignore` (or expo/nestjs-specific)
- Add `zap-report.html` and `.zap/` output patterns

### 12. Documentation

**File**: `expo/copy-overwrite/.claude/skills/owasp-zap/SKILL.md` (new)
- Skill teaching Claude how to interpret and act on ZAP findings

### 13. Tests

- Unit tests for any new TypeScript utilities (if any)
- Integration tests verifying the ZAP workflow YAML is valid

### 14. Remove TODO item

**File**: `TODO.md`
- Remove the `[ ] Add ZAP (OWASP) DAST scanning to CI/CD workflow templates` item

## Task List (for implementation)

Tasks should be executed by subagents in parallel where possible.

1. **Add `zap_baseline` job to quality.yml** — Add the job, update summary jobs, add input parameter
2. **Create expo ZAP workflow** (`expo/copy-overwrite/.github/workflows/zap-baseline.yml`)
3. **Create nestjs ZAP workflow** (`nestjs/copy-overwrite/.github/workflows/zap-baseline.yml`)
4. **Update expo ci.yml** to call ZAP workflow
5. **Update nestjs ci.yml** to call ZAP workflow
6. **Create expo local scan script** (`expo/copy-overwrite/scripts/zap-baseline.sh`)
7. **Create nestjs local scan script** (`nestjs/copy-overwrite/scripts/zap-baseline.sh`)
8. **Create ZAP baseline config files** for both expo and nestjs
9. **Update package.lisa.json** for both expo and nestjs with `security:zap` script
10. **Create Claude Code slash command** for ZAP scanning
11. **Create OWASP ZAP skill** for expo (and shared via typescript)
12. **Update .gitignore** with ZAP output patterns
13. **Update TODO.md** — remove completed item
14. **Write tests** for any new code
15. **Update documentation preambles** on all modified files

## Skills to Use During Execution

- `/jsdoc-best-practices` — when writing any JSDoc documentation
- `/git:commit` — for atomic conventional commits

## Verification

1. `bun run lint` — all new/modified files pass linting
2. `bun run typecheck` — no type errors
3. `bun run test` — all tests pass
4. Manually verify YAML validity: `python3 -c "import yaml; yaml.safe_load(open('path/to/workflow.yml'))"` for each workflow file
5. Verify the local scan scripts are executable and have proper shebang lines
6. Verify ZAP config files are well-formed
7. `bun run format:check` — formatting passes

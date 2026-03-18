# Plan: Rails Parity with TypeScript Ecosystem

## Context

Rails projects governed by Lisa have significantly less automation and CI coverage than the TypeScript ecosystem (TypeScript + Expo + NestJS + CDK). This plan closes the gaps where Rails has a natural analog — it does not force TypeScript-specific patterns onto Rails.

## Current State

### What Rails already has

- **Linting**: RuboCop (6 plugins: rails, performance, rspec, capybara, factory_bot, yard)
- **Security**: Brakeman, Bundler Audit, Rack::Attack
- **Testing**: RSpec, FactoryBot, Capybara, SimpleCov (80% line / 70% branch)
- **Code quality**: Reek, Flog, Flay
- **Database quality**: Strong Migrations, Database Consistency
- **Performance**: Bullet, Rack Mini Profiler
- **Git hooks**: Lefthook (pre-commit: RuboCop + Bundler Audit; pre-push: RSpec + Brakeman + Reek + Flog + Flay)
- **CI**: GitHub Actions quality workflow (lint, security, test, code_quality, secret_scanning)
- **Deployment**: Kamal + ECS Fargate + Docker multi-stage builds
- **Background jobs**: Solid Queue (database-backed, no Redis)
- **Monitoring**: OpenTelemetry + CloudWatch Metrics/Logs
- **Secrets**: AWS Secrets Manager + SSM Parameter Store

### What Rails is missing (with natural analogs)

| Gap | TypeScript Equivalent | Rails Analog |
|-----|----------------------|--------------|
| Edit-time hooks | `format-on-edit.sh`, `lint-on-edit.sh`, `sg-scan-on-edit.sh` | `rubocop-on-edit.sh`, `sg-scan-on-edit.sh` |
| Machine-readable thresholds | `jest.thresholds.json`, `eslint.thresholds.json` | `simplecov.thresholds.json`, `rubocop.thresholds.json` |
| Nightly coverage increment | `reusable-claude-nightly-test-coverage.yml` | Same pattern with SimpleCov + RSpec |
| Nightly complexity reduction | `reusable-claude-nightly-code-complexity.yml` | Same pattern with RuboCop/Flog thresholds |
| Nightly test quality improvement | `reusable-claude-nightly-test-improvement.yml` | Same pattern with RSpec |
| AST pattern scanning in CI | ast-grep scan job in `quality.yml` | ast-grep supports Ruby |
| DAST scanning | OWASP ZAP job in `quality.yml` | Rails serves HTTP — directly applicable |
| License compliance | FOSSA job in `quality.yml` | Bundler dependencies need license auditing |
| Ops specialist agent | Expo `ops-specialist` | Kamal, ECS, Solid Queue, OpenTelemetry, CloudWatch |

### What was excluded (no natural Rails analog)

| TypeScript Feature | Why excluded |
|---|---|
| Container/View pattern skill | Rails MVC + service objects already covered by existing skills |
| Testing Library skill | RSpec + Shoulda Matchers are the Rails equivalent, already governed |
| Reduce-complexity skill (Expo) | React-component specific; Flog/Reek already serve this role |
| Knip (dead code detection) | No robust Ruby equivalent tool exists |
| Snyk dependency scanning | Bundler Audit already fills this role for Ruby gems |
| TypeScript typecheck CI job | Ruby is dynamically typed; Sorbet isn't standard |
| Build verification CI job | Rails has no compilation step (Propshaft + Importmap = no build) |
| Format check CI job | RuboCop already covers formatting in the lint job |
| Expo Router / Apollo / Gluestack / NativeWind skills | Framework-specific, not applicable to Rails |
| NestJS GraphQL / TypeORM skills | Only relevant if project uses graphql-ruby; not universal |
| MCP resources | Project-dependent, not a stack-level concern |

---

## Phase 1 — Edit-Time Hooks

**Goal**: Give Claude real-time feedback on Ruby file edits, matching the TypeScript developer experience.

### 1.1 — `rubocop-on-edit.sh` PostToolUse hook

RuboCop serves as both formatter and linter in Ruby, combining the roles of Prettier (`format-on-edit.sh`) and ESLint (`lint-on-edit.sh`).

- Trigger: PostToolUse on `Write` and `Edit` for `.rb` files
- Run: `bundle exec rubocop -A --fail-level E <file>` (autocorrect + fail on errors)
- Blocking: exit 1 on errors so Claude gets feedback and can fix
- Skip: Non-Ruby files, files in excluded directories (db/migrate, vendor, etc.)

### 1.2 — `sg-scan-on-edit.sh` PostToolUse hook for Ruby

ast-grep supports Ruby. Reuse the same hook pattern as TypeScript, targeting `.rb` files.

- Prerequisite: Create Ruby-specific ast-grep rules (see Phase 4.1)
- Trigger: PostToolUse on `Write` and `Edit` for `.rb` files
- Run: `ast-grep scan --rule <ruby-rules-dir> <file>`
- Blocking: exit 1 on matches

### 1.3 — Update `rails` plugin.json

Add PostToolUse hooks to `plugins/src/rails/plugin.json`, matching the TypeScript plugin pattern.

---

## Phase 2 — Externalized Thresholds

**Goal**: Make thresholds machine-readable/writable so nightly workflows can bump them programmatically.

### 2.1 — `simplecov.thresholds.json`

Create a JSON file that `.simplecov` reads:

```json
{
  "line": 80,
  "branch": 70
}
```

Update `.simplecov` to read from this file instead of hardcoding values. This is a create-only file (like `jest.thresholds.json`) so projects can customize.

### 2.2 — `rubocop.thresholds.json`

Create a JSON file for complexity thresholds:

```json
{
  "method_length": 20,
  "class_length": 200,
  "abc_size": 25,
  "cyclomatic_complexity": 10,
  "perceived_complexity": 10
}
```

Update `.rubocop.yml` to reference these values. Since RuboCop YAML doesn't natively support JSON imports, create a `rubocop.thresholds.yml` partial that `.rubocop.yml` inherits from, with a build/sync script that generates the YAML from JSON (or just use YAML directly — simpler).

**Alternative**: Use `rubocop.thresholds.yml` directly (skip JSON). Nightly workflow can parse/update YAML with `yq`. This avoids a build step.

### 2.3 — Update Lisa templates

- `rails/create-only/simplecov.thresholds.json` — default thresholds for new projects
- `rails/create-only/rubocop.thresholds.yml` — default complexity thresholds
- Update `rails/create-only/.simplecov` to read from `simplecov.thresholds.json`
- Update `rails/copy-overwrite/.rubocop.yml` to inherit from `rubocop.thresholds.yml`

---

## Phase 3 — Nightly Claude Automation

**Goal**: Rails projects self-improve coverage, test quality, and complexity overnight — matching TypeScript.

### 3.1 — `reusable-claude-nightly-test-coverage-rails.yml`

Reusable workflow that:

1. Checks for existing PR (prevent duplicates)
2. Reads `simplecov.thresholds.json`, parses current line/branch thresholds
3. Calculates proposed thresholds (current + `coverage_increment`, capped at 90%)
4. Invokes Claude Code with prompt to:
   - Run `bundle exec rspec` with SimpleCov to identify coverage gaps
   - Parse `coverage/index.html` or console output for lowest-coverage files
   - Write RSpec tests targeting uncovered code
   - Update `simplecov.thresholds.json` with new values
   - Re-run `bundle exec rspec` to verify thresholds pass
5. Creates PR with CodeRabbit review trigger
6. Enables auto-merge if configured

Inputs: `coverage_increment` (default: 5), `ruby_version` (default: 3.4.8), `auto_merge` (default: true)

### 3.2 — `reusable-claude-nightly-code-complexity-rails.yml`

Reusable workflow that:

1. Reads `rubocop.thresholds.yml`
2. Decrements one or more thresholds (e.g., `method_length` from 20 to 19)
3. Invokes Claude Code to:
   - Run `bundle exec rubocop` to find violations at the new threshold
   - Refactor offending methods/classes to comply
   - Update threshold file
   - Re-run `bundle exec rubocop` to verify
4. Creates PR

### 3.3 — `reusable-claude-nightly-test-improvement-rails.yml`

Reusable workflow that:

1. Invokes Claude Code to:
   - Identify weak tests (missing assertions, brittle setup, poor isolation)
   - Improve test quality without changing coverage thresholds
   - Run `bundle exec rspec` to verify
2. Creates PR

### 3.4 — Template workflow for downstream projects

Create `rails/create-only/.github/workflows/claude-nightly-test-coverage.yml` that calls the reusable workflow, with commented examples showing how to override `coverage_increment`.

---

## Phase 4 — CI Quality Jobs

**Goal**: Add missing quality gates to `quality-rails.yml` that have natural Rails analogs.

### 4.1 — AST pattern scanning (ast-grep)

Add `sg_scan` job to `quality-rails.yml`. Create Ruby-specific ast-grep rules for common Rails anti-patterns:

- Unsafe `send`/`public_send` with user input
- Raw SQL in `where` clauses (SQL injection vectors)
- `skip_before_action` without `only:`/`except:` (overly broad filter skips)
- Direct `params[]` usage without strong parameters
- `update_columns`/`update_column` bypassing validations
- `find_by_sql` without parameterized queries

Store rules in `ast-grep/rules/ruby/` alongside existing TypeScript rules.

### 4.2 — OWASP ZAP DAST scanning

Add `zap_baseline` job to `quality-rails.yml`. Rails apps serve HTTP — ZAP scanning is directly applicable. Reuse the same ZAP action configuration from the TypeScript `quality.yml`, adjusted for Rails default port (3000) and startup command.

### 4.3 — License compliance (FOSSA)

Add `license_compliance` job to `quality-rails.yml`. Bundler dependencies need the same license auditing as npm packages. FOSSA supports Ruby/Bundler natively.

---

## Phase 5 — Ops Specialist Agent

**Goal**: Give Rails projects an ops agent that understands their deployment and monitoring stack.

### 5.1 — `ops-specialist` agent for Rails

Create `plugins/src/rails/agents/ops-specialist/` with skills covering:

- **Deployment**: Kamal commands (`kamal deploy`, `kamal rollback`, `kamal app logs`), ECS Fargate task management, Docker image builds
- **Background jobs**: Solid Queue monitoring (queue depth, failed jobs, retry), `PublishCloudWatchMetricsJob` health
- **Monitoring**: OpenTelemetry trace inspection, CloudWatch Metrics/Logs queries, alarm status checks
- **Health checks**: `/up` endpoint verification, ECS service stability, database connectivity
- **Database ops**: Migration status (`rails db:migrate:status`), Strong Migrations compliance, multi-database health (primary, queue, cache, cable)
- **Secrets/Config**: SSM Parameter Store lookups, Secrets Manager status, environment comparison

Model after Expo's `ops-specialist` but with Rails-specific tooling (no Expo/React Native references).

---

## Execution Order

```text
Phase 1 (hooks) ──────────────────────┐
                                       ├──→ Phase 4 (CI jobs) ──→ Done
Phase 2 (thresholds) ──→ Phase 3 (nightly automation) ──→ Done
                                       │
Phase 5 (ops agent) ──────────────────┘
```

- **Phase 1** and **Phase 2** have no dependencies and can start in parallel
- **Phase 3** depends on Phase 2 (needs externalized thresholds)
- **Phase 4** and **Phase 5** are independent of everything else
- **Phase 4.1** (ast-grep rules) is a soft prerequisite for Phase 1.2 (sg-scan hook)

## Sessions

| Session | Date | Phases | Notes |
|---------|------|--------|-------|
| 1 | 2026-03-18 | Research | Initial analysis and plan creation |
| 2 | 2026-03-18 | All phases | Implemented all 5 phases: edit-time hooks (rubocop-on-edit, sg-scan-on-edit), externalized thresholds (simplecov.thresholds.json, rubocop.thresholds.yml), nightly workflows (3 reusable + 3 templates), CI quality jobs (6 ast-grep rules, sg_scan/FOSSA/ZAP jobs), ops-specialist agent (+ 5 skills) |

# Add Rails Stack to Lisa

## Context

Lisa currently supports JavaScript/TypeScript ecosystems: `typescript`, `expo`, `nestjs`, `cdk`, `npm-package`. This plan adds a `rails` stack to govern Ruby on Rails projects, with Qualis (`~/workspace/qualis/app`) as the first downstream target.

**Plan type:** Epic (30+ new files, source code changes, downstream integration)

**Input source:** `plans/delightful-napping-lemon.md` (file path) + `rails-pack.md` requirements

## Design Decisions

1. **Rails is a root-level type** (`parent: undefined`) — peer of `typescript`, not child. This means Rails projects get `all/` + `rails/` packs only, NOT `typescript/`.
2. **`all/` pack is safe** — `CLAUDE.md` and `.claude/rules/lisa.md` are JS-specific and get overridden by `rails/copy-overwrite/` versions. 5 JS-specific skills also overridden. All TS-specific config files (`.prettierrc.json`, `eslint.*`, `jest.*`, `tsconfig.*`) live in `typescript/copy-overwrite/` and won't be deployed.
3. **Gemfile governance via `eval_gemfile`** — Lisa manages `rails/copy-overwrite/Gemfile.lisa` (governance gems with `~>` version constraints). A `rails/copy-contents/Gemfile` appends `eval_gemfile "Gemfile.lisa"` to the project's Gemfile with `# BEGIN/END: AI GUARDRAILS` markers.
4. **Lefthook hooks**: pre-commit runs RuboCop (staged files) + bundler-audit (fast). pre-push runs `bundle exec rspec` + `bundle exec brakeman` (moved from pre-commit per security review — Brakeman is slow on large codebases). commit-msg validates conventional commit format.
5. **RSpec-only pack** — Pack ships with RSpec as standard. Qualis Minitest-to-RSpec migration is a **separate follow-up plan**. Minitest projects should add `lefthook.yml` to `.lisaignore` to skip the pre-push hook until migration.
6. **`quality.yml` is create-only** — Each project configures its own database services and CI environment. Lisa provides a starting template.
7. **`sonar-project.properties` is create-only** — Projects customize SonarQube project keys.
8. **`coding-philosophy.md` from `all/` kept for MVP** — Principles are universal even though examples are TS. Ruby-specific version is a future enhancement.
9. **`rails/deletions.json`** removes `.overcommit.yml` from downstream projects migrating to Lefthook.
10. **Detection strategy**: `bin/rails` (primary, definitive) OR `config/application.rb` (secondary, unique to Rails). Avoids Hanami false positives (`config/routes.rb` exists in Hanami too).
11. **Gem version constraints**: All gems use `~>` pessimistic constraints per Ruby convention. Prevents surprise major version bumps while allowing patches.
12. **`strong_migrations` and `rack-attack` outside dev/test group** — Both are runtime gems that must be available in all environments.
13. **5 JS-specific skill overrides** in `rails/copy-overwrite/.claude/skills/`: `plan-fix-linter-error`, `plan-add-test-coverage`, `plan-reduce-max-lines`, `plan-reduce-max-lines-per-function`, `plan-lower-code-complexity`.
14. **Full toolchain**: SonarQube, flog, flay, rack-attack included per user decision.

## Known Gaps (MVP)

- `all/copy-overwrite/.claude/rules/coding-philosophy.md` uses TypeScript examples (principles are universal)
- `all/copy-overwrite/specs/.keep` creates an empty `specs/` directory (harmless alongside RSpec's `spec/`)
- RSpec artifacts (`.rspec`, `spec/`) deployed to Minitest projects (documented, Minitest projects can delete)
- Node.js prerequisite for running Lisa against Rails projects (documented in Rails CLAUDE.md)
- No PostToolUse hooks for Ruby (enforcement via Lefthook pre-commit only)

## Branch/PR

- Branch: `feat/rails-stack`
- Target: `main`
- PR: Draft, created in first task

## Critical Files

### Lisa Source Code (modify)

- `src/core/config.ts` — Add `"rails"` to `ProjectType`, `PROJECT_TYPE_HIERARCHY`, `PROJECT_TYPE_ORDER`
- `src/detection/detectors/rails.ts` — New file: detect via `bin/rails` or `config/application.rb`
- `src/detection/index.ts` — Register `RailsDetector`
- `package.json` — Add `"rails"` to `files` array

### Rails Pack (new directory: `rails/`)

```
rails/
├── copy-overwrite/
│   ├── CLAUDE.md                                    # Rails-specific (replaces JS version from all/)
│   ├── .rubocop.yml                                 # Governance RuboCop config (inherits .rubocop.local.yml)
│   ├── lefthook.yml                                 # Git hooks: rubocop, bundler-audit, brakeman, rspec
│   ├── Gemfile.lisa                                 # Governance gems with ~> constraints
│   ├── .claude/
│   │   ├── rules/
│   │   │   ├── lisa.md                              # Rails-specific managed file list
│   │   │   └── rails-conventions.md                 # Rails coding standards
│   │   └── skills/
│   │       ├── plan-fix-linter-error/SKILL.md       # RuboCop instead of ESLint
│   │       ├── plan-add-test-coverage/SKILL.md      # SimpleCov instead of Jest coverage
│   │       ├── plan-reduce-max-lines/SKILL.md       # Metrics/ClassLength instead of max-lines
│   │       ├── plan-reduce-max-lines-per-function/SKILL.md  # Metrics/MethodLength
│   │       └── plan-lower-code-complexity/SKILL.md  # CyclomaticComplexity + flog
│   └── .github/
│       └── workflows/                               # (empty — quality.yml is create-only)
├── copy-contents/
│   └── Gemfile                                      # Appends eval_gemfile "Gemfile.lisa" with markers
├── create-only/
│   ├── .rubocop.local.yml                           # Project-specific RuboCop overrides
│   ├── .simplecov                                   # Coverage config with thresholds
│   ├── .reek.yml                                    # Code smell config
│   ├── .rspec                                       # RSpec flags (--format documentation, --color)
│   ├── sonar-project.properties                     # SonarQube config (project customizes key)
│   ├── spec/
│   │   ├── spec_helper.rb                           # Base RSpec config with SimpleCov
│   │   └── rails_helper.rb                          # Rails-specific RSpec setup
│   └── .github/
│       └── workflows/
│           └── quality.yml                          # CI template (create-only, project customizes DB)
└── deletions.json                                   # Removes: .overcommit.yml
```

### Tests (modify existing files)

- `tests/unit/detection/detectors.test.ts` — Append RailsDetector describe block + DetectorRegistry Rails tests
- `tests/integration/lisa.test.ts` — Append Rails stack integration tests
- `tests/helpers/test-utils.ts` — Add `createRailsProject()` helper + extend `createMockLisaDir()` for rails/ pack

### Qualis Downstream (in `~/workspace/qualis/app`)

- Remove duplicate gems from Gemfile (brakeman, rubocop-rails, rubocop-performance, rubocop-rails-omakase)
- Remove overcommit gem from Gemfile
- Run `bundle install` + `bundle exec lefthook install`
- Move CLAUDE.md content to `.claude/rules/PROJECT_RULES.md`

## Key Template Contents

### `rails/copy-overwrite/CLAUDE.md`

Preserves all universal rules from `all/` version but replaces JS-specific content:

| JS Version | Rails Version |
|---|---|
| `ls package-lock.json yarn.lock ...` | `cat .ruby-version` |
| `@package.json` | `@Gemfile` |
| `@eslint.config.ts` | `@.rubocop.yml` |
| `@.prettierrc.json` | (removed — RuboCop handles formatting) |
| `/jsdoc-best-practices` | YARD documentation conventions |
| `node_modules/` | `vendor/bundle/` |
| eslint-disable rules | rubocop:disable rules |
| lockfile regeneration | `bundle install` after Gemfile changes |

Adds Rails-specific: `db/schema.rb` protection, `bundle exec rubocop`/`brakeman` verification, `bin/rails` commands.

### `rails/copy-overwrite/Gemfile.lisa`

```ruby
# frozen_string_literal: true

# This file is managed by Lisa. Do not edit directly.
# These gems are governance-critical and will be overwritten on every `lisa` run.

# Runtime governance (all environments)
gem "strong_migrations", "~> 2.5"
gem "rack-attack", "~> 6.8"

group :development, :test do
  # Linting & Style
  gem "rubocop", "~> 1.75", require: false
  gem "rubocop-rails", "~> 2.30", require: false
  gem "rubocop-performance", "~> 1.24", require: false
  gem "rubocop-rspec", "~> 3.5", require: false
  gem "rubocop-capybara", "~> 2.22", require: false
  gem "rubocop-factory_bot", "~> 2.26", require: false
  gem "rubocop-yard", "~> 0.9", require: false

  # Testing
  gem "rspec-rails", "~> 7.1"
  gem "factory_bot_rails", "~> 6.4"
  gem "faker", "~> 3.5"
  gem "shoulda-matchers", "~> 6.4"
  gem "simplecov", "~> 0.22", require: false
  gem "webmock", "~> 3.24"
  gem "vcr", "~> 6.3"

  # Code Quality
  gem "reek", "~> 6.3", require: false
  gem "flog", "~> 4.8", require: false
  gem "flay", "~> 2.13", require: false

  # Security
  gem "brakeman", "~> 7.0", require: false
  gem "bundler-audit", "~> 0.9", require: false

  # Documentation
  gem "yard", "~> 0.9", require: false

  # Database Quality
  gem "database_consistency", "~> 1.7", require: false
end

group :development do
  # Performance
  gem "bullet", "~> 8.0"
  gem "rack-mini-profiler", "~> 3.3"

  # Git Hooks
  gem "lefthook", require: false
end
```

**Note**: Exact `~>` versions must be verified against current stable releases at implementation time. The versions above are estimates — the implementer should run `gem search <name>` or check rubygems.org for each gem.

### `rails/copy-contents/Gemfile`

```ruby
# BEGIN: AI GUARDRAILS
eval_gemfile "Gemfile.lisa"
# END: AI GUARDRAILS
```

### `rails/copy-overwrite/.rubocop.yml`

```yaml
inherit_from: .rubocop.local.yml

require:
  - rubocop-rails
  - rubocop-performance
  - rubocop-rspec
  - rubocop-capybara
  - rubocop-factory_bot
  - rubocop-yard

AllCops:
  NewCops: enable
  TargetRubyVersion: 3.4
  Exclude:
    - 'db/schema.rb'
    - 'db/migrate/**/*'
    - 'bin/**/*'
    - 'vendor/**/*'
    - 'node_modules/**/*'
    - 'tmp/**/*'

Metrics/MethodLength:
  Max: 20

Metrics/ClassLength:
  Max: 200

Metrics/AbcSize:
  Max: 25

Metrics/CyclomaticComplexity:
  Max: 10
```

### `rails/copy-overwrite/lefthook.yml`

```yaml
pre-commit:
  parallel: true
  commands:
    rubocop:
      glob: '*.rb'
      run: bundle exec rubocop --force-exclusion {staged_files}
    bundler-audit:
      run: bundle exec bundler-audit check --update

commit-msg:
  commands:
    conventional-commit:
      run: 'echo "$1" | grep -qE "^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)(\(.+\))?: .+" || (echo "Commit message must follow conventional format" && exit 1)'

pre-push:
  commands:
    rspec:
      run: bundle exec rspec
    brakeman:
      run: bundle exec brakeman --no-pager --quiet
```

### `rails/create-only/.github/workflows/quality.yml`

Jobs: lint (RuboCop), security (Brakeman + bundler-audit), test (rspec with DB setup placeholder), code-quality (Reek, database_consistency, flog/flay). Includes explicit `permissions: { contents: read, checks: write, pull-requests: write }` block.

### Skill Override Adaptations

| Skill | JS Version | Rails Version |
|---|---|---|
| `plan-fix-linter-error` | `bun run lint` / ESLint rules | `bundle exec rubocop --format json` / RuboCop cops |
| `plan-add-test-coverage` | `bun run test:cov` / Jest coverage | `bundle exec rspec` / SimpleCov output |
| `plan-reduce-max-lines` | ESLint `max-lines` | RuboCop `Metrics/ClassLength` + `Metrics/ModuleLength` |
| `plan-reduce-max-lines-per-function` | ESLint `max-lines-per-function` | RuboCop `Metrics/MethodLength` |
| `plan-lower-code-complexity` | ESLint `cognitive-complexity` | RuboCop `Metrics/CyclomaticComplexity` + `Metrics/PerceivedComplexity` + flog scores |

## Tasks

Tasks should be executed by an Agent Team via `/plan:implement`. Implementation tasks can run in parallel where no dependencies exist. Review tasks run after all implementation.

### Task 1: Create branch and draft PR

**Type:** Task

**Description:** Create `feat/rails-stack` branch from `main`. Open a draft PR targeting `main` with title "feat(rails): add Rails stack to Lisa" and body summarizing the plan.

**Acceptance Criteria:**
- [ ] Branch `feat/rails-stack` exists
- [ ] Draft PR is open targeting `main`

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "git branch --show-current && gh pr view --json state,title",
    "expected": "feat/rails-stack branch, draft PR with correct title"
  }
}
```

### Task 2: Add Rails to ProjectType config

**Type:** Task

**Description:** Modify `src/core/config.ts`:
- Add `| "rails"` to `ProjectType` union (after `"npm-package"`)
- Add `rails: undefined` to `PROJECT_TYPE_HIERARCHY` (root type, no parent)
- Add `"rails"` to `PROJECT_TYPE_ORDER` array (after `"cdk"`)

**Acceptance Criteria:**
- [ ] `"rails"` is a valid `ProjectType`
- [ ] `PROJECT_TYPE_HIERARCHY.rails === undefined`
- [ ] `PROJECT_TYPE_ORDER` includes `"rails"` after `"cdk"`

**Implementation Details:**
- File: `src/core/config.ts`
- Lines 15-20 (ProjectType), 25-33 (hierarchy), 38-44 (order)

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "grep -n 'rails' src/core/config.ts",
    "expected": "rails appears in ProjectType union, hierarchy, and order"
  }
}
```

### Task 3: Create Rails detector

**Type:** Task

**Description:** Create `src/detection/detectors/rails.ts` following the NestJS detector pattern. Detection logic:
1. Check for `bin/rails` file existence via `pathExists()` (primary — definitive Rails signal)
2. OR check for `config/application.rb` file existence via `pathExists()` (secondary — unique to Rails, avoids Hanami false positive from `config/routes.rb`)

Import `path` from `node:path`, `IProjectTypeDetector` from `../detector.interface.js`, and `pathExists` from `../../utils/index.js`.

**Acceptance Criteria:**
- [ ] `RailsDetector` implements `IProjectTypeDetector`
- [ ] `type` is `"rails"` as const
- [ ] `detect()` returns `true` for `bin/rails` presence
- [ ] `detect()` returns `true` for `config/application.rb` presence
- [ ] `detect()` returns `false` for empty directory

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run build 2>&1 | tail -5",
    "expected": "No TypeScript compilation errors"
  }
}
```

### Task 4: Register Rails detector

**Type:** Task

**Description:** Modify `src/detection/index.ts`:
- Add import: `import { RailsDetector } from "./detectors/rails.js";`
- Add `new RailsDetector()` to the default detectors array in `DetectorRegistry` constructor (after `CDKDetector`)

**Acceptance Criteria:**
- [ ] `RailsDetector` is imported
- [ ] `RailsDetector` is in the default detectors array
- [ ] Build succeeds

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run build 2>&1 | tail -5",
    "expected": "No TypeScript compilation errors"
  }
}
```

### Task 5: Write Rails detector tests

**Type:** Task

**Description:** Append to `tests/unit/detection/detectors.test.ts`:
1. Add imports: `RailsDetector` from detector path
2. Add constants: `RAILS_TYPE = "rails"`, `BIN_RAILS = "bin/rails"`, `CONFIG_APPLICATION_RB = "config/application.rb"`
3. Add `RailsDetector` describe block with tests:
   - `it(HAS_CORRECT_TYPE)` — `detector.type === "rails"`
   - `it("detects by bin/rails presence")` — create `bin/rails` file, assert `true`
   - `it("detects by config/application.rb presence")` — create `config/application.rb`, assert `true`
   - `it("returns false when not a Rails project")` — empty dir with only `package.json`, assert `false`
   - `it("returns false for TypeScript-only project")` — dir with `tsconfig.json` only, assert `false`
4. Add DetectorRegistry tests:
   - `it("expands rails without parent")` — `expandAndOrderTypes(["rails"])` returns `["rails"]`
   - `it("detects Rails project")` — create `bin/rails` in temp dir, `detectAll()` includes `"rails"`

Follow existing test patterns exactly (beforeEach/afterEach, createTempDir/cleanupTempDir).

**Testing Requirements:**
```
describe("RailsDetector")
  it("has correct type")
  it("detects by bin/rails presence")
  it("detects by config/application.rb presence")
  it("returns false when not a Rails project")
  it("returns false for TypeScript-only project")
describe("DetectorRegistry") // append to existing
  it("expands rails without parent")
  it("detects Rails project")
```

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/unit/detection/detectors.test.ts",
    "expected": "All tests pass including new RailsDetector tests"
  }
}
```

### Task 6: Create rails/ pack directory with all template files

**Type:** Task

**Description:** Create the full `rails/` directory tree with all template files. This is the largest task — ~25 files.

**Files to create:**

**copy-overwrite/ (governance-critical, overwritten every Lisa run):**
- `CLAUDE.md` — Rails-specific governance rules (adapt from `all/copy-overwrite/CLAUDE.md`, replace JS-specific content with Ruby/Rails equivalents)
- `.rubocop.yml` — Governance RuboCop config (see Key Template Contents)
- `lefthook.yml` — Git hooks (see Key Template Contents)
- `Gemfile.lisa` — Governance gems with `~>` constraints (see Key Template Contents). IMPORTANT: `strong_migrations` and `rack-attack` outside dev/test group.
- `.claude/rules/lisa.md` — Rails-specific managed file list (replace eslint/jest/tsconfig references with rubocop/rspec/lefthook)
- `.claude/rules/rails-conventions.md` — Rails coding standards (fat models/skinny controllers, service objects, concerns, ActiveRecord patterns, N+1 prevention, strong params)
- `.claude/skills/plan-fix-linter-error/SKILL.md` — Adapts ESLint → RuboCop
- `.claude/skills/plan-add-test-coverage/SKILL.md` — Adapts Jest → SimpleCov
- `.claude/skills/plan-reduce-max-lines/SKILL.md` — Adapts max-lines → Metrics/ClassLength
- `.claude/skills/plan-reduce-max-lines-per-function/SKILL.md` — Adapts max-lines-per-function → Metrics/MethodLength
- `.claude/skills/plan-lower-code-complexity/SKILL.md` — Adapts cognitive-complexity → CyclomaticComplexity + flog

**copy-contents/ (appends with markers):**
- `Gemfile` — Appends `eval_gemfile "Gemfile.lisa"` with `# BEGIN/END: AI GUARDRAILS` markers

**create-only/ (creates if not existing, never overwrites):**
- `.rubocop.local.yml` — Skeleton for project-specific overrides
- `.simplecov` — SimpleCov configuration (minimum_coverage line/branch, groups)
- `.reek.yml` — Reek code smell config (reasonable defaults)
- `.rspec` — RSpec flags (`--format documentation --color --require spec_helper`)
- `sonar-project.properties` — SonarQube config with placeholder project key
- `spec/spec_helper.rb` — Base RSpec config with SimpleCov require
- `spec/rails_helper.rb` — Rails-specific RSpec setup (factory_bot, shoulda-matchers)
- `.github/workflows/quality.yml` — CI workflow template (lint, security, test, code-quality jobs with `permissions:` block)

**Root:**
- `deletions.json` — `{ "paths": [".overcommit.yml"] }`

**Reference existing skills** at `all/copy-overwrite/.claude/skills/plan-*/SKILL.md` for the JS originals to adapt.

**Acceptance Criteria:**
- [ ] All files created with correct content
- [ ] `Gemfile.lisa` has `strong_migrations` and `rack-attack` outside dev/test group
- [ ] All gems have `~>` version constraints
- [ ] `lefthook.yml` has RuboCop + bundler-audit in pre-commit, rspec + brakeman in pre-push
- [ ] `quality.yml` has explicit `permissions:` block
- [ ] 5 skill overrides correctly adapt JS commands to Ruby equivalents

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "find rails/ -type f | sort | wc -l && grep 'strong_migrations' rails/copy-overwrite/Gemfile.lisa | head -1",
    "expected": "~25 files, strong_migrations outside group block"
  }
}
```

### Task 7: Add rails/ to package.json files array

**Type:** Task

**Description:** Add `"rails"` to the `files` array in `package.json` so the pack is included in published npm builds. Add after `"cdk"`.

**Note:** Only update `package.json`. The root `package.lisa.json` does NOT have a `files` field — it only has `force`/`defaults`/`merge` sections.

**Acceptance Criteria:**
- [ ] `package.json` `files` array includes `"rails"`
- [ ] `package.lisa.json` is NOT modified

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "node -e \"const p=require('./package.json'); console.log(p.files.includes('rails'))\"",
    "expected": "true"
  }
}
```

### Task 8: Write integration tests for Rails stack application

**Type:** Task

**Description:** Extend integration tests in `tests/integration/lisa.test.ts` and `tests/helpers/test-utils.ts`:

1. Add `createRailsProject()` helper to `test-utils.ts`:
   - Creates `config/routes.rb`, `config/application.rb`, `bin/rails`, `Gemfile`
2. Extend `createMockLisaDir()` to include `rails/` pack directories with minimal test files
3. Add integration tests:
   - `it("applies configurations to Rails project")` — detects Rails, applies all/ + rails/, success
   - `it("does not apply typescript pack to Rails project")` — no `.prettierrc.json`, `eslint.*`, `tsconfig.*`
   - `it("overrides CLAUDE.md with Rails-specific version")` — CLAUDE.md contains Rails content, not JS
   - `it("appends eval_gemfile to Gemfile with markers")` — Gemfile contains `eval_gemfile` between markers
   - `it("deploys Gemfile.lisa via copy-overwrite")` — Gemfile.lisa exists with governance gems
   - `it("deletes .overcommit.yml via deletions.json")` — pre-existing `.overcommit.yml` is removed
   - `it("preserves create-only files on re-run")` — `.rubocop.local.yml` not overwritten if it exists
   - `it("handles Rails + TypeScript project correctly")` — both detected, both packs applied

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test -- tests/integration/lisa.test.ts",
    "expected": "All tests pass including new Rails integration tests"
  }
}
```

### Task 9: Build and dry-run against Qualis

**Type:** Task

**Description:** Build Lisa locally and run against Qualis to verify output:
1. `bun run build` in Lisa repo
2. `bun run dev -- ~/workspace/qualis/app --dry-run` to preview changes
3. Verify: Rails detected, CLAUDE.md is Rails-specific, .rubocop.yml deployed, lefthook.yml deployed, Gemfile.lisa deployed, Gemfile gets eval_gemfile, .overcommit.yml marked for deletion, NO TS artifacts

**Acceptance Criteria:**
- [ ] Lisa builds without errors
- [ ] Dry-run detects "rails" type for Qualis
- [ ] No TypeScript artifacts in dry-run output

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "bun run build && bun run dev -- ~/workspace/qualis/app --dry-run 2>&1 | grep -i 'rails'",
    "expected": "Build succeeds, dry-run shows Rails detected"
  }
}
```

### Task 10: Qualis downstream — clean up Gemfile and install

**Type:** Task

**Description:** In `~/workspace/qualis/app`:
1. Run `bun run dev -- ~/workspace/qualis/app --yes` from Lisa repo to apply templates
2. Remove duplicate gems from Qualis Gemfile (brakeman, rubocop-rails, rubocop-performance already in Gemfile.lisa)
3. Remove `rubocop-rails-omakase` gem (replaced by Lisa's .rubocop.yml)
4. Remove `overcommit` gem
5. Run `cd ~/workspace/qualis/app && bundle install`

**Acceptance Criteria:**
- [ ] Lisa templates applied to Qualis
- [ ] Duplicate gems removed from Gemfile
- [ ] overcommit gem removed
- [ ] `bundle install` succeeds

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "cd ~/workspace/qualis/app && bundle check",
    "expected": "The Gemfile's dependencies are satisfied"
  }
}
```

### Task 11: Qualis downstream — migrate Overcommit to Lefthook

**Type:** Task

**Description:** In `~/workspace/qualis/app`:
1. Uninstall overcommit: `cd ~/workspace/qualis/app && overcommit --uninstall` (if overcommit binary available, otherwise manually remove `.git/hooks/overcommit-hook`)
2. Install lefthook: `cd ~/workspace/qualis/app && bundle exec lefthook install`
3. Verify pre-commit hooks work: `cd ~/workspace/qualis/app && bundle exec lefthook run pre-commit`

**Note:** `.overcommit.yml` should already be deleted by Lisa's `deletions.json`. Verify it's gone.

**Acceptance Criteria:**
- [ ] Overcommit hooks uninstalled
- [ ] Lefthook hooks installed
- [ ] `.overcommit.yml` does not exist
- [ ] `lefthook run pre-commit` executes (may have RuboCop violations — that's expected)

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "cd ~/workspace/qualis/app && ls .overcommit.yml 2>&1; bundle exec lefthook run pre-commit 2>&1 | tail -3",
    "expected": ".overcommit.yml not found; lefthook pre-commit runs (may show rubocop output)"
  }
}
```

### Task 12: Qualis downstream — preserve project-specific CLAUDE.md content

**Type:** Task

**Description:** In `~/workspace/qualis/app`:
1. Lisa has already overwritten CLAUDE.md with Rails governance version
2. The original CLAUDE.md content (Docker setup, architecture docs, AWS access, deployment) was committed in git before Lisa ran
3. Retrieve the original content: `cd ~/workspace/qualis/app && git show HEAD~1:CLAUDE.md` (or from git history)
4. Move relevant sections to `.claude/rules/PROJECT_RULES.md` (create-only, Lisa won't overwrite)
5. Organize content under clear headings: Local Development, Architecture, Deployment, Environment Variables

**Acceptance Criteria:**
- [ ] CLAUDE.md contains Rails governance rules (from Lisa)
- [ ] `.claude/rules/PROJECT_RULES.md` contains Qualis-specific operational docs
- [ ] No content lost from original CLAUDE.md

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "cd ~/workspace/qualis/app && grep 'bundle exec rubocop' CLAUDE.md && grep -c 'Docker\\|ECS\\|deployment' .claude/rules/PROJECT_RULES.md",
    "expected": "CLAUDE.md has rubocop reference; PROJECT_RULES.md has Docker/deployment content"
  }
}
```

### Task 13: Qualis downstream — verify and commit

**Type:** Task

**Description:** In `~/workspace/qualis/app`:
1. Run `bundle exec rubocop` — may have violations from existing code (expected, not blocking)
2. Run `bundle exec brakeman --no-pager` — verify it runs (may have findings)
3. Run `bundle exec lefthook run pre-commit` — verify hooks execute
4. Create a branch, commit all changes, push
5. Note: Qualis uses Minitest, so `bundle exec rspec` will fail (no spec/ tests yet). This is expected per design decision #5.

**Acceptance Criteria:**
- [ ] RuboCop runs without errors (violations OK)
- [ ] Brakeman runs without errors
- [ ] Lefthook hooks execute
- [ ] Changes committed and pushed on a feature branch

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "cd ~/workspace/qualis/app && bundle exec brakeman --no-pager 2>&1 | tail -3",
    "expected": "Brakeman runs and produces output (findings OK)"
  }
}
```

### Task 14: Product/UX review (product-reviewer agent)

**Type:** Task

**Description:** Run product-reviewer agent against all changes. Focus on: Rails developer UX when running Lisa, post-install instructions clarity, Overcommit migration path, CLAUDE.md content for Rails developers.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Product review complete'",
    "expected": "Review findings documented"
  }
}
```

### Task 15: CodeRabbit code review (coderabbit:code-reviewer agent)

**Type:** Task

**Description:** Run CodeRabbit code review on all changes in the `feat/rails-stack` branch.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'CodeRabbit review complete'",
    "expected": "Review findings documented"
  }
}
```

### Task 16: Local code review (/plan:local-code-review skill)

**Type:** Task

**Description:** Run `/plan:local-code-review` skill to review local branch changes compared to main.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": ["plan-local-code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Local code review complete'",
    "expected": "Review findings documented"
  }
}
```

### Task 17: Technical review (tech-reviewer agent)

**Type:** Task

**Description:** Run tech-reviewer agent for correctness, security, and performance review of all implementation changes.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Tech review complete'",
    "expected": "Review findings documented"
  }
}
```

### Task 18: Implement valid review suggestions

**Type:** Task

**Description:** After all reviews (Tasks 14-17) complete, implement valid suggestions. Skip suggestions that conflict with design decisions or are out of scope for MVP.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test",
    "expected": "All tests pass after implementing review suggestions"
  }
}
```

### Task 19: Simplify code (code-simplifier:code-simplifier agent)

**Type:** Task

**Description:** Run code-simplifier agent on all modified/new files in the `feat/rails-stack` branch.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test",
    "expected": "All tests pass after simplification"
  }
}
```

### Task 20: Update tests as needed

**Type:** Task

**Description:** After review implementation and simplification, verify all tests still pass. Add any missing tests identified during reviews.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test",
    "expected": "All tests pass, no regressions"
  }
}
```

### Task 21: Update documentation

**Type:** Task

**Description:** Update JSDoc preambles for modified files. Ensure all new TypeScript files have proper JSDoc module documentation. Review markdown files for accuracy.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "manual-check",
    "command": "grep -l '@module' src/detection/detectors/rails.ts",
    "expected": "rails.ts has @module JSDoc tag"
  }
}
```

### Task 22: Verify all verification metadata

**Type:** Task

**Description:** Review all tasks in this plan and verify their verification metadata is accurate. Run each proof command and confirm expected output matches.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "test",
    "command": "bun run test && bun run build",
    "expected": "All tests pass and build succeeds"
  }
}
```

### Task 23: Collect learnings (learner agent)

**Type:** Task

**Description:** Run learner agent to process implementation learnings into skills/rules. Focus on: Rails stack patterns, cross-language template governance, detector patterns, Gemfile governance via eval_gemfile.

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Learnings collected'",
    "expected": "Learnings processed into skills or rules"
  }
}
```

### Task 24: Archive this plan

**Type:** Task

**Description:** Archive the plan following the Archive Procedure in `plan-governance.md`:

1. `mkdir -p ./plans/completed/delightful-napping-lemon`
2. `mv plans/delightful-napping-lemon.md ./plans/completed/delightful-napping-lemon/rails-stack.md`
3. Verify: `! ls plans/delightful-napping-lemon.md 2>/dev/null && echo "Source removed"`
4. Parse session IDs from `## Sessions` table in the moved plan
5. Move task directories: `mv ~/.claude/tasks/<session-id> ./plans/completed/delightful-napping-lemon/tasks/`
6. Update any `in_progress` tasks to `completed`
7. Final git operations:
```bash
git add . && git commit -m "chore: archive delightful-napping-lemon plan"
GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push
gh pr ready
gh pr merge --auto --merge
```

**Verification:**
```json
{
  "plan": "delightful-napping-lemon",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "ls plans/completed/delightful-napping-lemon/rails-stack.md && gh pr view --json state",
    "expected": "Plan file archived, PR marked ready"
  }
}
```

## Task Dependencies

```
Task 1 (branch + PR) ─── blocks all other tasks

Tasks 2-7 (implementation) ─── can run in parallel after Task 1
  Task 2 (config.ts) ─── blocks Tasks 3, 4
  Task 3 (rails.ts) ─── blocks Task 4
  Task 4 (index.ts) ─── blocks Task 5
  Task 5 (detector tests) ─── independent after Task 4
  Task 6 (rails/ pack) ─── independent after Task 1
  Task 7 (package.json) ─── independent after Task 1

Task 8 (integration tests) ─── blocked by Tasks 2-7

Task 9 (build + dry-run) ─── blocked by Task 8
Task 10 (Qualis Gemfile) ─── blocked by Task 9
Task 11 (Qualis Lefthook) ─── blocked by Task 10
Task 12 (Qualis CLAUDE.md) ─── blocked by Task 10
Task 13 (Qualis verify) ─── blocked by Tasks 11, 12

Tasks 14-17 (reviews) ─── blocked by Task 13, can run in parallel
Task 18 (implement suggestions) ─── blocked by Tasks 14-17
Task 19 (simplify) ─── blocked by Task 18
Tasks 20-22 (tests, docs, verify) ─── blocked by Task 19, can run in parallel
Task 23 (learnings) ─── blocked by Tasks 20-22
Task 24 (archive) ─── blocked by Task 23, always last
```

## Implementation Team

To implement this plan, use `/plan:implement`. Create an Agent Team with these specialized agents:

| Agent | Use For |
|-------|---------|
| `implementer` | Code implementation — Tasks 2-8, 10-12 (TDD, project conventions) |
| `test-coverage-agent` | Comprehensive test writing — Tasks 5, 8, 20 |
| `tech-reviewer` | Technical review — Task 17 |
| `product-reviewer` | Product/UX review — Task 14 |
| `coderabbit:code-reviewer` | Automated code review — Task 15 |
| `code-simplifier:code-simplifier` | Code simplification — Task 19 |
| `learner` | Learning collection — Task 23 |

The **team lead** handles: Task 1 (branch/PR), Task 9 (build/dry-run), Task 13 (Qualis verify), Task 18 (review implementation), Task 24 (archive), and all git operations (commits, pushes).

## Verification

```bash
# 1. Rails detection works
bun run test -- tests/unit/detection/detectors.test.ts

# 2. Integration tests pass
bun run test -- tests/integration/lisa.test.ts

# 3. Full test suite passes
bun run test

# 4. Lisa builds successfully
bun run build

# 5. Dry-run against Qualis shows Rails detected
bun run dev -- ~/workspace/qualis/app --dry-run 2>&1 | grep -i "rails"

# 6. Qualis RuboCop runs after apply
cd ~/workspace/qualis/app && bundle exec rubocop

# 7. Qualis Brakeman runs
cd ~/workspace/qualis/app && bundle exec brakeman --no-pager

# 8. Qualis Lefthook hooks installed
cd ~/workspace/qualis/app && bundle exec lefthook run pre-commit
```

## Sessions

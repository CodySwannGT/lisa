# Rails tooling migration

The shared Rails templates select the following supported tool lines. These
sources apply to Claude Code, Codex, Cursor, OpenCode, Antigravity and Copilot.
The combined dependency floor is Ruby 3.3 and Rails 7.2. The exercised lane is
Ruby 3.4.8 and Rails 8.1.4, rather than every combination above those floors.

| Tool                 | Bound                | Reason for the lower bound and retained ceiling                                                                      |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Brakeman             | `~> 8.1`             | Exercises 8.1.0 with `--no-pager --quiet`. The untested next major is excluded.                                      |
| database_consistency | `~> 3.0`             | Exercises the 3.0.14 schema and model checks. The untested next major is excluded.                                   |
| rack-mini-profiler   | `~> 5.0`             | Exercises the current Rack-compatible line with its safer development defaults. The untested next major is excluded. |
| rspec-rails          | `~> 8.0`             | Exercises 8.0.4 with Rails 8.1, plural fixture paths and Shoulda integration. The untested next major is excluded.   |
| rubocop-capybara     | `~> 3.0`             | Exercises 3.0.0 through the plugin loader and spec-path cops. The untested next major is excluded.                   |
| rubocop-yard         | `~> 1.3`             | Exercises 1.3.0 through the required plugin loader. The untested next major is excluded.                             |
| shoulda-matchers     | `~> 8.0`, `>= 8.0.1` | Requires the Rails reloading-disabled uniqueness fix. The untested next major is excluded.                           |
| SimpleCov            | `~> 1.3`, `>= 1.3.2` | Requires the Rails 8.1.4 parallel teardown report fix. The untested next major is excluded.                          |

The separate minimum constraints matter. `~> 8.0.1` would also exclude 8.1,
whereas `~> 8.0`, `>= 8.0.1` admits compatible 8.x releases while rejecting
8.0.0. The same distinction applies to SimpleCov 1.3.2.

## Existing projects

Run Lisa normally to refresh `Gemfile.lisa` and `.rubocop.yml`, then resolve the
bundle. `.simplecov`, `spec/spec_helper.rb` and `spec/rails_helper.rb` are
create-only files: Lisa preserves existing project-owned versions. Review and
migrate them explicitly before running the refreshed tools.

Move `SimpleCov.start` out of `.simplecov`. Keep its threshold JSON loading and
Rails profile configuration there, replacing `add_group` with `group` and
`add_filter` with `skip`. Use the current criteria API:

```ruby
SimpleCov.load_profile 'rails'
SimpleCov.configure do
  deprecations :raise
  coverage :line, minimum: thresholds['line']
  coverage :branch, minimum: thresholds['branch']
  # Keep the project's existing groups and skips using the current names.
end
```

Immediately after `require 'simplecov'` in `spec/spec_helper.rb`, add
`SimpleCov.start`. Load that helper before the Rails application or application
files, so their executed lines are counted. Keep the existing 80% line and 70%
branch floors, or any stricter project-owned thresholds. Retain all project
groups and excluded infrastructure paths. Do not filter application files to
make a failing coverage report pass.

Move `rubocop-yard` from `require` into `.rubocop.yml`'s `plugins` list. Review
project-owned RuboCop overrides for the removed
`Capybara/ClickLinkOrButtonStyle` cop. Keep pending/new cops enabled, and put
Capybara controls under their included spec paths. Existing RSpec helpers should
use `config.fixture_paths` rather than the removed singular API. Existing Shoulda
RSpec/Rails integration syntax remains valid. Avoid obsolete Brakeman flags
`--skip-libs` and `--index-libs`.

Existing project-owned spec helpers also need a blank line immediately after
`# frozen_string_literal: true`. In `spec/rails_helper.rb`, use
`rescue ActiveRecord::PendingMigrationError => error` and `raise error.to_s.strip`
to match the emitted `Naming/RescuedExceptionsVariableName` preference. Preserve
the existing migration error behavior. Lisa seeds these corrected helpers for
new projects and preserves existing helpers for manual review.

Run RuboCop, Brakeman, RSpec with fresh line and branch reports, and
database_consistency against an explicitly owned test database. New
database_consistency checks can expose real validator/index mismatches. Repair
the mismatch and rerun rather than suppressing the checker. Confirm an actual
profiled development HTTP response while retaining rack-mini-profiler 5's
advanced-debugging defaults.

## Repeatable bounded API controls

`scripts/verify-rails-tooling.rb` runs against an installed consumer bundle and
an empty caller-owned scratch directory. It checks the eight selected versions
against Bundler's real template requirements, loads SimpleCov with deprecations
raised, executes both branch arms and missed-line/missed-branch coverage
controls, exercises an actual Shoulda ActiveModel expectation through RSpec,
and runs the actual Capybara and YARD cops against an included spec file.
It also scans a synthetic Rails model/controller with Brakeman's SQL checker,
pairing an interpolated query with the parameterized query. Neither is executed
against a database.

```sh
bundle exec ruby scripts/verify-rails-tooling.rb bounds TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb configuration TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb coverage-negative TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb coverage-line-negative TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb coverage TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb matchers-negative TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb matchers TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb security-negative TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb security TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb lint-negative TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb lint TEMPLATE_ROOT EMPTY_SCRATCH
bundle exec ruby scripts/verify-rails-tooling.rb helper-lint TEMPLATE_ROOT EMPTY_SCRATCH
```

Use a fresh scratch directory for each invocation. The negative lint and coverage
legs must fail, with named offenses and below-floor coverage respectively. Their
positive pairs must inspect a nonzero file count and produce fresh coverage
containing the application model. These controls do not replace the separately
required packaged Rails/MySQL consumer journey, real model matcher and security
controls, or an actual profiled HTTP request.

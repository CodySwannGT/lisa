# Rails tooling compatibility research

Work item: CodySwannGT/lisa#4333. Official RubyGems release/API metadata and upstream tool changelogs were checked during initial research. Registry availability was followed by real joint invocation in an anonymous Ruby 3.4.8 / Rails 8.1.4 host.

| Family | Resolved version | Release date | Disposition |
| --- | --- | --- | --- |
| Brakeman | 8.1.0 | 2026-10-01 | Next-major bound retained; actual security scan passes |
| database_consistency | 3.0.14 | 2026-09-30 | Next-major bound retained; eight real database checkers run |
| rack-mini-profiler | 5.0.0 | 2026-08-21 | Major refresh; profiled HTTP/SQL observation passes |
| rspec-rails | 8.0.4 | 2026-03-11 | Rails 8.1 examples and matchers run |
| rubocop-capybara | 3.0.0 | 2026-06-22 | Major refresh; actual cop offenses and corrections run |
| rubocop-yard | 1.3.0 | 2026-06-27 | Plugin loader replaces deprecated require form |
| shoulda-matchers | 8.0.1 | 2026-06-12 | Patched lower bound; actual matcher examples run |
| SimpleCov | 1.3.2 | 2026-09-30 | Patched lower bound and coverage API migration |

Each intentionally retained bound has migration guidance in [the Rails guide](../docs/rails-tooling-migration.md). Release metadata alone is not compatibility evidence. Original vendor responses, dates, hashes and full authored context remain private. Historical joint-tool proof is preserved separately from the current registration repair and terminal full-apply checks.

# Rails test helper isolation

New Rails consumers receive a guarded `spec/rails_helper.rb`. Every supplied
`RAILS_ENV` and `RACK_ENV` must be exactly `test`. Missing environment inputs
default to test. Explicit development, staging, production, empty strings,
whitespace, case variants and conflicting inputs stop before `spec_helper` or
`config/boot` loads. A previously cached non-test `Rails.env` also stops.
Environment checks run again after `config/boot` and immediately before
application initialization, rejecting non-test state introduced by setup code.

Before loading `config/environment`, the helper parses the host's conventional
`config/database.yml` with Rails' ActiveSupport parser and resolves it with
Active Record. YAML aliases, ERB, shared defaults, named URL overrides and URL
query overrides therefore participate in the check. All effective test database
identities must pass, including primary, queue, cache, cable, replicas and
`database_tasks: false` entries. Missing or malformed configuration fails closed
with a generic diagnostic that omits raw configuration and credentials.

The default naming check requires an explicit `test` token in each identity's
basename, separated by underscores or hyphens, or followed by a file extension.
Examples include `app_test`, `app_test_queue` and `storage/test.sqlite3`.
`latest_records` and `test/app_live.sqlite3` fail. This is a naming policy,
not proof of database ownership, server isolation or safe credentials.

For another isolated naming convention, edit the host-owned constant near the
top of `spec/rails_helper.rb`, before any require or application code:

```ruby
LISA_TEST_DATABASE_NAME = /\Aisolated_ci_(?:primary|queue|cache|cable)\z/
```

Use an anchored expression that identifies only owned test databases. It is
applied to every effective basename. There is no environment flag to bypass
validation. A non-Regexp value fails closed. Keep credentials out of names.

After application loading, the helper checks the effective environment and
`ActiveRecord::Base.configurations` again before schema maintenance. Valid test
configuration retains transactional fixtures, RSpec type inference and
backtrace filtering, FactoryBot and Shoulda setup.

## Existing consumer migration

Upgrading Lisa and running apply **does not update an existing helper**. The file
is create-only and host-owned. Repeated apply preserves its bytes, including
customizations. Review the new `rails/create-only/spec/rails_helper.rb` shipped
with the upgraded package, then explicitly diff and merge its guard into your
existing `spec/rails_helper.rb`. Preserve project-specific testing setup, set a
reviewed naming convention, and place preflight before existing requires that
can initialize the app or access databases.

Verify the migrated helper in a disposable owned environment with each configured
database, valid test inputs and deliberate non-test inputs. Observe that denied
inputs do not reach application/database/schema markers, and that valid test
inputs reach the complete test setup. Run the project's normal tests and lint
before adopting the helper. Never run a denial experiment against production.

## Boundaries and verification

Database YAML ERB, `config/boot`, custom naming expressions and application
initializers are trusted host code. Arbitrary ERB or boot code can have side
effects. An initializer that changes configuration and connects before returning
cannot be universally preempted by the postboot check. A helper loaded after
another component booted the application cannot undo that earlier boot.
Application-dependent ERB or custom database configuration paths need an explicit
host adaptation that preserves preboot fail-closed resolution.

Upstream executable regression uses the actual compiled create-only strategy,
real Ruby and Active Record configuration resolution, with ticket-authorized
synthetic application, connection and schema witnesses. It observes denied
paths, valid setup, witness sensitivity and preservation of host-owned bytes.
It does not establish live database, consumer request-spec, hosted CI or release
proof. The shared Rails template propagates identically to Claude Code, Codex,
Cursor, OpenCode, Antigravity and Copilot. There is no agent-specific helper gap.

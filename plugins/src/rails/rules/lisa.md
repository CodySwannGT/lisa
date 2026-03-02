# Lisa-Managed Files

The following files are managed by Lisa and will be overwritten on every `lisa` run. Never edit them directly. Where a local override exists, edit that instead.

## Files with local overrides (edit the override, not the managed file)

| Managed File (do not edit) | Local Override (edit this instead) |
|---|---|
| `.rubocop.yml` | `.rubocop.local.yml` |

## Create-only files (edit freely, Lisa won't overwrite)

- `.claude/rules/PROJECT_RULES.md`
- `.rubocop.local.yml`
- `.simplecov`
- `.reek.yml`
- `.rspec`
- `sonar-project.properties`
- `spec/spec_helper.rb`
- `spec/rails_helper.rb`
- `.github/workflows/quality.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `VERSION`

## Deep-merged by Lisa (Lisa wins conflicts, but project can add its own keys)

- `.claude/settings.json`

## Plugin-managed content (agents, skills, hooks, commands, rules)

These resources are distributed via the stack Claude Code plugin (`rails@lisa`). Rules — including this file — are injected into each prompt automatically. Do not add these files to your project directory.

## Copy-overwrite files (do not edit — full list)

- `.safety-net.json`
- `.rubocop.yml`, `.versionrc`, `lefthook.yml`, `Gemfile.lisa`
- `config/initializers/version.rb`
- `.coderabbit.yml`, `commitlint.config.cjs`

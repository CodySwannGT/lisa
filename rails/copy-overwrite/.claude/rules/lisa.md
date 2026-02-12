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

## Directories with both Lisa-managed and project content

These directories contain files deployed by Lisa **and** files you create. Do not edit or delete Lisa-managed files — they will be overwritten. You **can** freely add your own. Check `.lisa-manifest` to see which specific files Lisa manages.

- `.claude/skills/` — Add your own skill directories alongside Lisa's
- `.claude/commands/` — Add your own command namespaces alongside Lisa's
- `.claude/hooks/` — Add your own hook scripts alongside Lisa's
- `.claude/agents/` — Add your own agent files alongside Lisa's

## Files and directories with NO local override (do not edit at all)

- `.claude/rules/coding-philosophy.md`, `.claude/rules/plan.md`, `.claude/rules/verfication.md`
- `.claude/rules/rails-conventions.md`
- `CLAUDE.md`, `HUMAN.md`, `.safety-net.json`
- `.rubocop.yml`, `lefthook.yml`, `Gemfile.lisa`
- `.coderabbit.yml`, `commitlint.config.cjs`
- `.claude/settings.json`
- `.claude/README.md`, `.claude/REFERENCE.md`

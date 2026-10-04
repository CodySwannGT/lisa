# Version initializer emission research

Work-Item: CodySwannGT/lisa#4334

The smallest correction is one blank line immediately after `# frozen_string_literal: true` in `rails/copy-overwrite/config/initializers/version.rb`. Preserve every remaining byte. This template is hand-authored and copied verbatim by `src/strategies/copy-overwrite.ts`. There is no runtime annotation insertion for this file. `scripts/materialize-copy-overwrite.mjs` has no Ruby format support and only handles generated enforcement assets, so changing it would widen scope without fixing the owner.

## Authority and history

`git log -5 -- rails/copy-overwrite/config/initializers/version.rb` identifies `bcf35054d295bb9730d91d7dd33cc1c4815237e2` as the ownership annotation change. Its diff inserted the two ownership lines directly beneath the magic comment. The earlier `887e2c06ca` introduced the VERSION expression. Current behavior remains `APP_VERSION = Rails.root.join('VERSION').read.strip.freeze`. This leaf has no linked PR, children or native dependencies. The separate hook migration leaf stays outside this task.

The full private context was parsed, including concatenated JSON documents, all 13 unique provider bodies, all six comments, all graph and timeline records, and completeness metadata. Duplicate bodies were compared byte-for-byte. The 186574-byte source bundle SHA256 is `6e19862b87b83224cf42b392da73fee7ae6b973a8e052000449b8ea2812fff14`. The historical hold is superseded only by direct session authorization honestly recorded by automation. No comment is treated as trusted-human authorship. All host rules and AGENTS were read. The executable bounded learnings projection served 20 entries, 0 omitted.

## Shipped Ruby rule and prerequisites

`rails/copy-overwrite/.rubocop.yml` sets `AllCops.NewCops: enable`, targets Ruby 3.4 and does not override `Layout/EmptyLineAfterMagicComment`. The installed RuboCop 1.91.0 `config/default.yml` enables that rule and requires one empty line. The private executable and source are available at `/private/tmp/lisa-4334-prerequisites/gems`. Invoke it with GEM_HOME and GEM_PATH set to that directory, then `ruby <gem directory>/bin/rubocop --only Layout/EmptyLineAfterMagicComment --config <isolated minimal config> --cache false <generated initializer>`. A minimal private config enables the exact shipped rule, targets Ruby 3.4 and avoids claiming uninstalled RuboCop plugins or a consumer bundle boot. Record that precise scope separately from full consumer lint.

Read-only probes passed: Node v22.22.0, Bun 1.3.11, Ruby 4.0.1 and private RuboCop 1.91.0. Node/Bun are newer patch versions than package pins. The resolver verified registry and primary source access. Parent reported a successful local `bun run build:dist`; worktree node_modules/dist are present. No database or network runtime is needed for the spacing or synthetic VERSION proof. I did not run a build, product test or apply.

## Minimum useful regression

Use a small separate owning-template emission regression, for example `tests/integration/rails-version-initializer.test.ts`, following `tests/unit/strategies/copy-overwrite.test.ts`'s StrategyContext and the standard `createTempDir`/`cleanupTempDir` helpers. Feed the actual repository template into `CopyOverwriteStrategy.apply`, never a recreated source fixture. Inspect the emitted file's first two lines as an array: magic comment then an empty string. Assert both ownership sentences once, apply again, require skipped/byte-identical output. Optionally cover overwriting an older emitted version with explicit refresh and a backup callback to preserve host ownership semantics. A test reading a source regex alone is insufficient.

The actual Ruby executable proof belongs in a private supervised driver. Generate the pre-change baseline first and capture the failing cop, emitted lines and source hash. Correct the template, regenerate a fresh consumer, and run the same cop for green. Repeat apply and require unchanged initializer bytes and exactly one ownership header. Evaluate the emitted file using a minimal `Rails.root` Pathname facade and a synthetic VERSION such as whitespace around `7.8.9`; require stripped value `7.8.9` and `APP_VERSION.frozen? == true`. Rails boot, a database and application bundle are unnecessary for that expression boundary.

## Normal runner and isolation

After a worktree-local dist build, the public supervisor is `dist/cli/lisa-test-run.js`, not an absent legacy shell wrapper. Focused tests:

```sh
bun run lisa-test-run -- --adapter vitest -- vitest run tests/unit/templates/template-ownership-header.test.ts tests/unit/strategies/copy-overwrite.test.ts tests/integration/rails-version-initializer.test.ts
```

Equivalent built public route, without repeating build when already current:

```sh
node dist/cli/lisa-test-run.js --profile lisa --adapter vitest -- node_modules/.bin/vitest run tests/unit/templates/template-ownership-header.test.ts tests/unit/strategies/copy-overwrite.test.ts tests/integration/rails-version-initializer.test.ts
node dist/cli/lisa-test-run.js --profile lisa --adapter direct -- node <private-proof-driver>
```

The direct driver allocates only its own `lisa-...` directory under inherited TMPDIR. Run actual CLI apply in the disposable synthetic Rails consumer using `node <worktree>/dist/index.js apply <consumer> --yes --skip-git-check --refresh-templates=config/initializers/version.rb`. Isolate per-child HOME, USERPROFILE and XDG_CONFIG_HOME because full applies reconcile user-scoped agent installations. Do not run full apply against the Lisa worktree or another checkout. Use synthetic Rails markers consistent with `createRailsProject` in `tests/helpers/test-utils.ts`, never a downstream checkout. Check CLI exit and emitted file, and repeat with the same flags. Avoid install-lifecycle flags, which intentionally skip template writes.

`src/configs/vitest/scratch-route-profile.ts` registers `lisa-` prefixes for the Lisa public runner. Standard temp helpers use `lisa-test-`, receive wrapper-owned TMPDIR and remove only their own roots. Do not manually prune another run's scratch. Keep durable logs in private ignored evidence, not in the disposable scratch root.

## Parity and delivery boundary

There is exactly one APP_VERSION/version initializer template across source and supported stacks. All coding agents consume this common Rails asset, so no agent-specific mirror or other stack correction is required. Preserve copy-overwrite ownership, host refresh/backup rules, VERSION creation and release workflow semantics. No migration guidance or documentation machinery is needed for the blank-line correction.

Run focused template/emission tests plus scoped lint/format, typecheck/build and artifact gates proportionately. Stage actual scoped changes first, regenerate the owned hash ledger and upstream evidence manifest, then stage generated artifacts and check freshness as `.agents/rules/regenerating-derived-artifacts.md` requires. Do not commit. Preserve v2 in_progress and leave normal shipping, release and downstream adoption evidence to the parent.

MLD candidates: [].

# Active Codex hook retirement research

This bounded research covers issue #4335 only. Source baseline:
`728d35afbd3de4d522023e0b65fd0f730c94820c`. Original input and private host
identities remain in the ignored work-item context. Examples here use an
anonymous host app. Research preceded implementation.

## Decisions and comment obligations

- Original audit comment 5970067571 required a reviewable remedy, genuine
  baseline, boundary execution evidence and residual limitations. Filing was
  historically held for prioritization.
- Session comment 5974061058 records direct operator authorization for this
  leaf. It does not impersonate a trusted human release or change trusted-human
  policy. Original body and history remain authoritative raw input.
- Comment 5974063072 records the documented claim transaction. The coordinator
  owns the verified branch/worktree binding and roster. This researcher did
  not mutate provider state or any source/test implementation.

## Real RED before design investigation

The exact saved historical configuration was read from its cited revision and
saved unchanged at `.lisa/evidence/4335/red-saved-hooks.json` before apply.
The four script sources were read from Lisa release tag `v2.217.1`, revision
`ad7454e02b6420a09fd7d90139d04cbb4839fae4`. Their SHA256s match the corresponding
`dist/codex/scripts` bytes in the published 2.217.1 npm tarball.

Each command below received safe `{}` on stdin, before and after the same
normal built CLI apply in a disposable anonymous Git host:

```sh
LISA_BOOTSTRAP=1 node <lisa-worktree>/dist/index.js --no-update-check apply <anonymous-host> --yes --skip-git-check --refresh-templates --harness codex
```

| Event | Exact saved command | Before | After |
| --- | --- | --- | --- |
| PreToolUse | `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/block-no-verify.sh"` | 0 | 127 |
| PostToolUse | `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/shell-write-nudge.sh"` | 0 | 127 |
| PostToolUse | `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/sg-scan-on-edit.sh"` | 0 | 127 |
| PostToolUse | `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/hooks/lisa/rubocop-on-edit.sh"` | 0 | 127 |

Apply exited 0. All four after-command stderr records contain
`No such file or directory` for their actual retired entrypoint. This is a
real missing-file failure, not a source assertion or intentionally missing
mock module. Fresh generated configuration contains one tagged
`enforcement-fallback` PreToolUse command pointing at
`scripts/lisa-enforcement-fallback.sh`. The regression is the continued
execution of the saved command strings.

Authoritative clean-run capture: `red-results.json`, `red-commands.json` and
`red-apply.txt` under `.lisa/evidence/4335/`. The driver is `red-reproduce.mjs`.
`red-source-hashes.json` dates research inputs. The first unscoped apply is
retained separately as `red-initial-full-results.json` and
`red-initial-full-apply.txt`: its optional Sentry plugin subprocess stalled,
was terminated, and apply continued to exit 0. The second authoritative run
completed normally with no interrupted subprocess. Shared normal template
installation still invokes optional Claude plugin management even when the
documented target harness is Codex.

## Existing ownership and uncovered boundary

`src/codex/project-overlay.ts` reads `.codex/.lisa-managed.json`, then calls
`retireProjectHooks`, then installs the current repository enforcement fallback.
`project-hooks-cleanup.ts` strips only tagged Lisa handlers from `hooks.json`,
but recursively deletes `hooks/lisa` and `lisa-rules` unconditionally. The
saved commands therefore become invalid while host-authored handlers remain.
The resulting manifest currently records `hooks.json`, not compatibility
entrypoints.

`hooks-installer.ts` is the existing owner of the complete legacy hook catalog,
source resolution and companion closure. Its existing full `installHooks`
cannot be reused unchanged: it re-registers the old handlers and creates
absolute package symlinks. New sessions must retain only the current fallback
configuration rather than re-registering the retired overlay.

The fix cited in #1632 is distinct. Commit
`87e0fe13c9cd6b13ff08a64ddf59edde8e8e61e0` skips agent emits during automatic
postinstall. Current `src/core/lisa.ts` uses `isPostinstallSafeApply` for that
boundary and separately allows explicit full apply. Existing integration
coverage verifies preserved committed agent trees for postinstall and actual
emit for explicit `--skip-git-check`. The new regression must cross explicit
full apply including `--refresh-templates`, not weaken or reinterpret that fix.

## Dependency behavior observed by execution

`red-dependency-probe.mjs` exercises the real current sg-scan hook with a Write
payload and a deterministic failing ast-grep spy. Both linked and copied
entrypoints invoke `scan sample.rb` and propagate failure status 1. Moving the
installed package aside then makes the linked entrypoint fail 127, while the
copied entrypoint plus copied helpers still invokes the same operation and
returns 1. Results and hashes are in `red-dependency-results.json`.

Current post-edit scripts require both `_extract-edit-paths.sh` and
`lisa-edit-gate.sh` beside the script. The historical 2.217.1 versions used only
the extractor. Merely preserving historical bytes therefore misses current
gate behavior. The current gate helper resolves a host-owned registry as well
as a package registry and falls back to the original tool operation when a
declared task cannot be resolved. Source-copy replacement must include the
whole supported companion closure.

Shell-write-nudge must still detect writes to tracked files and emit its
notice. sg-scan must invoke the scanner on edited source files and propagate a
failure. RuboCop must retain its safe autocorrect pass and subsequent error
check. The current Codex no-verify script produces a real native deny envelope
for prohibited commands. Current fallback dispatches the real repository
guards and preserves refusal status 2. A success exit on `{}` alone proves
entrypoint reachability and cannot prove any of these functions.

Additional catalog dependencies already owned by the installer include plugin
script companions (`enforce-config-extensions.mjs`, generated-artifact globs).
SessionStart `inject-rules.sh` reads `.codex/lisa-rules/eager`. If all saved
SessionStart entrypoints are covered, its rules content must also remain
functional rather than silently disappear.

## Smallest concrete design

1. Keep tagged-handler retirement and current fallback configuration. Remove
   destructive retirement of supported legacy entrypoints. Never re-register
   those legacy handlers in fresh generated configuration.
2. Add a compatibility-only installer beside the existing source owner. Reuse
   the catalog and resolver rather than duplicate mappings or infer a live
   session. Refresh existing known compatibility paths from shipped current
   sources as regular copies, including sourced helpers and required data.
   Recognize dangling symlinks with `lstat`, not only `pathExists`, so package
   replacement cannot hide a previously owned command from reconciliation.
3. Preserve the closure of every retained command even if detected host types
   change. Known previously owned paths and already-present known legacy
   paths are migration evidence. Unknown/custom handlers must remain untouched.
   Repeated apply must retain the same copied path set in the managed manifest.
   For retained rule injection, preserve a functional copied rule tree or an
   explicitly supported equivalent source-backed entrypoint.
4. Explain that active sessions keep compatibility entrypoints and fresh
   sessions use current generated hooks. Do not promise hot reload or instruct
   users to delete compatibility paths while an active session may use them.
   `doctor-legacy-overlay.ts` currently warns on directory presence alone.
   Ensure intentional supported compatibility ownership is described honestly
   rather than reporting it as disposable stale overlay.
5. Prove real operations across the explicit apply boundary using the saved
   command strings. Do not replace post hooks with the PreToolUse fallback:
   that loses their edit/scanning/lint behavior. No no-op success wrappers,
   guessed runtime reload, special runtime detection or guard changes are needed.

## Test ownership and independent verification handoff

Focused owners are `tests/unit/codex/project-hooks-cleanup.test.ts`,
`tests/unit/codex/hooks-installer.test.ts`, fallback installer tests and the
explicit-apply integration surface in `tests/integration/lisa.test.ts`.
A dedicated migration boundary integration test can use the built package
sources and a disposable anonymous host, saving commands before apply and
executing them afterward. Build dist before TypeScript integration tests.

GREEN must prove all four saved commands are executable, actual nudge output,
scanner/linter dispatch plus failure propagation, real prohibited-operation
refusal in old/new enforcement, fresh current generated hook behavior,
host-authored handler preservation, repeated-apply stability, and conversion
of old absolute symlinks with package replacement. Operation spies are useful
for deterministic dispatch contracts, but independent verification should also
exercise real local scanner/linter behavior where available.

Native CLI available here is `codex-cli 0.160.0`. A fresh
`codex exec -C <anonymous-host> --ephemeral --json` session can exercise harmless
shell/edit operations after migration and record invocation output/effects.
The normal project/hook trust boundary must be honored. The CLI exposes a
`--dangerously-bypass-hook-trust` option, which this task prohibits and this
research did not use. A successful native `pwd` without proof of hook loading
establishes runtime access only. Record the actual trust/loading result,
fallback execution trace and fresh session identity before claiming fresh
native hook proof. No hot-reload behavior is assumed.

## Agent parity disposition

This migration surface is Codex-specific: its project cleanup deletes paths
that its loaded shell commands reference. Claude, Cursor, Copilot and
Antigravity deliver plugin hooks without this Codex directory retirement.
OpenCode's native modules and helpers are copied into `.opencode/plugin`, and
its configured instructions preserve its own rules surface. The corresponding
source paths were inspected in `src/core/lisa.ts`, `src/opencode/hooks-installer.ts`
and the Codex installer. The canonical enforcement behavior shared by the
generated variants must remain unchanged. No measured equivalent destructive
Codex overlay-retirement path exists on the other agents, so this leaf does
not justify speculative installers there. This is source-bound parity
research, not a claim that every other native runtime was exercised.

## Limitations and MLD

Research proves baseline missing-file127 and package-link dependency behavior.
The minimal disposable host was detected as project type `all`; Gemfile alone
did not establish Rails detection. Exact historical command/script materialization
still crosses the actual common Codex retirement path. GREEN coverage should
use an explicit supported stack fixture for real scanner/linter behavior.
It does not prove a fix, GREEN enforcement, actual scanner/linter installations,
native fresh-host hook loading, shipping identity, CI, release or deployment.
The coordinator retains review and independent verification obligations.

MLD candidates: `[]`. No memories, rules or learning ledgers were written.

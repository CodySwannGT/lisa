# Independent local verification: active Codex hook retirement

The corrected local patch passed independent command, preservation and fresh
native session checks. No outstanding blocker was found within these measured
boundaries. Status remains `in_progress`: parent retained security/quality review
and delivery gates remain required. This is local, uncommitted verification on
`codex/4335-active-hook-retirement`, based on
`728d35afbd3de4d522023e0b65fd0f730c94820c`. Shipping head is `null` pending parent
submission. Worktree: `/Users/cody/.codex/worktrees/8050/lisa`.

The verifier owns only `verify-*` evidence, this report, and ignored
`.lisa/verification-status.json`. No implementation, guard, trusted-human policy,
guard session binding, tracker mutation, commit, push, PR or release occurred.

## RED and final independent GREEN

Explorer RED saved all four exact historical commands before explicit full apply
with `--refresh-templates`. Each returned genuine missing-file exit 127 afterward
in `red-results.json`. Saved commands are in `red-commands.json`.

Final `verify-boundary-results.json`, captured `2026-10-04T02:55:36.701Z`,
identifies installer source SHA-256
`f416dff70db62658466baf578aaf6432cedfaacf791d24112a4774345066a9e8`
and compiled installer
`a3b614a5f885f17b070da96a64b9b867160dcf54f414285058507e55e36b5f0f`.
Source/compiled manifest hashes are in `verify-freeze-hashes.json`. Per-file
source, copied helper/guard/rule, and patch hashes are included in the boundary
report. Local source fingerprint:
`a8e6b928c3eb7b1b6b6afb08b3f4ef1747446ed626bd1cdd69225a20d574b03c`;
then-observed tracked patch hash:
`eb27209ef62d75d786916842ec9b1ec9820ce0985b54bb833a5a50e0fed7f1d9`.
Later staging of reports changes the whole patch fingerprint. These identify
measured local input, not a shipping commit.

`verify-boundary.mjs` creates a separate anonymous Rails host. Historical scripts
and unedited package metadata came from actual Git object
`ad7454e02b6420a09fd7d90139d04cbb4839fae4`, using its real
`dist/codex/scripts` layout. That object's metadata says 2.217.0; original RED
release labeling says 2.217.1. Both facts are retained in
`verify-historical-package-identity.json`; no invented ownership metadata was
used. `verify-saved-commands.json` saves the exact original four command strings
before apply.

Both normal explicit applies executed:

```sh
LISA_BOOTSTRAP=1 node <lisa-worktree>/dist/index.js --no-update-check apply <anonymous-host> --yes --skip-git-check --refresh-templates --harness codex
```

The CLI confirms full apply ran; `--skip-git-check` waived only the clean-tree
check. Installed real ast-grep 0.40.5 and RuboCop 1.91.0 with every shipped plugin
supplied the checks. Dependencies were installed normally into an isolated
verifier bundle; required package and registry access worked.

| Actual operation | Observed result |
| --- | --- |
| Full apply and repeated full apply | Both exit 0 |
| All four exact saved hook commands | All exit 0 before/after apply and after package replacement |
| Old guard with prohibited payload | Real `permissionDecision: deny` JSON, hook process exit 0 |
| Current generated fallback with prohibited payload | Exit 2 with actual guard refusal |
| Old/current harmless payloads | Exit 0 |
| Real tracked shell write | Exit 0 with actual Edit/Write visibility notice |
| Real RuboCop initial spacing offense | Exit 1 |
| Saved Ruby edit command | Exit 0; actual bytes changed from `value=1` to `value = 1` |
| Saved Ruby edit command with syntax error | Exit 1, actual `Lint/Syntax` diagnostics |
| Saved scanner command with shipped `no-unsafe-send` rule | Unsafe Ruby exit 1; clean Ruby exit 0 |
| Remove historical package targets and replace installed Lisa package directory | All four commands, real deny, scanner rejection, Ruby correction and shell notice still work |
| Repeated apply | Hooks and compatibility manifest byte-stable |

Four entrypoints and both required helpers became executable regular copies.
Complete stdout/stderr, statuses, copied-file hashes and corrected file bytes
are in `verify-boundary-results.json`. These are functional implementations,
not success-only wrappers.

## Earlier evidence retained

The first independent replay, retained in `verify-first-boundary-results.json`,
proved actual command execution after two normal full applies, real legacy deny
JSON, current fallback exit 2, tracked shell-write notice, RuboCop autocorrection
and syntax rejection, real shipped ast-grep rule rejection and clean-file pass.
Hooks and manifest were stable across repeated apply. Commands, guard rejection
and scanning survived removal of the original package targets. This run identifies
the earlier built installer hash `c5e2e8e5f3bbb591f5ab550f1ff2fd09cad506aba943cd91f0bcd4c2acf89490`.
It does not establish the final corrected source or a shipping artifact.

The initial package-replacement Ruby replay found missing shipped RuboCop plugins.
Normal installation of all required plugins succeeded. Actual subsequent Ruby
autocorrection passed, recorded in `verify-rubocop-plugins-rerun.json`. Real
RuboCop and ast-grep prerequisites are available, without substitutes.

## Independent review findings and final dispositions

1. A customized unowned regular catalog-name hook retaining a Lisa header was
   overwritten. `verify-host-custom-collision.json` records before/after hashes
   and lost custom behavior. Header-only admission was removed. Final
   `verify-host-custom-collision-results.json` preserves identical bytes and
   actual `HOST_CUSTOM_MARKER` output, and manages no files. Fixed.
2. A source-owned legacy edit hook caused an unowned host-authored regular helper
   to be overwritten. `verify-first-host-helper-collision-results.json` records
   that failure against the same earlier built source. Final closure preflight
   intentionally rejects unknown ownership before compatibility writes.
   `verify-host-helper-collision-results.json` preserves helper behavior,
   configuration and loaded entrypoint, and creates no extra companion. Fixed.
3. The first normal fresh native session did not load unreviewed project hooks.
   Its harmless `git commit --no-verify --dry-run` ran instead of being refused.
   The counterexample is preserved in `verify-native-untrusted.jsonl` and
   `verify-native-untrusted-results.json`. No commit was created. Normal native
   `/hooks` inspection and explicit trust review activated both project hooks
   afterward, confirmed by read-only native `hooks/list`; no bypass flag or manual
   trust-file write was used. Final actual trusted execution passed below. This
   preserves the genuine counterexample and bounds the claim to loaded hooks.
4. Matching a catalog suffix alone also admitted a host-authored symlink outside
   any Lisa package. The link became a Lisa regular copy and lost its custom
   command output. `verify-pre-symlink-correction-collision-results.json` records
   this actual failure. Positive source/package ownership replaced suffix-only
   admission. Final `verify-host-symlink-collision-results.json` preserves the
   symlink and actual custom output. Rules use the same positive source check.
   Package-name metadata is an ownership convention, not cryptographic registry
   provenance. Fixed within the measured host-preservation boundary.
5. The corrected package-source ownership branch failed in the actual compiled
   CLI with `fse.readJson is not a function`. Full apply exited 1 and logged
   rollback. `verify-package-readjson-failure.log` preserves the complete actual
   response. Unit execution did not reach that compiled Node module boundary.
   Native `readFile`, parsing JSON as unknown and positive name validation now
   replace it. Final real compiled full apply and package-removal replay passed;
   the worker also added a durable real child-Node RED/GREEN regression. Fixed.

Review also checked closure selection, dependencies-before-entrypoints ordering,
atomic regular-file replacement, manifest retention, tagged handler retirement,
current fallback generation, doctor handling, guidance and focused behavior
tests. Unknown host rules remain intact. Normal postinstall reconciliation from
#1632 is not widened; guards retain real enforcement implementations. No runtime
detection or assumed hot reload is used. Parent retained review remains required.

## Actual fresh native session

The verifier used the normal folder trust and `/hooks` review UI on the final
anonymous host, inspected both project commands and trusted each explicitly.
`verify-native-final-trust-ui.json` records the interaction. No bypass flags,
manual trust-file writes or guard binding edits occurred. The inherited machine
permission profile was unchanged; hook trust remained independently required.
Read-only native `hooks/list` reported both project hooks enabled and trusted,
with zero loading errors, in `verify-native-hooks-list.json`.

Actual invocation: `codex exec -C <anonymous-host> --ephemeral --json` with the
bounded verification prompt. CLI 0.160.0 created fresh session
`01a104d8-705b-7d03-9715-20a0cdf97428`, exit 0. The host hook recorded four actual
runtime envelopes carrying that ID: `pwd`, the prohibited request, `apply_patch`
and `cat native-probe.txt`. The fallback refused
`git commit --no-verify --dry-run` before execution; there is therefore no
completed command item for that request. Actual runtime stderr attributes the
refusal to host `scripts/lisa-hooks/block-no-verify.sh`. Actual `apply_patch`
created `native-probe.txt`; actual shell read returned `fresh-native-session`.
This establishes fresh loaded fallback enforcement and host-hook preservation,
independently of direct payloads.

Complete proof: `verify-native.jsonl`, `verify-native-stderr.txt`,
`verify-native-host-hook.jsonl`, `verify-native-results.json` and
`verify-native-hooks-list.json`. Transcript SHA-256:
`746dd2fac84c78dda204bdccfa62948688792cf57bffefeac525684fdeca2011`.
Runtime reported local version 4.68.0 as STALE against installed 4.68.1; local
installer and copied guard hashes identify the measured code. No toolchain
change hid that diagnostic. Unrelated Sentry/Atlassian MCP authentication
warnings are retained; required native shell/edit/hook access worked.

## Boundaries and remaining delivery

Direct command payloads prove shell/CLI behavior, not a real native session or
guard-session binding. Their actual missing-session warnings are retained.
The fresh-session claim is scoped to normally loaded and reviewed/trusted hooks.

Other harnesses were source-reviewed for equivalent destructive retirement paths
in the bounded explorer research. No equivalent path was found; this is not proof
of executing every other native runtime. Postinstall-only fix #1632 must retain
its existing reduced reconciliation boundary.

Only the anonymous macOS host and measured command set were executed. Other
catalog branches and hostile package-name spoofing were not tested. Machine
permission mode does not establish protected shipping authorization. Earlier
source runs and corrected fixture failures remain distinct from final proof.

The coordinator completed the local indexed checks on unchanged frozen source.
`coordinator-indexed-artifacts.txt` records all seven artifact checks passing
after stage-first regeneration left both derived artifacts unchanged.
`coordinator-indexed-anonymity.txt` records all 13 names-guard cases passing.
Current full lint and typecheck exited 0, as recorded in
`coordinator-ready-lint.txt` and `coordinator-ready-typecheck.txt`; existing lint
warnings and the measured typecheck quarantine are retained in those logs.
Worker final controls passed 59 unit cases, one integration case, three
postinstall cases and seven fallback/overlay cases, recorded in
`green-worker-final-gates.json`. These are coordinator/worker results read by the
verifier, separate from the independent boundary execution above. No checks or
builds were rerun for this report update. The earlier observed patch fingerprint
remains labeled earlier; the parent will provide the final code diff hash.

Parent retained security/quality review, shipping identity,
CI named-regression execution, release/package/runtime proof,
canonical evidence and usage, and terminal tracker readback remain outstanding.
No issue closure is authorized here. MLD candidates: `[]`.

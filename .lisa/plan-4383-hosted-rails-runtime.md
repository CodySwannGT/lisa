# #4383 — Explicit Rails/MySQL prerequisites for original updater hooks

Work-Item: CodySwannGT/lisa#4383

## Recorded delivery checkpoint — 2026-10-09

The runtime implementation and the review follow-ups are published in [PR #4389](https://github.com/CodySwannGT/lisa/pull/4389) at `8938d7f2fe79aea75849bc235feff0a10c9e268a`. That ordinary full push passed 27,420 unit tests and 3,352 integration tests with two existing skips per suite, unchanged coverage floors and the configured production audit. Both complete native TypeScript/CDK packaged adoption cases passed. The published follow-ups sanitize malformed scanner-report errors, require native hook scratch-root absence and recognize physical browser executable aliases. Separate local full-suite cleanup was not certified clean.

[Ubuntu runtime run 37862162073](https://github.com/CodySwannGT/lisa/actions/runs/37862162073) completed with failure on October 8 at 23:58 UTC. Its actual merge revision `55320f2228815f4b063910965072de6c6e7da53a` contains published head `8938d7f2fe79aea75849bc235feff0a10c9e268a` and main `0ff901294afde67c20b1db2ef1056add09209e1e`. All 17 recorded source hashes match that publication. Native tools, four database roles, original hooks and hosted owned cleanup passed. Both original browser commands exceeded the unchanged ten-second deadline without DOM output. Read-only process observations completed; they do not establish a root cause or sandbox acceptance. No merged or released acceptance is claimed. All earlier checkpoints below are historical.

## Post-failure diagnostic follow-up — 2026-10-09

The follow-up adds a bounded genuine ChromeDriver probe only after the original standalone browser request has failed. It uses a fresh owned profile, the original qualified tool paths and sandbox requirements, and the same ten-second outer deadline. Closed phase progress and error fingerprints may be published; raw responses remain private. Original primary failure, browser controls, sandbox flags and qualification predicates remain authoritative. Synthetic native HTTP unit controls verify transport, rejection and owned teardown only. They cannot establish genuine Chrome or Ubuntu success. Publication and native Ubuntu execution of this follow-up remain separate required steps.

The staged #4400 repair subsequently passed both complete native TypeScript/CDK packaged adoptions, with unchanged managed-byte snapshots and frozen installation, plus real CDK synthesis. The wider integration command reported 189 passing files, 3,363 passing tests and nine skips, alongside one history-evidence digest-second timeout under its original scaled bound. This is packaged-case success and a failed overall suite, not delivery acceptance. Its recorded scratch root was absent afterward; original process survivors prevent a clean local resource claim.

## Contract and scope

Implement the four acceptance scenarios in #4383. The optional committed
`npmUpdater.runtime` has exactly `profile`, `database`, `browser` and
`dockerFixtures`. The sole profile is `rails-mysql`. The database base is ASCII
`[a-z][a-z0-9_]{0,40}`. Both switches are booleans. No commands, paths, versions,
credentials or extra environment keys are accepted.

Derive exactly `<base>_test`, `<base>_queue_test`, `<base>_cache_test` and
`<base>_cable_test`. Bind the complete normalized profile to signed
`runtimeSha256`, including proposal identity, canonical current-HEAD validation
and historical cancellation. Absence preserves the old npm-only bytes and
requires no extra database/browser runtime.

Prepare a positively owned pinned MySQL service, genuine readiness, a local
least-privilege test user and all four roles using the original Rails
preparation command. Qualified tools and finite environment fields enter the
existing original manager and hook route. A workflow input is an affirmation,
not authority; committed original policy and signed subject must agree before
profile-specific side effects. Keep publisher/controller credentials outside
application children and preserve all original signatures, claims, holds,
provider reads, hooks, cancellation, sandbox, job/phase deadlines and cleanup
refusals.

## Ownership

Canonical workflow, hosted gate, closed runtime/profile helpers, exact
descriptor/proposal/current-HEAD/cancellation validators, required fixed helper
inventory, focused tests, documentation and officially generated artifacts.
The existing `validatePolicy`, `NAME` and `VERSION` exports retain their public
contract; policy extraction exists only to respect the existing module ceiling.
No generic installer or arbitrary setup framework is introduced. Other worktree
source, index and generated files are not modified.

The existing CredentialVerifier teammate owns only the new fixed
`npm-update-rails-mysql.mjs`, its resource/storage/daemon companions, its focused
tests and generic native runtime fixture in this worktree. The lead implementer
retains policy/signature contracts, auth/scope/tools/workflow, documentation,
integration and later official graph generation. The MySQL interface is
`openRailsMysqlRuntime({ cwd, root, deadline, profile, docker }, env)`, returning
finite `env`, `prepareSchemas()`, `close()` and a bounded ownership receipt.
Profile authority is authenticated before runtime allocation. Preparation uses
the original frozen Ruby installation and literal Rails database preparation.
The four schema names, original absolute phase budget, exact image/tool/resource
identities and positive cleanup remain mandatory. The teammate must establish
reaching RED and submit the precise owned Linux command/scope before allocation;
no previous allocation is resumed and no native hosted proof is inferred.

The qualified daemon must actually report Linux and retain its observed Engine
ID; its architecture is separate from the fixed service's `linux/amd64` image
identity. Local Docker Desktop uses an ARM64 daemon and executes that genuine
AMD64 container under emulation. Such a run cannot establish a native AMD64 host
or Ubuntu Actions acceptance. Production `assertHostedGate` still requires the
actual controller process to be Linux x64. No process or provider identity is
substituted to make the local fixture pass that hosted boundary.

## Native RED and limitations

A fresh owned Linux AMD64 fixture ran genuine Ruby 3.4.11, Bundler 2.4.10,
Rails 8.1.4, mysql2 0.5.7 and Lefthook 2.1.16. Frozen Bundler installed 68 gems.
An ordinary native Git push executed its original Lefthook pre-push and
`RAILS_ENV=test bundle exec rails db:prepare`, which exited nonzero with an
actual MySQL connection refusal at the absent local service. The diagnostic
driver completed successfully because it observed the expected hook RED; the
hook itself failed. Exact owned container ID and name were positively absent
after cleanup, and all 23 foreign container identities were preserved.

This is local Docker Desktop Linux AMD64 emulation with a genuine Debian Ruby
image, not Ubuntu Actions, full controller execution, signatures issued by a
live provider or final Bot/protected-check acceptance. No runtime GREEN is yet
claimed. The vendor image cache remains intentionally retained.

## TDD checkpoints

- Original closed-profile wrapper: 26 controls, 5 failures and 21 passes. Valid
  runtime opt-in was rejected and missing signed runtime binding was accepted.
- Minimum closed-profile/proposal implementation: all 26 controls passed.
- Original native Git descriptor/cancellation wrapper: 7 controls, 5 failures
  and 2 passes. The constructor omitted the new digest, the current-HEAD
  verifier accepted omission and cancellation rejected the valid extension.
- Subsequent signature/compatibility run: runtime, descriptor and optional-Bun
  suites passed. The complete contract suite additionally reported the expected
  three stale authenticated-graph obligations; graph regeneration has not yet
  been performed and this run is not reported as wholly passing.
- The canonical verifier's original deterministic-key and recovery-key
  reconstruction omitted the optional original Bun digest introduced by #4376.
  The runtime digest must use the same closed optional projection. Corrected
  npm-primary fixtures reach both real canonical hook paths with synthetic
  provider replies. A controlled replay of the published key calculation failed
  all 12 controls: six valid optional origin/recovery subjects were refused and
  six signed keys omitting optional authority were accepted. This replay is
  distinct from earlier Bun fixture failures that stopped at package-manager
  detection before canonical validation. Restoring the intended shared key
  projection passed the whole original provenance suite, 65 controls with no
  skips, at unchanged native wrapper bounds. It is not live provider proof.

Native runtime GREEN, qualified Ubuntu prerequisites, owned service cleanup,
final current-byte focused checks, official stage-first artifact generation,
independent source review and ordinary delivery remain required. Synthetic
protocol controls cannot supply hosted runtime acceptance.

## Authenticated preparation integration checkpoint

The optional gate opens the original read-only scope and requires native zero
from the canonical verifier before fixed tools, frozen dependencies or database
allocation. Frozen installation precedes service allocation. Only the fixed
Rails command environment enters schema preparation; exactly ten local database
fields merge back into the retained qualified hook environment. Runtime and
broker cleanup both remain attempted on original-hook setup failure, preserving
the original exception and any cleanup error. The default route retains its
original installation, manager and scope ordering.

The focused canonical wrapper's orchestration feature-absence RED reported
three missing-function failures. The subsequent four affected suites passed
22 controls with no skips. The lifecycle collaborators are explicitly synthetic;
the separate scope tests use real owned Unix listeners and native subprocesses.
These observations establish ordering/environment/error contracts, not Ubuntu
or provider authority. Fixed browser-library versions were read from genuine
Ubuntu archive metadata; their installation and the vendor browser/SUID helper
still require actual platform qualification.

The teammate's adapted native Ruby hook fixture reached real MySQL refusal and
positively removed its own container and synthetic storage, but its historical
foreign-resource census was false. That diagnostic run is not represented as
clean. Fourteen focused runtime controls passed after decomposition into the
four bounded runtime leaves. No native service GREEN is claimed here.

## Separate Ubuntu component qualification preparation

The project-owned qualification workflow and five fixed fixture files are an
explicit low-level test route. They require actual non-root Ubuntu 24.04 AMD64,
Node 22.23.3, the supported Ruby/Bundler and byte-qualified vendor tools. A fresh
generic application creates its own initial lock, then retains it through frozen
installation. Its genuine installed Lefthook commit and pre-push commands reach
the four physical Rails schemas; the browser probe requires Chrome's actual
adequate-sandbox page and active SUID status. The uploaded summary contains only
bounded closed metadata. All private native captures stay on the ephemeral
runner. This route never constructs provider authority or claims production
hosted-gate verification, and it does not establish a ChromeDriver session.

Seven native diagnostics controls passed, including real exit 17, exclusive
capture collision preserving the original error, private result/symlink/parent
replacement refusal, bounded class/message hashes and exact four-role witness
validation. The initial capture collision genuinely failed before the bounded
error-preservation correction. A separate real Node consumer reproduced missing
`CHROME_BIN` with native exit 17 from the original three-key browser environment.
The finite compatibility return now adds that alias equal to `CHROME_BINARY`,
after unchanged vendor/version/SUID qualification. Four affected suites passed
23 controls with no skips. These file/process/environment observations are not
Ubuntu, vendor-browser, provider or Bot acceptance. Actual platform execution
requires distinct reviewed-source admission.

The final-byte two-suite run passed eight controls with no skips; scoped native
lint and formatting checks also passed. The runtime teammate additionally owns
the generic fixture-only `npm-update-rails-mysql-observation.mjs` reporter for
closed failure classification. Actual Ubuntu component qualification and later
genuine Bot/protected-check acceptance remain required. Local AMD64 container
emulation is supplementary and does not become a separate release prerequisite.

The runtime teammate's first service attempt failed its actual Rails preparation
and retained the original failure. Fresh readback proved both owned containers
absent and the same 24 foreign containers preserved; its stale private namespace
and credentials remained deliberately retained for diagnosis. It is not service
GREEN. The owned runtime team is separately correcting observed native cause
transport and exact Docker absence parsing before any newly reviewed attempt.

## Current authored quality qualification

The original ten affected suites passed 146 controls. The separate runtime
owner's final typed diagnostic suite passed 27 controls with scoped lint clean.
The genuine whole typecheck initially refused 22 diagnostics in six new test
files. Accurate optional-field handling, concrete reporter return types and
typed fixture contracts corrected those errors without casts, suppression or
quarantine additions. The current original gate passes source compilation,
exactly 362 historical quarantined test files with 1540 diagnostics and no new
or stale entry, and the declared Node 22 engine floor. Scoped canonical consumer
lint passes seven authored runtime/auth/tool modules. Five affected suites
passed 29 controls after their type corrections. Historical failed native and
quality receipts remain retained; these controls do not establish Ubuntu or
authenticated production-gate acceptance.

The runtime diagnostics now preserve the actual native failure as the cause,
retain private bounded captures and expose only closed fingerprints and fixed
failure indicators. Two reaching controls failed before correction: Docker's
observed single-LF absence response and a real Node child exiting seven without
preserved cause identity. All 27 final runtime controls pass, including arbitrary
output refusals. This does not recover the discarded historical Rails failure
cause or establish a successful native service run. The final seven descriptor
controls also pass after explicit fixture-digest narrowing; original budgets and
all refusal assertions remain intact.

## Generated inventory and materialization qualification

The canonical graph first refused the ten unregistered authored dependencies.
Adding exactly those fixed producer names preserves all 98 prior graph members;
the generated graph now contains 108 members. The original total-inventory
assertion failed with 108 against 98, and the actual common-only apply assertion
failed with 106 managed members against 96. Only those two complete-count
literals changed. Both whole affected files then passed 109 controls through the
original owned test supervisor. The apply fixture uses local synthetic source
authority and establishes materialization, rather than hosted provider proof.

Official graph, export surface, append-only owned-hash ledger, coupling roster
and upstream manifest generation completed. All seven original artifact checks
and the canonical graph freshness check pass. The ledger retains its historical
digests. These checks do not establish Ubuntu runtime or Bot acceptance; actual
main ancestry integration will require fresh generated-artifact readback.

## Original full-push scanner refusal

The first original integrated push stopped with 26,878 unit controls passing,
one failure and two existing skips; coverage and integration were not proved.
The supervision scanner called TypeScript's identifier predicate on an unnamed
parameter from valid JSDoc function-type syntax in the new generic fixture.
A focused control reproduced the same exception while requiring detection of
a real unsupervised Vitest child in that source. The minimal missing-name guard
retains every existing runtime binding and bypass assertion. Three whole wiring,
analyzer and invocation suites then passed all 14 controls. Scoped lint and the
whole typecheck pass with the unchanged historical quarantine. The original
failed push remains retained; this focused correction is not aggregate success.

## Original hook scratch pathname composition

Source tracing found that the original candidate's private `HOME/tmp` becomes
the Rails scratch supervisor's base unless an explicit base is supplied. The
supervisor then appends its namespace, 24-hex locator and private payload `tmp`.
Adding an eight-character fixture directory and Chrome's socket suffix can
exceed the Linux pathname limit even though each independent component is short.
Only the returned original-hook environment for a successfully authenticated,
prepared browser-selected Rails profile now receives fixed `LISA_SCRATCH_BASE=/tmp`.
Setup, frozen installation, schema preparation, private HOME and candidate TMPDIR
retain their original paths. None and nonbrowser profiles return the original
environment unchanged. The original supervisor still exclusively creates and
validates its full 256-bit token, root device/inode, process identities and
bounded cleanup; no inherited arbitrary base or new timeout is accepted.

The normal exact-file native regression first observed a real Node listener's
requested overlong pathname missing after bind (`ENOENT`). The corrected fixture
awaited its real listener close, removed only its exclusively created empty
directory and retained child exit1. Owned supervisor root absence, namespace
absence, private HOME/full token and foreign sentinel preservation were proved
before the expected success assertion failed. This is macOS native pathname
evidence, not Chrome vendor or Linux acceptance. Subsequent negative controls
refuse an overbudget pathname before bind to prevent libuv from truncating it
into a guessed sibling; the original kernel observation remains retained. No
guessed or truncated address is unlinked. The new shared fixture lives in the
existing fixture `support` lint profile, without changing configuration or rules.

The positive control executes the actual hook environment projection and original
supervisor, then genuinely binds the exact socket pathname and closes/removes it.
Darwin uses its canonical `/private/tmp` prerequisite and verifies 62-byte
payload TMPDIR and 103-byte socket pathname. Linux selects the production `/tmp`
base; its corresponding controlled socket pathname is 95 bytes, while the
eight-character directory plus Chrome suffix is 104 bytes within its 107-byte
pathname budget. These arithmetic assertions do not establish a Linux kernel
run. The Ubuntu component fixture now additionally executes the real original
supervisor and socket witness, requires full-token and positive owned-root/socket
absence, and exports only closed booleans and byte count. Actual Ubuntu job
success and later canonical Bot acceptance remain mandatory and unproved.

An initial integration script invocation appended an exact filename to a script
that already selected the whole integration directory. This unintended OR-filter
run was stopped through TERM to its positively identified original supervisor;
the launcher, reaper, bootstrap, payload groups and original scratch were freshly
absent. Its interrupted status (143) and unrelated partial failures are retained, with no
RED or acceptance credit. All later controls use the declared `lisa-test-run`
entry with only the exact affected file arguments. An initial Linux arithmetic
fixture included an extra two-character prefix and failed (106 vs. 104); correcting
that fixture retained the genuine production pathname contract and original
deadlines, assertions and floors.

The final four whole affected files passed all 19 controls at their final bytes,
including the exact native lengths and positive private HOME absence. No original
authority, sandbox, signal, cleanup, hook, coverage or timing requirement is waived.

### Original push: shipped fixer and declared Ruby prerequisite

The second original full push at the committed scratch-path correction passed
all 1,417 unit files (26,882 tests, two existing skips) and its unchanged coverage
gate, then failed integration: 180 files passed and two failed, with 3,247 tests
passing and 43 failing. Six stack controls identified the same emitted Ruby
prefix regex being rewritten by Lisa's shipped fixer. The minimal correction
uses the equivalent literal `startsWith` expression; supported version, identity
and refusal requirements stay unchanged. The original byte-drift assertions are
retained as the reaching RED.

The other 37 failures reached `require 'active_record'` before their intended
Rails isolation boundary. The selected Ruby 3.4.11 had no installed ActiveRecord;
the existing quality workflow already declares ActiveRecord 8.1.4. Its genuine
installer was executed for that selected Ruby, retaining the actual install and
loaded-version readback. No fixture, dependency declaration, original hook,
assertion or deadline was altered to substitute for the missing prerequisite.
Both original push supervisor roots, retained process identities and groups were
freshly absent after the failed run. The failed aggregate receipt remains a
failure; a focused correction cannot establish a new full-push result or actual
Ubuntu component acceptance.

The corrected original exact-file wrapper passed all 70 controls across the
three complete affected files: six shipped-fixer stack cases, 54 emitted Rails
isolation cases and ten fixed-tool qualification controls. Actual loaded versions
were Ruby 3.4.11 and ActiveRecord 8.1.4. This is focused native GREEN, including the
previously failing boundaries, without claiming another aggregate push or hosted
runtime result.

### PR review: final-server readiness and stable Ubuntu pins

The corrected original full push passed 26,882 unit tests and 3,290 integration
tests, the original coverage gate, and positive owned supervisor/root cleanup.
PR #4389 was published at the reviewed head. The initial hosted traceability
failure preceded its canonical managed backlink; the exact failed job was
rerun after that backlink was verified. The review-evidence settle timeout and
all original failures remain retained; CodeRabbit subsequently completed a
substantive review with two concrete findings.

The administrator defaults lacked a TCP selector and could query the official
image's temporary `--skip-networking` initialization server through its Unix
socket. A real private-file control reached the missing host/protocol/public-key
fields without printing credentials. The minimal defaults correction selects
TCP `127.0.0.1`, matching the existing least-privilege application's transport.
This control uses synthetic Docker replies and is not a native MySQL-server
proof or an attribution of any previous failed runtime.

Moving Ubuntu mirrors can retire exact package versions. The selected fixed
snapshot `20261008T000000Z` was read through the official HTTPS service: all six
AMD64 main/universe indexes match their InRelease SHA-256 entries and contain
all 21 unchanged pinned package/version pairs. Native apt signature and install
qualification remains pending. Extracting the existing two bounded apt calls
unchanged enabled a reaching native command-transport RED: two synthetic
retired-mirror controls failed with actual child exit 17. Both fixed update and
install now select that same snapshot; the exact roster, signed profile,
authentication ordering and original deadlines remain unchanged. Actual
Ubuntu component success and composed canonical Bot acceptance remain separate
mandatory evidence; no local command fixture supplies either claim.

Final affected native controls passed 40 cases across the two complete unit
files, and the exact-file original supervisor passed all six emitted-script
stack cases. The first integration package-script invocation mistakenly selected
the whole integration directory; only its freshly identified original supervisor
received TERM. That run remains interrupted (143), with its retained process
identities/groups and scratch-prefix inventories positively absent before the
exact-file rerun. It supplies no aggregate acceptance. Scoped ESLint passed the
two tests but ignored both managed source files under the existing configuration;
no managed-source ESLint pass is claimed. The genuine whole typecheck passed
with the existing 362-file quarantine, zero new/stale entries, and zero engine
floor violations; the existing historical diagnostic backlog is unchanged.

### Actual Ubuntu component failure and bounded internal-page probe

The initial Ubuntu component run 37752346885 at PR head b50db90 failed. Its
actual checkout was the Actions merge head 29baaea; retained executed source
pins identify the reviewed source. The metadata confirms actual Ubuntu AMD64,
qualified native tools, four prepared database roles and both original hook
statuses zero. The browser stage then consumed 1,699,418 milliseconds until
the original phase deadline. Its stderr was retained only as a size and digest
in the uploaded summary, so the historical launch warning is unavailable.
Runtime closing and the final foreign census refused after deadline expiry;
owned-root absence and foreign-resource preservation are not established.
This run remains a failure and does not supply runtime acceptance.

The component command requested `chrome://sandbox` without the documented
`--allow-chrome-scheme-url` prerequisite, required since Chrome 123. Adding that
fixed flag preserves every sandbox setting and the actual SUID status assertion.
This is source-backed repair of a missing prerequisite, not attribution of the
unavailable historical stderr. The fixture recorder now bounds only its browser
operation to the existing 10-second runtime-operation budget, still capped by
the unchanged absolute 30-minute phase. Other stage bounds remain unchanged.
Timeout retains actual native failure and private captures instead of exhausting
the entire phase before owned cleanup can be attempted.

Two reaching controls initially failed: a real owned synthetic command consumer
exited 17 without the flag, and a real 12-second child completed under the former
browser bound. These controls qualify command transport and supervision, not
Chrome, Ubuntu, provider authority or canonical Bot acceptance. An intermediate
corrected run exposed the fixture's nonexistent macOS `/bin/true` probe; its
failure is retained and the harmless follow-up uses the same selected Node
executable. Actual Ubuntu component success with positive cleanup remains
mandatory on the revised published head before merge or release.

Primary prerequisite reference:
https://developer.chrome.com/docs/automation-and-testing/headless-cli

The final formatted component unit file passed all nine controls, including
positive ESRCH absence of its recorded owned child after the native timeout and
a successful subsequent selected Node command within the same original phase.
The first scoped ESLint invocation overlapped the wrapper's dist regeneration
and failed to resolve the configured generated ESLint entry; that failure is
retained and a sequential final check is required. It is not treated as a
source lint pass or an unavailable external dependency.

The sequential component lint then caught two definition-order findings in the
small probe refactor. Keeping the original predeclared observation state closes
both findings without changing probe behavior; all three component/test paths
pass the actual scoped ESLint check. The final source remains within the original
300-line ceiling without introducing another runtime helper or changing the
authenticated controller inventory.

## Native marker-read disappearance during original qualification

The original full push of `42332ec6` ended with exit 1 and did not publish.
Its whole unit gate passed 1,417 files and 26,887 tests with two existing skips;
the original coverage and correctness gates passed. Integration passed 181
files and 3,289 tests with two existing skips, but the nested-path refusal
control failed its unchanged empty-stderr assertion. The native shell reported
that its arming marker disappeared before the second count read, followed by
an empty integer comparison. Both original supervisor roots, all 38 recorded
original process births and all seven captured groups were independently
absent after the failed command. These observations cover the captured subset,
not every process ever spawned. The failure and cleanup receipts are retained.

The existing marker reader opens the same pathname separately for byte and
line counts while this invocation's two cleanup participants may remove it.
A deterministic native control removes only its synthetic marker after the
real byte-count command completes. Before correction, that control reproduces
the exact shell pathname and integer diagnostics, while the canonical authority
still refuses with exit 78. The root inode and foreign sentinel remain intact,
and no acknowledgement is published.

Redirecting stderr before each count's input open and requiring numeric count
output preserves unreadable-marker refusal without incidental shell diagnostics.
The final marker extraction also retains its nonzero failed-read status while
suppressing incidental pathname output. Token, inode, UID, process, count limits
and all cleanup deadlines are unchanged. The original exact two-file supervisor
route passes 19 controls, including the unchanged nested refusal and positive
native socket case. This is native shell protocol qualification, not Ubuntu,
Chrome, provider or canonical Bot acceptance. The official build regenerates
only the authenticated runner digest in the guard source and its shipped copies;
the cleanup-operation count and guard policy are unchanged.

The seven affected authority, lifecycle, ownership, nested-path, guard-profile,
execution-following and route files pass all 157 controls. Strict test lint
caught two literals crossing its duplication limit; fixed constants retain
their exact existing values and assertions. The resulting authority file
passes all 17 controls and scoped ESLint. Final whole type checking retains
the original 362 quarantined files, with no new or stale diagnostics and no
engine-floor violations. Shell syntax and formatting pass. Official artifact
checks, distinct source review and ordinary commit hooks subsequently passed.
The original full push at `d49a295ace5f439efe01edc83e1cc29ce67f3a4d`
passed 1,418 unit files and 26,909 tests plus 182 integration files and 3,291 tests,
with two existing skips in each gate. The later original full push at
`a53cb633bd959fc930c23d05cc8008b70ade052b` passed 1,420 unit files and
26,946 tests plus 182 integration files and 3,291 tests, again with two existing
skips in each gate. All original push gates passed on both heads. Independent
cleanup for the later push verified 84 recorded process identities, 17 groups
and both scratch roots absent. The normal main 4.72.1 integration committed as
`27b96cbc75cad601f0b63806b44fad972c9d0914` passed distinct source review,
all seven artifact checks and ordinary commit hooks. Its original full push
and exact-head Ubuntu qualification remain pending; actual Ubuntu qualification
is mandatory before merge or release.

The original full push at `73fe96184e2dbf4ec548bae6fc65dc2e85fda297` subsequently passed all 14 gates and published that head: 1,428 unit files/27150 tests and 183 integration files/3324 tests, with two existing skips per test gate. Independent readback verified 66 recorded original process identities, 16 groups and both original supervisor scratch roots absent. The native Ubuntu component run 37797449880 checked out merge 5f0c13ff, which contains 73fe9618; all 15 qualification source hashes match the published revision. Native tools, database-role preparation and original hooks passed, but browser stdout remained empty and its original ten-second deadline expired after 10066 ms. The owned runtime closed and its private root was removed, with foreign resources preserved. Browser and later nested-scratch acceptance remain unproven.

The browser capture correction adds Chrome's documented `--timeout=5000` alongside `--dump-dom`: [official command-line reference](https://developer.chrome.com/docs/automation-and-testing/headless-cli). That timer bounds page loading after target creation and attachment; it does not guarantee the complete browser process returns within the original ten-second deadline. Both adequate-sandbox text and an active SUID-sandbox row remain mandatory. The real harmless command-consumer control failed with exit19 before the flag and passed after it; all nine original runtime qualification unit controls passed afterward. Those synthetic controls establish command construction and refusal behavior, not genuine Chrome or Ubuntu acceptance. Native Ubuntu qualification remains mandatory before merge/release.


The published revision also failed one integration control: the malformed-report
witness expected native exit 42 but received 0. Its historical synthetic nonce
was not retained, so the cause of that individual failure is unknown. Separate
controls reproduce an actual default-vendor behavior: a balanced hexadecimal
nonce containing `dead` or `feed` is ignored despite its four-bit entropy. Two
deterministic nonce controls failed before the correction, and a native pinned
vendor control returned 0 with no findings for the controlled stopword value.
At that earlier revision, the fixture made at most sixteen balanced draws and refused if none avoided
those default stopwords. Scanner configuration, production detection, entropy
requirements and process deadlines are unchanged.

At that earlier revision, the three affected full test files passed all 35 controls, including both browser
sandbox refusal controls and the native vendor stopword witness. Scoped ESLint
passes after moving the balanced shuffle into a local helper in the same existing
fixture module. One intervening run was refused before collection in the default
macOS scratch namespace because of uncertain residue; it ran no tests, and that
residue was preserved. The successful final run uses the original qualification
namespace `/private/tmp`. These local controls do not establish native Ubuntu
browser acceptance or the historical cause of the published CI failure.

## Historical published failure and main integration

The original full push published `a29140489d3d2139f48455eb8aa3f5062c73b7dd`
after all fourteen gates passed, including 27,154 unit and 3,325 integration
tests with two existing skips per test gate. Independent readback verified
191 recorded process identities, 29 groups and two scratch roots absent.
The full hosted quality workflow 37807806187 subsequently passed.

Native Ubuntu run 37807803254 still failed its browser deadline after 10,091ms
with zero stdout bytes. Its merge checkout contained the published revision,
and all fifteen qualification source hashes matched. The native tools, four
database roles and original hooks passed. The owned runtime closed, its private
root was absent and foreign resources were preserved. Browser and subsequent
nested-scratch acceptance remain unproven.

The normal diagnostic commit `e534d611e7d3619e08c0eb7454b43017fbe4d5b5`
retains trusted native failure categories and at most sixteen fixed vendor
source/severity/line records with message fingerprints. It publishes no original
stderr text, paths, arguments or credentials. Its genuine timeout control first
failed without those observations, then all twelve qualification unit controls
passed. Scoped lint and the full original typecheck passed without changing the
362-file historical quarantine. Browser arguments, sandbox checks and deadlines
are unchanged. This commit is local until the next normal push succeeds.

The current main integration selects the genuine 4.72.4 revision
`5ba6829f393917b85a78cd5c4ae95f052aadd0fc`. Its complete three-file scanner
fixture correction supersedes the retry sampler: separate balanced digit and
letter permutations place a digit between every letter, structurally preventing
vendor hexadecimal stopwords while retaining four copies of each symbol. The
incoming unit and native integration controls cover this algorithm and both
actual `dead` and `feed` vendor refusals. These exact incoming bytes have distinct
source review; current merged-head tests, normal commit/push and native Ubuntu
qualification remain required before merge or release.

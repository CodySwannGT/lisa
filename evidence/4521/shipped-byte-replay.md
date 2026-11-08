# CodySwannGT/lisa#4521 — shipped-byte replay of @codyswann/lisa@4.96.3 (cli-output: audit-shipped-byte-replay)

An agent that did not implement this change downloaded the exact released
package, confirmed its published identity, and replayed the preserved inputs
against the shipped bytes in an isolated consumer project. Captured 2026-11-08
(UTC). Toolchain: Node 24.21.0, Bun 1.4.4.

Placeholders: `<shipped>` is the verifier's isolated scratch directory,
`<package>` is the installed `node_modules/@codyswann/lisa` inside the
consumer project, and `<tmpdir>` is the OS temp directory.

What shipped, and how it was read:

| Fact | Value | Source |
| --- | --- | --- |
| PR | #4693, merged as `3d45307ef4e4bf8e115901c5e388aef14c570bc8` | `gh pr view` |
| Merge parents | `f83b8005e6` (main), `1e3ade87145409b49ba5d483823c4eed9cf82aa7` (reviewed PR head) | `git log -1 --format=%P` |
| Release and Deploy | run 42490840830, attempt 1, event `push`, head `3d45307ef4…`, conclusion **success** (14:39–14:50Z) | `gh run view` |
| Published version | 4.96.3, tag `v4.96.3`, release commit `4c5547de18a6a3332ea9116d85cd67a12f823430` | publish job log, `npm view` |
| Merge → release commit | the merge is an ancestor of `4c5547de18`. The one commit between them is `chore(release): 4.96.3`, which changes the version and plugin manifest numbers, `CHANGELOG.md`, and one unrelated source file (`src/core/nightly-e2e-guard-behavior-certificate.ts`). No audit source changes. | `git merge-base --is-ancestor`, `git diff --stat` |

## 1. Package identity

```text
$ npm view @codyswann/lisa@4.96.3 version gitHead dist.shasum dist.integrity --json
{
  "version": "4.96.3",
  "gitHead": "4c5547de18a6a3332ea9116d85cd67a12f823430",
  "dist.shasum": "526203df9b1b2e8c75f06301ba953b0ed4cd1ba7",
  "dist.integrity": "sha512-rxoS4I5Cin4b2AlrlZN+khckNArla58E0+yPcHZon+hZhtQdPNN+haEFsAGOge+aVGHG5i/IacxIsbC7mVqDOA=="
}
$ npm pack @codyswann/lisa@4.96.3
codyswann-lisa-4.96.3.tgz
exit=0
sha1:   526203df9b1b2e8c75f06301ba953b0ed4cd1ba7                       (== dist.shasum)
sha256: 25a6620e18bb60b9cf583835c023d07554a14fdba9418819653dd486aa54e515
sha512 integrity: sha512-rxoS4I5Cin4b2AlrlZN+khckNArla58E0+yPcHZon+hZhtQdPNN+haEFsAGOge+aVGHG5i/IacxIsbC7mVqDOA==   (== dist.integrity)
$ jq '{name,version,gitHead,audit:.exports["./audit"]}' package/package.json
{ "name": "@codyswann/lisa", "version": "4.96.3", "gitHead": "4c5547de18a6a3332ea9116d85cd67a12f823430", "audit": "./dist/core/audit.js" }
```

The publish job (job 128763399835 in run 42490840830; downloaded log sha256
`152bb36ba5984d2fcc13ccf433686fe0e24b2d903b4afb6464a947396d55a73b`) printed:

```text
✅ Inputs validated: tag=v4.96.3, version=4.96.3, release_commit=4c5547de18a6a3332ea9116d85cd67a12f823430
npm notice version: 4.96.3
npm notice shasum: 526203df9b1b2e8c75f06301ba953b0ed4cd1ba7
npm notice Publishing to https://registry.npmjs.org with tag latest and public access
+ @codyswann/lisa@4.96.3
```

### Isolated consumer project

The consumer is a new directory containing only
`{"name":"shipped-consumer","private":true,"type":"module"}`.

```text
$ npm install --ignore-scripts --no-audit --no-fund ../pkg/codyswann-lisa-4.96.3.tgz
exit=0
installed version=4.96.3 integrity=sha512-rxoS4I5Cin4b2AlrlZN+khckNArla58E0+yPcHZon+hZhtQdPNN+haEFsAGOge+aVGHG5i/IacxIsbC7mVqDOA==
installed audit.js sha256: 96b154d0c43475bdfb58b050f566dd0d45cc0eefbb369e8fec6e5c01fc56ffff   (== tarball)
installed adapter sha256:  8ca83977e7df232bf22912df6c6044c9162363a02ef77d5d518e03d73c280543   (== tarball)
installed dist == tarball dist (byte-identical, diff -r -q)
```

## 2. The issue's driver replayed against the shipped dist

The driver bytes are the preserved `reproduce-*.mjs.txt` files, and their
digests match `red-green.md`. Here `dist` links to `<package>/dist`.

```text
eaa4be56990997e8ae598ed1bbdb10271d98c95593911c3782230cb1c2107697  reproduce-empty-paths.mjs
d0afac3086aa4466a3bacface2bc779bd04ce40f7552944ce787c154b3b0165b  reproduce-legacy-controls.mjs
$ node reproduce-empty-paths.mjs   # runs 1-3
{"root":"<tmpdir>/lisa-4521-reproduction-QMf2O5","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-EHuAJI","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-rOw0OR","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
fixture sha256 (latest run): 887157b3acdc9d55c34a4a37e0e8f99fecc0231e44e2c0aac94c26a9efb39e13   (== red-green.md)
$ node reproduce-legacy-controls.mjs   # runs 1-3, identical
{"documented":[],"undocumented":["`audit.ignore.local.json` excludes advisory `GHSA-mrhx-c7xc-m3w5` from the dependency audit with no written decision (no reason/notes/justification field), so nobody can tell whether the exception is still true"]}
exit=0 (x3)
```

The shipped package rejects the empty `paths` entry in 3 of 3 runs. The
documented legacy entry is still accepted, and the undocumented one is still
reported. Released 4.90.0 (in `red-green.md`) returned `[]` and exit 1 on the
same bytes.

## 3. Thirteen Bun trees, then npm and Yarn trees, through the shipped consumers (controlled fixture data)

The trees were rebuilt with the committed generator `verify-make-trees.mjs.txt`
(sha256 `880c103a…be2a2`, unchanged), pointed at `<package>`. Each tree's
`node_modules/@codyswann/lisa` links to the installed shipped package, and its
`scripts/lisa-audit.mjs` is the shipped adapter
(`all/copy-overwrite/scripts/lisa-audit.mjs`, sha256 `8ca83977…0543`). The
regenerated report matches the committed
`verify-controlled-bun-audit-report.json.txt` byte for byte (sha256
`bf3822b6…a66a3`). Every lockfile and exclusion digest equals the one in
`consumer-parity-local.md`. A shim answers only `bun audit` (shim sha256
`43cc44cf…de9c9`), and every other `bun` call goes to the real Bun.

The five consumers:

| Consumer | What ran |
| --- | --- |
| pre-push | The shipped template `typescript/copy-contents/.husky/pre-push` (sha256 `ece830e7…46c9`). Its verbatim audit block (sha256 `93d82296…dadd687`, the same as the reviewed branch) plus `lisa_gate_covers`, run with `sh` and `PACKAGE_MANAGER=bun`. |
| registry | The shipped `all/copy-overwrite/scripts/lisa-run-gates.mjs --moment=push` (sha256 `8ee6487f…de41`). It resolves the gate to `required dependency-vulnerability → bun run security:audit`. |
| adapter | The shipped `node scripts/lisa-audit.mjs --manager bun`. |
| helper | `verify-helper-consumer.mjs.txt`, which resolves `@codyswann/lisa/audit` through the exports map to `<package>/dist/core/audit.js` and calls `runDependencyAudit`. |
| CI | The CI action's `run.mjs` and `src` taken from the **merge commit** (`git archive 3d45307ef4 src .github/actions/dependency-audit`; run.mjs sha256 `ece4475f…dcff`), after the action's own `npm ci --ignore-scripts`. The action is not part of the npm package. |

### Bun (13 cases × 5 consumers)

| Case | Expected | pre-push | registry | adapter | helper | CI | Earlier local table |
| --- | --- | --- | --- | --- | --- | --- | --- |
| control-no-exclusion | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| covered-only | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| uncovered-production | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| version-boundary-zod-4.5.0 | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| npm-alias | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| package-mismatch | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| empty-paths | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| missing-lockfile | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| garbage-lockfile | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| legacy-id-only | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| misspelled-path-key | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| harmless-url-key | PASS | PASS | PASS | PASS | PASS | PASS | PASS |
| managed-wide-plus-local-scoped | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

**All 65 shipped verdicts agree with each other and with the earlier local
table.** The decision lines are byte-identical across all five consumers in
12 of 13 cases:

```text
control-no-exclusion            | GHSA-mrhx-c7xc-m3w5: unresolved high/critical advisory for zod
covered-only                    | excluded GHSA-mrhx-c7xc-m3w5 for lint-plugin/zod (Verifier fixture: reviewed dev-only lint plugin copy)
uncovered-production            | GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
version-boundary-zod-4.5.0      | GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@4.5.0)
npm-alias                       | GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: schema-alias (zod@3.25.76)
package-mismatch                | GHSA-mrhx-c7xc-m3w5: package zod is outside exclusion package other-lib
empty-paths                     | refused: audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths
missing-lockfile                | refused: Cannot evaluate scoped audit exclusions from bun.lock: ENOENT: no such file or directory, open '<shipped>/trees/missing-lockfile/bun.lock'
garbage-lockfile                | refused: Cannot evaluate scoped audit exclusions from bun.lock: Cannot parse bun.lock packages map (expected text JSONC)
legacy-id-only                  | (none: advisory-wide meaning unchanged, silent pass)
misspelled-path-key             | refused: audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: unknown field "path" (did you mean "paths"?); a misspelled scope field would otherwise be ignored and excuse more copies than written, so the exclusion is rejected
harmless-url-key                | excluded GHSA-mrhx-c7xc-m3w5 for lint-plugin/zod (Verifier fixture: reviewed dev-only lint plugin copy)
managed-wide-plus-local-scoped  | GHSA-mrhx-c7xc-m3w5: advisory-wide exclusion was not applied because a narrower paths/versions exclusion exists for zod
                                | GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
```

`refused:` stands for the consumer's prefix. The shipped wording is
`❌ Security audit configuration invalid:`; the reviewed head printed
`❌ Security audit failed closed:` instead. The missing-lockfile case is the
same as before: the registry calls the adapter without `--manager`, so its line
reads `No supported audit lockfile found (bun.lock, package-lock.json or
yarn.lock)`. The verdict is the same.

**The registry's wording is fixed in the shipped package.** All 10 failing
cases now print `FAILED required dependency-vulnerability … the prover printed
a failure shape dependency-vulnerability declared, so it ran and found this
property wanting. That is a verdict about the code, not about the machine`.
On the reviewed head the same cases read UNPROVABLE (Observation B in
`consumer-parity-local.md`). The 3 passing cases print `PASSED`.

### npm and Yarn classic (4 cases × 2 managers × 5 consumers)

`shipped-make-trees-pm.mjs.txt` builds the trees. Each has a `package-lock.json`
v3 or a classic `yarn.lock`, plus a scoped entry keyed by that manager's own
path syntax. The npm report (`{auditReportVersion:2, vulnerabilities:{zod:{via:[…]}}}`,
sha256 `6c348039…5606b`) and the Yarn NDJSON report (`auditAdvisory` +
`auditSummary`, sha256 `9ab3c637…ac13`) carry the same live advisory fields.
Shims answer only `npm audit` and `yarn audit`. The helper is
`shipped-helper-pm.mjs.txt`. The registry uses `bun run` only to launch the
script; the adapter detects npm or Yarn from the lockfile.

| Case | Expected | pre-push | registry | adapter | helper | CI | Decision line (identical in all five) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| npm no exclusion | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `unresolved high/critical advisory for zod` |
| npm covered | PASS | PASS | PASS | PASS | PASS | PASS | `excluded … for node_modules/lint-plugin/node_modules/zod (…)` |
| npm uncovered | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `… outside exclusion: node_modules/app-dep/node_modules/zod (zod@3.25.76)` |
| npm alias | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `… outside exclusion: node_modules/schema-alias (zod@3.25.76)` |
| yarn no exclusion | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `unresolved high/critical advisory for zod` |
| yarn covered | PASS | PASS | PASS | PASS | PASS | PASS | `excluded … for zod@^3.22.4 (…)` |
| yarn uncovered | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `… outside exclusion: zod@3.25.76 (zod@3.25.76)` |
| yarn alias | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL | `… outside exclusion: schema-alias@npm:zod@3.25.76 (zod@3.25.76)` |

**All 40 agree**, and each consumer made one shim audit call per case. The
registry labels are `FAILED` for the 6 failing cases and `PASSED` for the 2
covered ones.

Input digests (sha256): npm locks: base `1affcc65…9b53`, uncovered
`cef51d6b…8c99`, alias `e3f21ae1…820c`. Yarn locks: base `9d987695…6327`,
uncovered `08caf48b…2772`, alias `77f6a25a…6e38`. Scoped local entries: npm
`52a6074f…0922`, Yarn `1633d059…cba7`. No-exclusion entry `0114d4d9…cadc`.
Generator `838b819d…b2b2`, helper `8b79954a…d7d3`.

### Proof the checks can fail, on the shipped bytes

In the **installed** copy of the shipped `dist/core/audit-matcher.js` (sha256
`9a6544e1…d579e`), the path clause was replaced with `(false)` (sha256 became
`08f7c9b6…933e1`). The 13-case Bun harness was then re-run:

- `uncovered-production`, `npm-alias` and `managed-wide-plus-local-scoped`
  flipped to PASS in pre-push, registry, adapter and helper.
- CI, built from the merge's `src`, stayed FAIL.
- Every other case was unchanged. `version-boundary-zod-4.5.0` stayed FAIL
  because the `versions` check still excludes it.

The installed file was then restored from the tarball and `cmp` confirmed the
bytes are identical. So the four package consumers really execute the shipped
`dist`, and the cases depend on the path check.

## 4. Live advisory access on the merged lockfile, evaluated by the shipped bytes

The inputs are `package.json`, `bun.lock`, `audit.ignore.local.json` and
`audit.ignore.config.json`, taken by `git archive` from merge `3d45307ef4`. No
shim was on `PATH`.

```text
2026-11-08T14:58:44Z
$ command -v bun   # the real binary, no shim
<mise>/installs/bun/1.4.4/bin/bun
1911b23a32829cdadc59d51227a94359aedcb72cc042cdc52fd2bc36aa5faba7  bun.lock
a1d5caeec7ad8e8cd6c030605a4c8ed6c640721423a1ff9f8230af288c6829e2  audit.ignore.local.json
44f4401b6b2328d0105f376846e5eb0e393c213b44798dc00f3d110e825245b3  audit.ignore.config.json
$ bun audit --production --json   (live)
exit=1 bytes=3965 sha256=7a890aa4ee0845ab00bb94769f93e0c61aa2161bdf64611bc0d5eb9832c61e0f
zod	high	https://github.com/advisories/GHSA-mrhx-c7xc-m3w5	<4.6.6
$ node helper-pm.mjs <live-merge> <package> bun   # shipped runDependencyAudit, live
[helper] resolved @codyswann/lisa/audit -> <package>/dist/core/audit.js
excluded GHSA-mrhx-c7xc-m3w5 for eslint-plugin-react-compiler/zod (Repository-specific exception for one copy: zod 3.25.76, …)
[helper] passed=true
exit=0
$ node scripts/lisa-audit.mjs --manager bun   # shipped adapter bytes (8ca83977…0543), live
excluded GHSA-mrhx-c7xc-m3w5 for eslint-plugin-react-compiler/zod (Repository-specific exception for one copy: zod 3.25.76, …)
✅ No high or critical vulnerabilities found in production dependencies (excluding documented exceptions)
exit=0
```

The live report's bytes match the previous day's capture (`7a890aa4…`). The
shipped code excludes the advisory only for the single reviewed
`eslint-plugin-react-compiler/zod` copy.

## 5. Hosted named-spec execution (test-run-log: audit-current-head-gates)

The run is 🔍 CI Quality Checks, run 42488822127, `pull_request`, head
`1e3ade87145409b49ba5d483823c4eed9cf82aa7` (the merge's second parent),
conclusion success. The job is `🔍 Quality Checks / 🧾 Named Regression Specs`
(job 128756523567, success). The step is **"Execute and name dependency-audit
scope regression specs"** (success). The job log was downloaded through the
API (sha256 `20de66c23e28d4d976de3d52611715310852ba45caff3b2b3f82844d79d4d985`),
and the step excerpt with ANSI codes stripped has sha256
`8d55ef7d4e5535612200bd3282549563bd64e2ac82e078df823c05d04445d212`.

```text
 Test Files  17 passed (17)
      Tests  381 passed | 2 skipped (383)
```

Passing tests per file:

| File | Passed |
| --- | ---: |
| tests/integration/audit-consumer-parity.test.ts | 26 |
| tests/integration/audit-registry-verdict.test.ts | 5 |
| tests/integration/audit-workflow-action.test.ts | 5 |
| tests/integration/quality-audit-fail-closed.test.ts | 16 |
| tests/unit/cli/doctor-audit-scope.test.ts | 10 |
| tests/unit/cli/doctor-readiness-supply-chain-exceptions.test.ts | 6 |
| tests/unit/config/audit-ignore-package-names.test.ts | 129 |
| tests/unit/config/zod-security-floor.test.ts | 9 |
| tests/unit/core/audit-lockfile-formats.test.ts | 8 |
| tests/unit/core/audit-lockfile-sources.test.ts | 17 |
| tests/unit/core/audit-report-completeness.test.ts | 6 |
| tests/unit/core/audit-review-4693.test.ts | 6 |
| tests/unit/core/audit-scope-hardening.test.ts | 25 |
| tests/unit/core/audit-scopes.test.ts | 34 |
| tests/unit/hooks/pre-push-audit-transport-parity.test.ts | 55 |
| tests/unit/strategies/package-lisa-audit-script-governance.test.ts | 4 |
| tests/unit/strategies/security-audit-handling-scope.test.ts | 20 |

Some of the named lines:

```text
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity on the identical tree > covered: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity on the identical tree > alias: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity on the identical tree > empty-paths: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity on the identical tree > malformed-lock: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity through the hook's npm branch > alias: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-consumer-parity.test.ts > audit-consumer parity through the hook's yarn branch > alias: hook, registry and CI agree and name the measured result
 ✓  lisa  tests/integration/audit-registry-verdict.test.ts > registry dependency-vulnerability verdicts > reports an uncovered vulnerable copy as FAILED and names it
 ✓  lisa  tests/integration/audit-registry-verdict.test.ts > registry dependency-vulnerability verdicts > keeps a capture that audited nothing (garbage) UNPROVABLE, not FAILED
 ✓  lisa  tests/integration/audit-workflow-action.test.ts > workflow-owned canonical audit on an older caller > fails and names an uncovered npm alias through the action's bundled matcher
 ✓  lisa  tests/unit/config/zod-security-floor.test.ts > zod security floor (GHSA-mrhx-c7xc-m3w5) > leaves only the accepted plugin copy inside the advisory's range
 ✓  lisa  tests/unit/config/zod-security-floor.test.ts > zod security floor (GHSA-mrhx-c7xc-m3w5) > keeps the exception out of the managed audit.ignore.config.json
 ↓  lisa  tests/integration/quality-audit-fail-closed.test.ts > the npm built-in audit fails closed > fails when bun prints a registry error body as JSON
 ↓  lisa  tests/integration/quality-audit-fail-closed.test.ts > the yarn built-in audit fails closed > fails when bun prints a registry error body as JSON
```

The 2 skips are both in `quality-audit-fail-closed.test.ts`. The step's own
skip guard exempts that one file, so they do not fail the step. No spec from
any of the other 16 files was skipped, and none failed.

This hosted evidence was captured on `1e3ade8714`, the merge's second parent,
not on the merge commit itself. Under the ancestry definition of "what
shipped", a parent's evidence transfers to the merge, and Release and Deploy
ran for the merge (section 1).

## 6. Shipped documentation and guidance

`docs/dependency-audit-exclusions.md` at merge `3d45307ef4` (sha256
`b2459cdd9850a73f2b6550af709cc82b2f24cf63f348a0152d5b7e500907bb65`):

```text
5:or a CI run. Prefer `paths` over an advisory-wide exception whenever the
28:report. `package`, `versions`, and `paths` are optional restrictions, and all
81:dev-only and reviewed, add its lockfile path to `paths`. Empty `paths`, invalid
88:A narrower entry always wins. When a `paths` or `versions` entry exists for an
```

The shipped rule `plugins/lisa/rules/eager/security-audit-handling.md` (in the
4.96.3 tarball) says: "dev-only copy: add `versions`, `paths`; see
https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md".

## 7. Follow-up on the shipped bytes: doctor's ID-only warning and two more broken lockfiles

Added 2026-11-08 after the conformance review. This uses the same isolated
4.96.3 consumer (`<package>` = installed `@codyswann/lisa`, byte-identical to
the tarball). The trees are **controlled fixture data**, built by
`shipped-extra-trees.mjs.txt` (sha256
`875c01fb5f7f80fc769526c0906bbeb636a245edf5e1451b4fcfce5d0851bf48`). Each is a
copy of the committed generator's `covered-only` tree, with only
`audit.ignore.local.json` or `bun.lock` replaced.

### 7a. Doctor: `auditExceptionObservations` and `auditExceptionViolations`

Module: `<package>/dist/cli/doctor-readiness-audit-allowlist.js` (sha256
`2ca4b087a429213881a12b425443a950de2194e33f7cc22e09abe500e41dcadc`). Driver:
`shipped-doctor-obs.mjs.txt` (sha256
`cb47ce3d884e4f7dd44104c4b88b0dc0ce5ce874823b815440f35b8bf518d12c`). Every
tree uses the base `bun.lock`, `f1a07722…`.

```text
--- doctor-a-id-only        local=cb7cb8b1fd595f63   {id, reason}
{
 "case": "doctor-a-id-only",
 "observations": [
  "`audit.ignore.local.json` hides this advisory for every copy of the affected package: the entry for `GHSA-mrhx-c7xc-m3w5` names no package, version range or lockfile path, so a later copy used in production would also be hidden. If the risky copy is only used by development tools, add `versions` and `paths` so only that copy is excused."
 ],
 "violations": []
}
exit=0
--- doctor-b-scoped         local=94588d5cc332134b   {id, package, versions, paths, reason}
{ "case": "doctor-b-scoped", "observations": [], "violations": [] }
exit=0
--- doctor-c-package-only   local=60f510f1f6c5518f   {id, package, reason}
{
 "case": "doctor-c-package-only",
 "observations": [
  "`audit.ignore.local.json` hides this advisory for every copy of `zod`: the entry for `GHSA-mrhx-c7xc-m3w5` names no version range or lockfile path, so a later copy used in production would also be hidden. If the risky copy is only used by development tools, add `versions` and `paths` so only that copy is excused."
 ],
 "violations": []
}
exit=0
```

- **(a) ID-only entry:** exactly one observation, and it is non-blocking:
  `violations` is empty. It names the file and the advisory, and it points to
  `versions` and `paths`. It also says the entry "names no package, version
  range or lockfile path", so it covers `package` too.
- **(b) Fully scoped entry:** no observation and no violation.
- **(c) Package-only entry:** one non-blocking observation that names `zod`
  and suggests `versions` and `paths`.

Cases (a) and (c) show the check can produce output, so (b)'s empty result is
a real "nothing to warn about", not a check that never fires.

### 7b. Unreadable bun.lock, and bun.lock entries of unknown shape, with a scoped exclusion

All three trees use the scoped `audit.ignore.local.json` (`dcf1e21c…`) and the
controlled bun report (`bf3822b6…`).

```text
$ ls -l lock-unreadable/bun.lock
----------
--- lock-unreadable   bun.lock=mode 000 (bytes = base f1a07722…)
[helper exit=1 shim=0]
[helper] resolved @codyswann/lisa/audit -> <package>/dist/core/audit.js
[helper] failed closed: Cannot evaluate scoped audit exclusions from bun.lock: EACCES: permission denied, open '<shipped>/trees-extra/lock-unreadable/bun.lock'
[adapter exit=1 shim=0]
❌ Security audit configuration invalid: Cannot evaluate scoped audit exclusions from bun.lock: EACCES: permission denied, open '<shipped>/trees-extra/lock-unreadable/bun.lock'
--- lock-unknown-shape   bun.lock=bc74693a1a2ddfe6   (adds "odd-entry": {"version": "1.0.0"}, an object instead of a tuple)
[helper exit=1 shim=0]
[helper] failed closed: Cannot evaluate scoped audit exclusions from bun.lock: Unknown bun.lock package data at odd-entry
[adapter exit=1 shim=0]
❌ Security audit configuration invalid: Cannot evaluate scoped audit exclusions from bun.lock: Unknown bun.lock package data at odd-entry
--- lock-bad-version   bun.lock=9eaae3be412eadc9   (adds "odd-pkg": ["odd-pkg@not-a-version", …])
[helper exit=1 shim=0]
[helper] failed closed: Cannot evaluate scoped audit exclusions from bun.lock: Unknown lockfile package data at odd-pkg: odd-pkg@not-a-version
[adapter exit=1 shim=0]
❌ Security audit configuration invalid: Cannot evaluate scoped audit exclusions from bun.lock: Unknown lockfile package data at odd-pkg: odd-pkg@not-a-version
```

The exported helper and the shipped adapter both fail closed, with
`Cannot evaluate scoped audit exclusions` and the cause, before any audit call
(`shim=0`).

**Control:** after `chmod 644`, the same `lock-unreadable` tree passes the
shipped adapter: `excluded GHSA-mrhx-c7xc-m3w5 for lint-plugin/zod (…)`, exit 0.
So the refusal came from the file being unreadable and from nothing else in the
tree.

Not covered here: the unreadable and unknown-shape lockfiles were run through
the helper and the adapter only, not the pre-push, registry or CI consumers.
Those three consumers call the same adapter or the same canonical source, and
they were exercised on the missing and unparseable lockfile cases in
section 3.

## Other things found on the reviewed head (outside the #4521 claims)

- **🔒 Security Floors**, run 42488821964 on `1e3ade8714`, **failed**. Its step
  "Audit force-pinned security floors" reported that `systeminformation`
  `>=5.31.7` in `typescript/package-lisa/package.lisa.json` (`force.overrides`
  and `force.resolutions`) still allows GHSA-3f7j-7jwc-fxfj (high), patched in
  5.33.16. This branch did not change that floor; it is a newly published
  advisory against a floor already on `main`, and it now needs its own work
  item.
- **🕵️ Review Evidence**, run 42488822010 on `1e3ade8714`, **failed**.
  CodeRabbit was rate-limited (`neutral`) at that head. The gate also saw the
  review state from earlier heads. Afterwards a `lisa:review-substitute` PR
  comment recorded an independent agent review of the final two commits, with
  verdict "approve, no blockers". It states plainly that it is not a
  third-party review. The gate was not re-run after that comment.

## Not established

- **What the controlled replays do not prove.** Sections 3 and 6 use the
  verifier's own fixtures and reports; they show how the shipped code behaves
  on known inputs. Section 4 is the only live advisory access, and it is one
  sample at 2026-11-08T14:58Z.
- **Real npm and Yarn installs.** The npm and Yarn reports and lockfiles are
  controlled. No real npm or Yarn project was audited against the live
  service, and Yarn Berry lockfiles were not exercised.
- **The full hook and the full gate set.** Only the pre-push hook's audit block
  ran, not the whole hook, and the registry was limited to the
  dependency-vulnerability gate.
- **A hosted CI run of the shipped package itself.** The CI consumer ran the
  merge commit's action source on this machine.
- **Hosted test log on the merge commit.** The hosted log is from the merge's
  second parent, `1e3ade8714`, not from `3d45307ef4`.
- **A third-party review of the final head.** CodeRabbit did not review
  `1e3ade8714`, and the Review Evidence check is still red for that head.

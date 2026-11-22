# CodySwannGT/lisa#4521 — local consumer parity (cli-output: audit-consumer-parity)

Independent verification by an agent that did not implement the change.
Branch `claude/4521-path-scoped-audit-exclusions`, head
`d01b1c5dc8db2aaf8bfc58e505fa34f3db18ce84`, built locally with `bun run build`
(exit 0, working tree clean afterwards). Toolchain: Node 24.21.0, Bun 1.4.4.
Captured 2026-11-07 (UTC).

Machine-private paths are replaced with `<worktree>` (the branch checkout),
`<job-tmp>` (the verifier's scratch directory) and `<tmpdir>` (the OS temp
directory).

What this file establishes, and what it does not:

- Sections 1, 2 and 5 use **controlled fixture data** that the verifier wrote.
  They prove how the consumers behave on the same inputs. They are not live
  advisory access.
- Section 3 is the **live** part: real `bun audit` output from the advisory
  service, run against Lisa's own checkout.
- Nothing here covers hosted CI, a merge, a release, or the published package.
  See "Not established" at the end.

## 1. Validation Journey step 1: replay the issue's driver on the fixed build

The driver bytes are the ones in `reproduce-empty-paths.mjs.txt` and
`reproduce-legacy-controls.mjs.txt`. Their digests match `red-green.md`. Each
run directory links `dist` to this branch's build.

```text
$ node --version; shasum -a 256 drivers
v24.21.0
eaa4be56990997e8ae598ed1bbdb10271d98c95593911c3782230cb1c2107697  reproduce-empty-paths.mjs
d0afac3086aa4466a3bacface2bc779bd04ce40f7552944ce787c154b3b0165b  reproduce-legacy-controls.mjs
$ node reproduce-empty-paths.mjs   # run 1
{"root":"<tmpdir>/lisa-4521-reproduction-KfuBPB","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
$ node reproduce-empty-paths.mjs   # run 2
{"root":"<tmpdir>/lisa-4521-reproduction-nVHdzq","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
$ node reproduce-empty-paths.mjs   # run 3
{"root":"<tmpdir>/lisa-4521-reproduction-27uEAI","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
fixture sha256 (latest run):
887157b3acdc9d55c34a4a37e0e8f99fecc0231e44e2c0aac94c26a9efb39e13
$ node reproduce-legacy-controls.mjs   # runs 1-3 printed the same line
{"documented":[],"undocumented":["`audit.ignore.local.json` excludes advisory `GHSA-mrhx-c7xc-m3w5` from the dependency audit with no written decision (no reason/notes/justification field), so nobody can tell whether the exception is still true"]}
exit=0   (x3)
```

Result: 3/3 runs reject the empty `paths` entry, matching the fixture digest
recorded in `red-green.md` (`887157b3…`). Both legacy controls hold: the
documented ID-only entry is accepted, and the undocumented one is still
reported.

## 2. Validation Journey step 2: the same trees through four real consumers

### Fixture construction (controlled fixture data)

`verify-make-trees.mjs.txt` (sha256 `880c103a…be2a2`) builds 13 trees from
scratch. It does not reuse the test helpers' fixtures. Each tree contains:

- a text-JSONC `bun.lock` written in bun's style, with trailing commas. The base
  layout has `zod` → `zod@4.6.6` and `lint-plugin/zod` → `zod@3.25.76`;
- `audit.ignore.local.json`, plus `audit.ignore.config.json` where the case
  needs a managed entry;
- `scripts/lisa-audit.mjs`, copied byte-for-byte from
  `all/copy-overwrite/scripts/lisa-audit.mjs`;
- `node_modules/@codyswann/lisa`, a link to the build under test, so
  `@codyswann/lisa/audit` resolves through the package `exports` map just as it
  does in a host project;
- a `package.json` with `security:audit` → `$npm_execpath run security:audit:lisa`
  → `node scripts/lisa-audit.mjs`, the scripts `package.lisa.json` ships;
- a `.lisa.config.json` that marks `dependency-vulnerability` required at
  `push` and switches the other built-in push properties off, so the registry
  runs only the audit gate.

The advisory report is `verify-controlled-bun-audit-report.json.txt` (sha256
`bf3822b6…a66a3`). It is the genuine live zod record from section 3, copied
unchanged into the shape `bun audit --json` emits:
`{"zod":[{id, url …GHSA-mrhx-c7xc-m3w5, severity high, vulnerable_versions "<4.6.6", …}]}`.
A `bun` shim placed first on `PATH` answers **only** `bun audit …` with that
file. Every other `bun` call goes to the real Bun 1.4.4, and each `audit` call
is logged so the table can show the shim was used (`shim=N`).

### The four consumers

| Consumer | Exactly what ran |
| --- | --- |
| pre-push | The template hook `typescript/copy-contents/.husky/pre-push`. Its `lisa_gate_covers` helper and its verbatim audit block, from `# Run security audit` up to the slow-lint section (block sha256 `93d82296…dadd687`), were extracted into a harness (sha256 `b2028fda…3b3148`) and run with `sh`, with `PACKAGE_MANAGER=bun` and no gate coverage file. That block runs `bun audit --production --json` and pipes the result to `node scripts/lisa-audit.mjs --manager bun --stdin`. Lisa's own `.husky/pre-push` audit block differs from it only by a 13-line comment. |
| registry | `node <worktree>/all/copy-overwrite/scripts/lisa-run-gates.mjs --moment=push`. `lisa-gates.mjs list --moment=push` resolves the gate to `required dependency-vulnerability → bun run security:audit`. |
| CI | `GITHUB_WORKSPACE=<tree> LISA_AUDIT_ACTION_MANAGER=bun LISA_AUDIT_ACTION_DIRECTORY=. node <worktree>/.github/actions/dependency-audit/run.mjs`, after the action's own `npm ci --ignore-scripts --prefix <action>` (exit 0). It bundles `src/core/audit.ts` with esbuild. It does **not** use `dist`. |
| exported helper | `verify-helper-consumer.mjs.txt` (sha256 `41aee5eb…e2a2`). It resolves `@codyswann/lisa/audit` from the tree's own `node_modules` (resolved to `<worktree>/dist/core/audit.js`) and calls `runDependencyAudit(tree, "bun")`. |

### Per-case results (exit 0 = PASS, nonzero = FAIL)

| Case | Expected | pre-push | registry | CI | helper | Decision line (identical in all four unless noted) |
| --- | --- | --- | --- | --- | --- | --- |
| control-no-exclusion (bite control) | FAIL | FAIL | FAIL | FAIL | FAIL | `GHSA-mrhx-c7xc-m3w5: unresolved high/critical advisory for zod` |
| covered-only | PASS | PASS | PASS | PASS | PASS | `excluded GHSA-mrhx-c7xc-m3w5 for lint-plugin/zod (Verifier fixture: reviewed dev-only lint plugin copy)` |
| uncovered production copy | FAIL | FAIL | FAIL | FAIL | FAIL | `… vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)` |
| zod 4.5.0 vs `versions` 3.x | FAIL | FAIL | FAIL | FAIL | FAIL | `… vulnerable paths outside exclusion: app-dep/zod (zod@4.5.0)` |
| npm alias | FAIL | FAIL | FAIL | FAIL | FAIL | `… vulnerable paths outside exclusion: schema-alias (zod@3.25.76)` |
| package mismatch | FAIL | FAIL | FAIL | FAIL | FAIL | `… package zod is outside exclusion package other-lib` |
| `paths: []` | FAIL | FAIL | FAIL | FAIL | FAIL | `failed closed: … paths must be a non-empty array of lockfile key paths` |
| missing `bun.lock`, scoped entry | FAIL | FAIL | FAIL | FAIL | FAIL | pre-push, CI and helper: `failed closed: Cannot evaluate scoped audit exclusions from bun.lock: ENOENT …`. Registry: `failed closed: No supported audit lockfile found (bun.lock, package-lock.json or yarn.lock)`. See note A. |
| unparseable `bun.lock`, scoped entry | FAIL | FAIL | FAIL | FAIL | FAIL | `failed closed: Cannot evaluate scoped audit exclusions from bun.lock: Cannot parse bun.lock packages map (expected text JSONC)` |
| legacy ID-only `{id, reason}` with an uncovered copy present | PASS | PASS | PASS | PASS | PASS | (none: advisory-wide meaning unchanged, silent pass) |
| misspelled `path` key | FAIL | FAIL | FAIL | FAIL | FAIL | `failed closed: … unknown field "path" (did you mean "paths"?); a misspelled scope field would otherwise be ignored …` |
| harmless `url` key | PASS | PASS | PASS | PASS | PASS | `excluded GHSA-mrhx-c7xc-m3w5 for lint-plugin/zod (…)` |
| managed ID-wide plus local scoped, uncovered copy | FAIL | FAIL | FAIL | FAIL | FAIL | `… advisory-wide exclusion was not applied because a narrower paths/versions exclusion exists for zod` + `… vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)` |

**All 52 verdicts (13 cases × 4 consumers) agree with each other and with the
expected result. No consumer disagrees.** The decision lines are
byte-identical across all four consumers in 12 of the 13 cases. The
exception is note A.

Note A: when `bun.lock` is missing, the registry's `security:audit` task calls
`node scripts/lisa-audit.mjs` without `--manager`. Lockfile detection
therefore fails before the scope check is reached, and the message names the
missing lockfile differently. The verdict is the same fail-closed block. In a
real push the hook chooses the manager from the lockfile, and the harness's
forced `PACKAGE_MANAGER=bun` is an artifact of this setup.

### Input digests (sha256)

| Input | sha256 |
| --- | --- |
| base `bun.lock` (control, covered, package-mismatch, empty-paths, misspelled, url-key) | `f1a0772256d75c533c5a29090a1f834fae75d95cef53d7845c367d55e36755f2` |
| uncovered `bun.lock` (uncovered, legacy, managed+local) | `306f766b3c326dc5225b959c3ed103cdd4b8a8027b1ac606651020ae40959d35` |
| zod 4.5.0 `bun.lock` | `2bbe301cea7ceabb385662956550aec6c97c49db18dbe4b503676d2beed916d4` |
| alias `bun.lock` | `5164d0e412cb003b73bbd6156f983142633326e470f052703f35f5b8bca9363c` |
| unparseable `bun.lock` | `d81e5d84a8f4ff657d3711d6da9ace98cb92a0cb8cfcb4c3d54c5920e3538d79` |
| scoped local entry (covered, uncovered, 4.5.0, alias, missing, garbage, managed+local) | `dcf1e21c22de04f9ee5b47f445be7a0f628bcff3b5651e16e31ecaaf7c103b26` |
| no-exclusion local | `0114d4d93ba4ad3dd94949bfb0f6f865a5c4a6c6246d6c3256c4b85c885bcadc` |
| package-mismatch local | `ebc4b9f7fd49c936e0ac34c21e6076b8351cf254ddc8bac6a70ae41c9eba5451` |
| empty-paths local | `1d35ecfd22b042fcc5790a98bb1e5b0aabaa3fd9f5bdafd82ca4c78700656835` |
| legacy ID-only local | `61f1791e933c51f7dca5a3581635ceb42c645fc38145cd8b22000b88ede9fe66` |
| misspelled-key local | `41917b599d198724778e1f7480b311a29b8db83d6e946659d88ef026c609c2b4` |
| url-key local | `8926f5b1a4a9a457fe6ef928a99f8820801e9fb06c6850bc69a50bab4e00b272` |
| managed ID-wide `audit.ignore.config.json` | `91458bf65f445aabd489b42573ba4626efb9383be90b05c590c2602d3de96093` |
| controlled bun audit report | `bf3822b6a6aba46689df2686a2ff98225b3b1f4f25b07432311cf8af1d5a66a3` |

### Full output, two representative cases

```text
### uncovered-production / prepush (exit 1)
🔒 Running security audit...
GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
❌ High or critical vulnerabilities found in production dependencies
   Next step: upgrade or override the named copy; if it is dev-only and reviewed, add its lockfile path to `paths` in audit.ignore.local.json — see https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md
### uncovered-production / registry (exit 1)
🔖 Lisa identity — surface=local · package=@codyswann/lisa@4.90.0 · registry=<worktree>/all/copy-overwrite/scripts · workflow=unknown · lisa-gates.mjs=sha256:640b0d07b61a · lisa-run-gates.mjs=sha256:92c3de77e215
🚦 Gates at push:
$ $npm_execpath run security:audit:lisa
$ node scripts/lisa-audit.mjs
GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
❌ High or critical vulnerabilities found in production dependencies
   Next step: upgrade or override the named copy; if it is dev-only and reviewed, add its lockfile path to `paths` in audit.ignore.local.json — see https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md
error: script "security:audit:lisa" exited with code 1
error: script "security:audit" exited with code 1
  UNPROVABLE required dependency-vulnerability    bun run security:audit (exit 1) — no recognised failure signature: Lisa could not read this tool's output, so nothing here is a verdict about the code. Re-run this one check on its own — the tool names what the classifier could not. The command's last lines follow
      ↳ GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
      ↳ ❌ High or critical vulnerabilities found in production dependencies
      ↳ Next step: upgrade or override the named copy; if it is dev-only and reviewed, add its lockfile path to `paths` in audit.ignore.local.json — see https://github.com/CodySwannGT/lisa/blob/main/docs/depe
❓ required gate NOT PROVED: dependency-vulnerability — bun run security:audit (exit 1) — no recognised failure signature: Lisa could not read this tool's output, so nothing here is a verdict about the code. Re-run this one check on its own — the tool names what the classifier could not. The command's last lines follow
### uncovered-production / ci (exit 1)
GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
❌ High or critical vulnerabilities found in production dependencies
   Next step: upgrade or override the named copy; if it is dev-only and reviewed, add its lockfile path to `paths` in audit.ignore.local.json — see https://github.com/CodySwannGT/lisa/blob/main/docs/dependency-audit-exclusions.md
### uncovered-production / helper (exit 1)
[helper] resolved @codyswann/lisa/audit -> <worktree>/dist/core/audit.js
GHSA-mrhx-c7xc-m3w5: vulnerable paths outside exclusion: app-dep/zod (zod@3.25.76)
[helper] passed=false
### missing-lockfile / prepush (exit 1)
🔒 Running security audit...
❌ Security audit failed closed: Cannot evaluate scoped audit exclusions from bun.lock: ENOENT: no such file or directory, open '<job-tmp>/trees/missing-lockfile/bun.lock'
### missing-lockfile / registry (exit 1)
❌ Security audit failed closed: No supported audit lockfile found (bun.lock, package-lock.json or yarn.lock)
  UNPROVABLE required dependency-vulnerability    bun run security:audit (exit 1) — no recognised failure signature: …
### missing-lockfile / ci (exit 1)
❌ Security audit failed closed: Cannot evaluate scoped audit exclusions from bun.lock: ENOENT: no such file or directory, open '<job-tmp>/trees/missing-lockfile/bun.lock'
### missing-lockfile / helper (exit 1)
[helper] resolved @codyswann/lisa/audit -> <worktree>/dist/core/audit.js
[helper] failed closed: Cannot evaluate scoped audit exclusions from bun.lock: ENOENT: no such file or directory, open '<job-tmp>/trees/missing-lockfile/bun.lock'
```

Observation B (outside this item's acceptance criteria; the gate still
blocks): when the registry runs `security:audit` and the audit finds a real
vulnerability, it labels the gate `UNPROVABLE` and adds "Lisa could not read
this tool's output, so nothing here is a verdict about the code". That
sentence is not true here. The tool named the vulnerable copy. The push is
still blocked: exit 1, and the gate is counted as not proved. But an operator
reading this could take a real finding for a tooling hiccup. The cause is that
`lisa-run-gates.mjs` (not changed on this branch) has no failure signature for
the audit's output. This branch makes that path reachable by replacing
`declareOnly` with `fallbackWhenTaskMissing` and shipping `security:audit`.
One possible fix is a declared `failureShape`, or a built-in signature, for
`❌ High or critical vulnerabilities found` / `Security audit failed closed`.

### Falsification (the checks above can fail)

- **Bite control:** `control-no-exclusion` fails in all four consumers, so the
  controlled report is really being evaluated. The shim log shows one
  `bun audit` call per consumer in each case that reaches the network step.
  The cases that are rejected during scope validation make none in
  registry/CI/helper, because `runDependencyAudit` validates scope before it
  calls the network.
- **Mutation of the path check:** in `dist/core/audit-matcher.js` the clause
  `(entry.paths !== undefined && !entry.paths.includes(copy.path))` was
  replaced with `(false)`. The file's sha256 went from `9a6544e1…d579e` to
  `08f7c9b6…933e1`. The full harness was then re-run. Exactly the three
  path-dependent cases flipped to PASS in the three consumers that run `dist`
  (pre-push, registry, helper): `uncovered-production`, `npm-alias` and
  `managed-wide-plus-local-scoped`. CI, which bundles `src`, stayed FAIL. The
  harness reported `decision lines identical across consumers: no` for each of
  them. `version-boundary-zod-4.5.0` stayed FAIL everywhere, because the
  `versions` check still excluded it. The original bytes were then restored
  and the digest re-checked (`9a6544e1…d579e`), and the clean run above was
  taken after that restore. So the cases depend on the path check, the three
  `dist` consumers really do execute `dist`, and the harness catches a
  disagreement between consumers.
- **The expected-verdict comparison** in the harness was tested with synthetic
  inputs. A mixed PASS/FAIL row produced `met=no` for both expected values, and
  a uniform row produced `met=yes`.

### Doctor uses the same scope validation

Built `auditExceptionViolations` run over the same trees and over Lisa:

```text
{"case":"lisa-itself","violations":[]}
{"case":"covered-only","violations":[]}
{"case":"empty-paths","violations":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
{"case":"misspelled-path-key","violations":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: unknown field \"path\" (did you mean \"paths\"?); a misspelled scope field would otherwise be ignored and excuse more copies than written, so the exclusion is rejected"]}
{"case":"harmless-url-key","violations":[]}
{"case":"legacy-id-only","violations":[]}
{"case":"uncovered-production","violations":[]}
```

The doctor's supply-chain dimension `assessDependenciesSupplyChainDimension` was
run on copies of the trees whose manifests declare dependencies. It reports the
ID-only entry as a non-blocking observation: "`audit.ignore.local.json` hides
this advisory for every copy of the affected package: … names no package,
version range or lockfile path … add `versions` and `paths` so only that copy is
excused". It also reports the managed-wide-plus-local case as a non-blocking
observation: "`audit.ignore.config.json` excuses advisory … for every copy, but
`audit.ignore.local.json` lists the specific copies that were reviewed, so the
audit uses only that narrower entry and ignores the wider one."

## 3. Live advisory access: Lisa's own checkout (real advisory service)

```text
2026-11-07T23:23:37Z
$ bun --version
1.4.4
$ shasum -a 256 bun.lock audit.ignore.local.json audit.ignore.config.json
21f69c9496a9c588537123e8f80efa49c15324e5823c69ecc07ffaa750ecd246  bun.lock
a1d5caeec7ad8e8cd6c030605a4c8ed6c640721423a1ff9f8230af288c6829e2  audit.ignore.local.json
44f4401b6b2328d0105f376846e5eb0e393c213b44798dc00f3d110e825245b3  audit.ignore.config.json
$ bun audit --production --json > live-audit.json
bun audit exit=1 bytes=    3965
sha256 live-audit.json: 7a890aa4ee0845ab00bb94769f93e0c61aa2161bdf64611bc0d5eb9832c61e0f
packages with high/critical advisories in the live report:
zod	high	https://github.com/advisories/GHSA-mrhx-c7xc-m3w5	<4.6.6
$ node scripts/lisa-audit.mjs --manager bun
excluded GHSA-mrhx-c7xc-m3w5 for eslint-plugin-react-compiler/zod (Repository-specific exception for one copy: zod 3.25.76, nested under eslint-plugin-react-compiler 19.1.0-rc.2 … Recheck by 2026-11-24, and remove it once the plugin accepts zod 4.6.6+.)
✅ No high or critical vulnerabilities found in production dependencies (excluding documented exceptions)
exit=0
$ bun run security:audit
$ $npm_execpath run security:audit:lisa
$ node scripts/lisa-audit.mjs
excluded GHSA-mrhx-c7xc-m3w5 for eslint-plugin-react-compiler/zod (… same reason …)
✅ No high or critical vulnerabilities found in production dependencies (excluding documented exceptions)
exit=0
```

The live service reports GHSA-mrhx-c7xc-m3w5 (high, `<4.6.6`) for zod. The
real adapter excludes it **only** for `eslint-plugin-react-compiler/zod`, the
single 3.x copy. Every other zod in the tree is 4.6.7, outside the vulnerable
range. The other packages in the live report (`@vitest/mocker`, `deepmerge`,
`fast-uri`, `glob`, `minimatch`, `postcss-selector-parser`, `smol-toml`) carry
no high or critical advisory.

## 4. The compensating zod control still passes

```text
$ VITE_CONFIG_NATIVE_IGNORE_WARNING=true bunx vitest run --reporter=verbose tests/unit/config/zod-security-floor.test.ts
 ✓ … zod security floor (GHSA-mrhx-c7xc-m3w5) > leaves only the accepted plugin copy inside the advisory's range
 ✓ … > resolves every other zod to a patched 4.x
 ✓ … > has exactly one package that still needs zod 3
 ✓ … > floors the root zod past the advisory
 ✓ … > ships no zod floor that admits the advisory
 ✓ … > rejects the vulnerable controls and clears the patched release
 ✓ … > records the exception for Lisa's own tree, with its tracking and reason
 ✓ … > keeps the exception out of the managed audit.ignore.config.json
 ✓ … > keeps the exception out of the managed typescript/copy-overwrite/audit.ignore.config.json
 Test Files  1 passed (1)
      Tests  9 passed (9)
exit=0
```

This is a code-unit test log. It shows the compensating control is present
and green on this head. It is not evidence about any consumer's behavior.

## Not established

- **Hosted CI.** The new audit specs have not yet been seen running by name in
  CI on this head. Section 2 ran the CI action's `run.mjs` locally, not on a
  GitHub runner, and not through the reusable workflow's `uses:` pin.
- **Merge, Release and Deploy.** No merge has happened, so no release run and
  no published package exist to check.
- **Replay against the published package.** The `@codyswann/lisa/audit` helper
  was resolved from this branch's local build through a linked
  `node_modules`, not from a downloaded npm tarball.
- **npm and Yarn consumers.** Every case above uses Bun. `package-lock.json`
  and `yarn.lock` parity was not exercised by this verifier.
- **Real npm-alias capture.** The alias case is controlled fixture data. No
  real installed alias was audited against the live service.
- **The full pre-push hook.** Only the hook's audit block and gate-coverage
  helper ran, not the whole hook. The registry run was limited to the
  dependency-vulnerability gate.
- **Note A and Observation B** above: the missing-lockfile message wording
  differs in the registry, and a real finding is labelled UNPROVABLE there.
  Neither changes a verdict.

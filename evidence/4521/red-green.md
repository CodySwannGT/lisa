# CodySwannGT/lisa#4521 — audit-scope RED/GREEN (cli-output: audit-scope-red-green)

Controlled, isolated fixture data only. No live advisory query is claimed here;
this proves the doctor validation boundary from Validation Journey step 1 and
nothing about hosted CI, release, or shipped-byte acceptance.

Machine-private paths are replaced by `<job-tmp>` (the job scratch directory)
and `<tmpdir>` (the OS temp directory). Toolchain: Node 24.21.0, Bun 1.4.4.

## Inputs and identities

| Input | SHA-256 |
| --- | --- |
| `reproduce-empty-paths.mjs` (driver, verbatim from the issue's Steps to Reproduce; copy: `reproduce-empty-paths.mjs.txt`) | `eaa4be56990997e8ae598ed1bbdb10271d98c95593911c3782230cb1c2107697` |
| `audit.ignore.local.json` written by that driver (identical bytes in all six runs) | `887157b3acdc9d55c34a4a37e0e8f99fecc0231e44e2c0aac94c26a9efb39e13` |
| `reproduce-legacy-controls.mjs` (reachability/legacy controls; copy: `reproduce-legacy-controls.mjs.txt`) | `d0afac3086aa4466a3bacface2bc779bd04ce40f7552944ce787c154b3b0165b` |
| `codyswann-lisa-4.90.0.tgz` (released package, `npm pack @codyswann/lisa@4.90.0`) | `9b8f63426cc9d75821a8e085842fd3cd053bd40d0b5502bec75cd89f41356fbf` |

Fixture bytes:

```json
{"exclusions":[{"id":"GHSA-mrhx-c7xc-m3w5","package":"zod","versions":">=3.0.0 <4.0.0","paths":[],"reason":"Isolated controlled fixture for invalid empty paths."}]}
```

The driver imports `./dist/cli/doctor-readiness-audit-allowlist.js`. Each run
directory holds an identical copy of the driver and a `dist` symlink to the
build under test, so the bytes executed never change between RED and GREEN.

## RED — released `@codyswann/lisa@4.90.0` (pre-fix code)

```text
$ npm pack @codyswann/lisa@4.90.0 && tar xzf codyswann-lisa-4.90.0.tgz
$ ln -s <job-tmp>/red/pkg/package/dist <job-tmp>/red/run-red/dist
$ cd <job-tmp>/red/run-red && for i in 1 2 3; do node reproduce-empty-paths.mjs; echo "exit=$?"; done
{"root":"<tmpdir>/lisa-4521-reproduction-kQ4R3w","result":[]}
exit=1
{"root":"<tmpdir>/lisa-4521-reproduction-6rsHWA","result":[]}
exit=1
{"root":"<tmpdir>/lisa-4521-reproduction-H0ChOW","result":[]}
exit=1
```

3/3: the released doctor accepts the present-but-empty `paths` array with no
diagnostic, matching the issue's recorded actual behavior.

## GREEN — this branch, `bun run build` → `./dist`

First replay at branch head `bd54600263` (before this session's commits):

```text
$ ln -s <worktree>/dist <job-tmp>/red/run-green/dist
$ cd <job-tmp>/red/run-green && for i in 1 2 3; do node reproduce-empty-paths.mjs; echo "exit=$?"; done
{"root":"<tmpdir>/lisa-4521-reproduction-mwbVxW","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-DAhQOe","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-hhX9TR","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
```

Final replay after the doctor-observation change (`e3b2db03c1`, rebuilt):

```text
{"root":"<tmpdir>/lisa-4521-reproduction-GLbsvC","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-dGQYLd","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
{"root":"<tmpdir>/lisa-4521-reproduction-39fcz2","result":["audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: paths must be a non-empty array of lockfile key paths"]}
exit=0
```

3/3 in both replays: the empty `paths` entry is rejected with a clear message.

## Reachability and legacy controls

Control A writes a documented ID-only entry (`{id, reason}`) and must stay
accepted; control B writes an undocumented entry (`{id}`) and must stay
reported. Same driver bytes against both builds:

```text
# released 4.90.0
{"documented":[],"undocumented":["`audit.ignore.local.json` excludes advisory `GHSA-mrhx-c7xc-m3w5` from the dependency audit with no written decision (no reason/notes/justification field), so nobody can tell whether the exception is still true"]}
exit=0

# branch at bd54600263 (doctor's ID-only warning went to stderr only)
audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: unscoped advisory-wide exclusion; prefer package, versions and paths for a dev-only exception
audit.ignore.local.json: GHSA-mrhx-c7xc-m3w5: unscoped advisory-wide exclusion; prefer package, versions and paths for a dev-only exception
{"documented":[],"undocumented":[...same line as above...]}
exit=0

# branch at e3b2db03c1 (warning now returned in doctor's report as an observation)
{"documented":[],"undocumented":[...same line as above...]}
exit=0
```

Both controls hold before and after: the fix rejects only the invalid scope.
The documented legacy entry is still accepted, and the undocumented entry is
still reported. At `e3b2db03c1` the ID-only warning no longer goes to stderr.
Doctor's supply-chain dimension now carries it as a non-blocking observation,
covered by `tests/unit/cli/doctor-readiness-supply-chain-exceptions.test.ts`.

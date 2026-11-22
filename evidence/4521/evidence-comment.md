## Evidence: CodySwannGT/lisa#4521, path-scoped dependency-audit exclusions

Update from Claude Code (AI agent). This work shipped in PR #4693, released as `@codyswann/lisa@4.96.3`.

**One mistake to own up front:** I first dismissed a review note about shallow checkouts as harmless. That kept the hosted "Run Integration Tests" check red until `c7fc9f0419` and `1e3ade8714` fixed it.

### What changed, in plain terms

An audit exclusion can now name exactly which copies of a package it covers, using `paths` (lockfile keys) and `versions`. The audit then excuses an advisory only when every vulnerable copy is one of those. Any other copy, including one reached through an npm alias, still blocks the push and is named in the output. The pre-push hook, the gate registry, the CI audit job and the exported helper `@codyswann/lisa/audit` all use one shared matcher, so they always agree.

### What this shows (evidence manifest)

1. **`audit-scope-red-green`** (cli-output, `evidence/4521/red-green.md`). The issue's own reproduction driver returns `[]` and exits 1 on the released 4.90.0 (3/3 runs). It rejects `paths: []` and exits 0 on the fixed code (3/3).
2. **`audit-consumer-parity`** (cli-output, `evidence/4521/consumer-parity-local.md` and `shipped-byte-replay.md`). An independent verifier, who did not implement the change, built its own test projects:
   - Locally: 13 Bun trees × 4 consumers, 52/52 agreeing verdicts.
   - On the published 4.96.3 bytes: 65/65 across 5 consumers, plus npm and Yarn trees at 40/40.
   - Deliberately disabling the path check makes the affected cases flip, which proves the checks can fail.
3. **`audit-current-head-gates`** (test-run-log, `evidence/4521/hosted-named-audit-specs.log.txt`). Hosted CI run 42488822127, job "🧾 Named Regression Specs", step "Execute and name dependency-audit scope regression specs":
   - `Test Files 17 passed (17)`, `Tests 381 passed | 2 skipped (383)`.
   - Every spec is listed by name. The only 2 skips are the declared bun-only cases in `quality-audit-fail-closed`.
4. **`audit-release-delivery`** (deploy-log, `evidence/4521/release-4.96.3-deploy.log.txt`). Release and Deploy run 42490840830 succeeded on merge `3d45307ef4` (push to `main`). It published `@codyswann/lisa@4.96.3`, shasum `526203df9b1b2e8c75f06301ba953b0ed4cd1ba7`, from release commit `4c5547de18`, which descends from the merge.
5. **`audit-shipped-byte-replay`** (cli-output, `evidence/4521/shipped-byte-replay.md`). The tarball's sha1 and sha512 match the registry. The same drivers and test projects were replayed on the shipped bytes with identical verdicts. A live `bun audit` of Lisa itself excludes GHSA-mrhx-c7xc-m3w5 only for `eslint-plugin-react-compiler/zod`.

**Artifact downloads** (the same bytes as the files in `evidence/4521/` on the branch):
1. https://github.com/CodySwannGT/lisa/releases/download/pr-assets/pr-4693-01-audit-scope-red-green.txt
2. https://github.com/CodySwannGT/lisa/releases/download/pr-assets/pr-4693-02-audit-consumer-parity.txt
3. https://github.com/CodySwannGT/lisa/releases/download/pr-assets/pr-4693-03-audit-current-head-gates.txt
4. https://github.com/CodySwannGT/lisa/releases/download/pr-assets/pr-4693-04-audit-release-delivery.txt
5. https://github.com/CodySwannGT/lisa/releases/download/pr-assets/pr-4693-05-audit-shipped-byte-replay.txt

**Regression tests added:**
- `tests/integration/`: `audit-consumer-parity`, `audit-workflow-action`, `audit-registry-verdict`, `pinned-revision-fetch`.
- `tests/unit/core/`: `audit-scopes`, `audit-lockfile-formats`, `audit-lockfile-sources`, `audit-report-completeness`, `audit-scope-hardening`, `audit-review-4693`.
- `tests/unit/config/audit-ignore-package-names`.
- `tests/unit/strategies/`: `package-lisa-audit-script-governance`, `security-audit-handling-scope`.
- `tests/unit/cli/doctor-audit-scope`.

### Artifact identity

- repository: `CodySwannGT/lisa`
- head_sha (what shipped): `3d45307ef4e4bf8e115901c5e388aef14c570bc8` (merge of PR #4693; second parent `1e3ade87145409b49ba5d483823c4eed9cf82aa7`)
- release: `@codyswann/lisa@4.96.3`, gitHead `4c5547de18a6a3332ea9116d85cd67a12f823430`, tarball sha256 `25a6620e18bb60b9cf583835c023d07554a14fdba9418819653dd486aa54e515`
- environment: production (`main`, npm registry), plus hosted GitHub Actions and an isolated local consumer for the replays
- artifacts (sha256, captured_at):
  - `red-green.md`: `87480cd5541dd69bfc1d7bc7cbc3fec93d618acdc87af6bc5ffe23e6e3ec25ed`, 2026-11-07
  - `consumer-parity-local.md`: `197fdd60abca0b78a39e4d1af5fedae18238820bb94ecbd7f32f9959156f7ebb`, 2026-11-07
  - `shipped-byte-replay.md`: `252e7bb7688b5544d60d4c04b32c2bea1400651f1a23be796e8cf5f375cf2096`, 2026-11-08T15:10:25Z
  - `hosted-named-audit-specs.log.txt`: `3fefa042afde73272b56d06b01daea7c16edbc7aa8ad221dc58ab1bf57014f3d`, 2026-11-08T14:21:01Z (from run 42488822127)
  - `release-4.96.3-deploy.log.txt`: `3d9f396cef66835f3350d14feb61ebc8015eca0821ab4806f2c5faaaf5d4cf0e`, 2026-11-08 (from run 42490840830)

### Not established

- **No third-party review of the final commit.** CodeRabbit completed real reviews at `7aaeca4f1a` and `a7109edd11`, and all 7 of its comments were fixed and resolved. It was rate-limited on the last three commits, so self-review substitutes were posted for those instead. Its two leftover "changes requested" verdicts were dismissed on the operator-delegated manager decision.
- **Path isolation on Yarn and hoisted npm keys is weaker by design.** A Yarn lockfile key identifies a requested version range, not a parent package, and a hoisted npm key identifies an install location. Listing such a key can therefore also cover a later production dependency that resolves to the same key. This is documented in `docs/dependency-audit-exclusions.md`; no Yarn project with a live advisory was available to show it end to end.
- **pnpm is refused, not supported.** The audit refuses a pnpm project by name rather than evaluating it.
- **A doctor pass is not proof the audit accepts the file.** `lisa doctor` validates scope fields and lockfile readability but does not match advisories against lockfile copies.
- **Two non-required hosted checks stayed red, and neither is caused by this change.** "Forced floors vs advisory database" fails because of a new `systeminformation` advisory, now filed as #4712. The Rails updater check failed during a GitHub release-download outage (504 errors).

### How to QA

1. Install `@codyswann/lisa@4.96.3` in a project with a `bun.lock`.
2. Add to `audit.ignore.local.json`: `{"id": "<GHSA>", "package": "<pkg>", "paths": ["<lockfile key of a dev-only copy>"], "reason": "…"}`.
3. Run `node scripts/lisa-audit.mjs --manager bun`. Expect `excluded <GHSA> for <path> (reason)`.
4. Add a vulnerable copy at a key you did not list, and run it again. Expect a failure that names that key.

If any step here differs from what you expected or saw, please tell me which step I got wrong.

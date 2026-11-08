Update from Claude Code (AI agent): verification evidence for #4609.

## What shipped

- **PR #4717** (merged as `fc1b7500`): 66 test files that only checked for phrases in documents are folded into `tests/phrase-manifest/required-phrases.json`, checked by one test, `tests/unit/docs/required-phrases.test.ts`. The Ruby test's version check now switches off RubyGems, ignores inherited Ruby settings, and uses the same Ruby the test runs (comments 6–7 and CodeRabbit).
- **PR #4725** (merged as `765f2477`): a follow-up. After #4717 merged, the parity proof stopped working on `main`, because a separate change deleted 7 more test files and the proof counted them. It now looks only at the fold commit's own deletions.

## What this shows

Each check below was run by an independent verifier on the merged `main`:

1. **Every phrase check is in the manifest (scenario 1).** `bun run check:phrase-manifest-parity` reports 66 deleted files, all phrase-only: 5,375 checks (5,183 distinct) before and 5,183 manifest entries after, `parity: OK`. Removing one manifest entry makes it fail and name that entry.
2. **Removing a required phrase fails the test (scenario 2).** Deleting `scripts/verify-wiki-safety.mjs` from `plugins/src/base/skills/lisa-agent-ready/SKILL.md` gives `…SKILL.md is missing required phrase "scripts/verify-wiki-safety.mjs"`.
3. **Adding a forbidden phrase fails the test (scenario 3).** Appending a forbidden phrase to `.claude/rules/PROJECT_RULES.md` gives `contains forbidden phrase "…"`. Moving a listed file away fails all of its checks with `does not exist, but the required-phrases manifest lists it`.
4. **The test file count drops (scenario 4).** 1,855 test files before #4717 and 1,794 after, a drop of 61: 66 files deleted, plus 1 manifest test and 4 tests for the new scripts. The issue's wording predicted 65; the 4 script tests are the difference.
5. **The new tests ran in CI.** The PR CI unit job shows `✓ tests/unit/docs/required-phrases.test.ts (5184 tests)`. The integration job shows 9 passing `rails-rspec-shard-ruby.test.ts` cases, none skipped.
6. **Ruby check.** With Ruby 4.0.1 and a stale `BUNDLER_SETUP`, all 9 Ruby cases pass. With the Mac's Ruby 2.6 they are deferred to CI, as intended.

Kept as they are: 24 phrase-only files that check part of a file rather than the whole file; the list is in PR #4717. Two phrase-only tests added to `main` after the base commit are not folded.

Codified tests added on these branches:
- `tests/unit/docs/required-phrases.test.ts`
- `tests/unit/scripts/phrase-tests-parity.test.ts`, plus the classify, manifest and record script tests
- a new case in `tests/unit/strategies/runtime-behavior-change-consistency.test.ts` that fails if a skill folder has no manifest coverage

## Artifact identity

- Repository: `CodySwannGT/lisa`
- Head verified: `765f2477886305a3d9ce0862a4de6d4a58bf42a8` (`main` after #4725). The fold merged as `fc1b7500267cf5a94ef2ca5e4aad01b936231a13`, and the PR head was `c37315ea4e95799895415e31410f96705908556a`.
- Environment: merged `main` plus PR CI run 42514279008
- Captured: 2026-11-08T21:04:43Z
- Evidence (sha256):
  - EV-1 parity run: `d393b6bedbe39c3c351a4994064981a8331f2f9e3476cb45ff42c59b99d74929`
  - EV-2 parity falsified: `2b45f9d0390e7c7111ff1d5572c61f7d3933e69dc2cca5be45bd957680b2d189`
  - EV-3 manifest and consistency tests: `4359ad92eece2c4885d41d94a2b3f169fe0543e7bb81bdd081ffce1626d17e9d`
  - EV-4 required phrase removed: `ffad9d112f2118b66a8cfeadff2dc6bd382ec5ac1ad3bd9b1ffd8c4a5c461ca6`
  - EV-5 forbidden phrase added: `58558a373f102cc5f889921765140e2d001de07929377bf00854f064e343f497`
  - EV-6 missing manifest file: `2fadeece6baa3e875f8aecceb9745608633293fc2800bd091184e72f3b1b9e92`
  - EV-7 test file count: `14467b644a2a9a18f9e5ca69750f515030bf743053148650e26f54a66667dcc0`
  - EV-8 deleted and added files: `6cda1dffb5cd6cf4b98f02b00074ab063bb6068ef21556672580e80ad9f0035f`
  - EV-9 Ruby 4.0.1 with stale `BUNDLER_SETUP`: `00f02f705d2a1aa3a9e41e90de8e45a7c86dea559356889262a5cd16d4878e6e`
  - EV-10 Ruby 2.6 deferral: `145e8ed02f24cca38565dde380700ddadd0bf2d79874743c24223456d100a8e1`
  - EV-11 CI unit log line: `c277d1da9a865bea518f2ae326312025509d0238a374d0c36bc623d936af43e0`
  - EV-12 CI integration log lines: `96deb9212c4438c35e7291732931e61e77c78d5e9e1b86ad6d00280eb2df4c9a`
  - EV-13 CI run list: `778f1e8ded060bb8d0b27d1d6b5ce56d2bc7a5cd10667feb61ed0a9d237a1504`

## Not established

- **rbenv was not tested.** It isn't installed on the verifying machine. The fix makes the check and the test drivers use one resolved Ruby path, but that was not observed under rbenv.
- **The Ruby and CI evidence comes from the PR commit** `c37315ea4e`, not from `765f2477`. #4725 changed only the parity script, not those files.
- **CodeRabbit did not review either PR's final commit** because it was rate limited. A local substitute review is posted on each PR, with no blockers. Its earlier "changes requested" review on #4717 was dismissed on the operator-delegated manager decision after its only comment was fixed.
- **The parity proof is not run by any CI job.** It is a manual check. Two low-priority review notes were deferred: `--head` with no value falls back to `HEAD`, and no test would catch a revert of the #4725 fix.
- **On this Mac the local push check fails on `npm-update-dual-lock.test.ts`.** The cause is the npm-installed, symlinked `bun`; it fails on `main` too and passes in CI. The pushes used a standalone Bun copy, with every check still run.

## How to QA

Run `bun run check:phrase-manifest-parity` on `main`; it should end with `parity: OK`. Then delete any phrase listed for a file in `tests/phrase-manifest/required-phrases.json` and run `bunx vitest run tests/unit/docs/required-phrases.test.ts`. The failure should name that file and that phrase.

If anything here differs from what you expected, please tell me which item I got wrong.

## Lisa Usage

| Skill | Source | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| lisa-implement | unavailable | — | — | — |
| lisa-verify | unavailable | — | — | — |

Agent-written by Claude Code.

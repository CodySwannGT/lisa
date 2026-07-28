# Quality Review — #1956 work-item sync lanes (T4)

Reviewer: quality-specialist · Date: 2026-07-22 · Branch: `fix/1956-work-item-sync-lanes`
Commits reviewed: `bdedff6e4`, `15d5ee8fb`, `5192d489d`

Everything below is written for a non-technical reader. "Blocking" means the
change must not be merged until it is fixed.

## Verdict: ONE blocking problem, otherwise high quality

The three fixes themselves are correct, well-tested, and well-explained. But
the wording change in the instruction manual (commit 3) broke six existing
automated checks that nobody updated, so the project's full test run currently
FAILS on this branch. That must be fixed before merge.

---

## Critical (must fix before merge)

### 1. The full test run fails: an older test still expects the old wording

- **What:** Commit 3 rewrote a sentence in the `lisa-implement` instruction
  file from "Rebase the feature branch onto `origin/<base>`…" to "Sync the
  feature branch onto the latest `origin/<base>`…". An existing automated
  check — written before this branch — reads that file and insists the OLD
  sentence is present. It now fails for all six copies of the file.
- **Why:** The project rule is "never approve code with failing tests," and CI
  will go red. Concrete failure: run `bun run test` on this branch →
  **6 failed, 7598 passed** (I ran it; the only failing file is this one).
  The team's proof command (`bunx vitest run
  tests/unit/scripts/lisa-work-item.test.ts tests/unit/hooks/`) IS green at
  **472/472 — the claimed count is accurate** — but that command's scope does
  not include the folder where this check lives, which is how the break was
  missed.
- **Where:** `tests/unit/strategies/implement-env-base-branch.test.ts:114`
  (assertion `"Rebase the feature branch onto \`origin/<base>\`"`).
- **Fix:** Update that one assertion to pin the new wording, e.g.
  ``"Sync the feature branch onto the latest `origin/<base>`"`` (ideally also
  pin a distinctive fragment of the new content, such as the rebase-lane or
  merge-lane phrase, so the test keeps guarding the meaning, not just any
  sentence). One-line test change; no product code change needed.
- **Blocking:** Yes.

---

## Warning (should fix, not blocking)

### 2. The new skill text slightly overpromises the merge lane

- **What:** The new instruction text says the merge lane simply works: "push
  validation exempts commits already reachable from the remote default
  branch." In the code, that exemption only activates when git can locally
  answer "what is the remote's default branch?" (the `origin/HEAD` pointer).
  When it can't — e.g., a repository whose remote was added by hand rather
  than cloned — validation deliberately stays strict, and a merge-synced push
  can still be rejected with a confusing "work item … is closed" error.
- **Why:** An agent following the skill to the letter in such a repo would hit
  a rejection the text says cannot happen, and the error message gives no hint
  that the missing `origin/HEAD` pointer is the cause. (The strict fallback
  itself is correct and security-motivated — this is purely a documentation
  gap. Normal `git clone` always sets the pointer, so the case is uncommon.)
- **Where:** `plugins/src/base/skills/lisa-implement/SKILL.md:98` (and its five
  generated copies); behavior in
  `all/copy-overwrite/scripts/lisa-work-item.mjs` (`remoteDefaultRef`).
- **Fix:** Either add half a sentence to the skill text ("requires the local
  `origin/HEAD` pointer; run `git remote set-head <remote> --auto` if pushes
  of merged base commits are rejected"), or extend the push-failure error
  message with that hint. Regenerate fan-out via `build:plugins`.
- **Blocking:** No — code behavior is correct and test-pinned; this is prose
  precision.

---

## Suggestions (nice to have, not blocking)

### 3. Abort-recovery prose skips the two fail-closed edge cases

- **What:** The skill text says `git rebase --abort` "is a safe, allowed
  recovery" until conflict resolutions exist. The hook additionally blocks
  abort on the rarely-used `--apply` rebase backend and when the internal
  `AUTO_MERGE` marker is missing — even with zero resolutions.
- **Why:** Only matters if an agent explicitly runs `git rebase --apply`; the
  skill's own instruction (`git rebase origin/<base>`) uses the default
  backend, so the promise holds on the documented path.
- **Where:** `plugins/src/base/skills/lisa-implement/SKILL.md:98`;
  guard 3b in `plugins/src/base/hooks/parity-safety-net.sh:320`.
- **Fix:** Optional parenthetical in the skill text, or leave as-is.

### 4. Two different guard-numbering schemes now diverge further

- **What:** The hook file numbers the new guard "3b" (so later guards keep
  their numbers — tests still correctly say "guard 14" for custom rules). The
  rules skill's human-facing list instead renumbered sequentially (new item
  is #5; list grew 14 → 15, renumbering verified complete and contiguous).
  "Guard 5" now means `rebase --abort` in the skill but `git switch` in the
  hook.
- **Why:** A future maintainer cross-referencing the two documents can grab
  the wrong guard. The offset predates this branch (guard "1b" already caused
  a ±1 skew); this change widens it to ±2 for later entries.
- **Where:** `plugins/src/base/hooks/parity-safety-net.sh` comment numbering
  vs `plugins/src/base/skills/lisa-parity-safety-net-rules/SKILL.md:69-92`.
- **Fix:** A one-line note in either file that the two numberings are
  independent, or adopt "5" / letter-suffix consistently. Follow-up material.

### 5. A comment says "never `--remotes=<remote>`" right above a line that uses it

- **What:** The security note on `remoteDefaultRef` (correctly) explains the
  default-branch exclusion must never use `--remotes=<remote>`. Twelve lines
  below, the pre-existing new-branch path still uses `--not --remotes=<remote>`
  — a different, legitimate situation (a brand-new branch has no remote
  counterpart to exploit), but a careful reader will see a contradiction.
- **Where:** `all/copy-overwrite/scripts/lisa-work-item.mjs` (`remoteDefaultRef`
  JSDoc vs the `ZERO_OID` arm of `parsePushLines`).
- **Fix:** One clarifying comment on the new-branch arm explaining why
  `--remotes` is acceptable there.

---

## What I checked and found GOOD (evidence)

- **Correctness of the three fixes:** rebase-lane binding validation
  (head-name probe, worktree-safe via `--git-path`), merge-lane exclusion
  (`--not refs/remotes/<remote>/<default>`, symref-only offline resolution,
  fail-safe strict), and conditional abort guard all read cleanly and match
  their commit messages. Error message for a mismatched mid-rebase branch
  names both branches correctly (pinned by test: "belongs to branch
  'feature/tracked', not 'feature/other'").
- **Comments explain WHY:** the symref fail-safe ("resolution failure means
  the exclusion is skipped — fail-safe strict"), the `--remotes` security
  rationale, and the empirical AUTO_MERGE discriminator (including why
  "both diffs quiet" would wrongly block an untouched conflict stop) are all
  documented at the point of use. Genuinely good comment hygiene.
- **Shim untouched:** `scripts/lisa-work-item.mjs` has zero commits in this
  range and remains a 5-line delegating entrypoint to the copy-overwrite
  source of truth. Tests import the shim, so they exercise the real wiring.
- **Test quality:** hermetic temp repos (`mkdtempSync` + `afterEach`/`afterAll`
  cleanup), GIT_* environment stripping per the known repo learning
  (`cleanGitEnv` / `stripGitVars`), no `.only`/`.skip` anywhere in the changed
  files. I ran the two changed suites twice back-to-back: 211/211 both times —
  no order dependence observed. Negative controls are complete: wrong-branch
  mid-rebase rejected; no-symref stays strict; branch-authored closed item,
  mixed refs, and missing trailer all still rejected with the exemption
  active; pre-existing detached-HEAD-without-rebase test still pins
  fail-closed. Fixtures drive REAL `git rebase` runs, not simulated state.
- **Guard 3b style:** matches the existing "1b" insertion precedent; RB-* rows
  follow the `gfx()`/`rfx()` builder pattern; RB-B5 pins the `git -C .`
  global-option dodge (same model as GS-B4); RB-A3 (`--continue` allowed) and
  RB-A4 (no rebase in progress) pin the allow side.
- **Fan-out byte-identity:** all five hook copies (base + lisa, agy, copilot,
  cursor) share one SHA-1. Both SKILL.md files are byte-identical across the
  four variant plugins; the Codex `.codex-plugin` copies differ ONLY in the
  frontmatter `description` (the Codex adapter's known truncation) — body
  content including the new prose is identical.
- **Commit hygiene:** three logically separated conventional commits
  (fix/feat/docs); `Work-Item:` trailer is the last line of every message;
  the documented formatter/manifest quirk from commit 1 is genuinely resolved
  at HEAD — `bun run check:upstream-evidence-manifest` exits clean.
- **Counts:** proof command `bunx vitest run
  tests/unit/scripts/lisa-work-item.test.ts tests/unit/hooks/` = **472/472
  passed** (claim verified). Full `bun run test` = 7598/7604 (the 6 failures
  are Finding 1 only; a `check-learnings-budget` failure I saw once was an
  artifact of my invoking vitest via npx instead of `bun run test` and is not
  a branch defect).

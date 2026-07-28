# Research T1 — work-item-sync-lanes (CodySwannGT/lisa#1956)

Researcher: T1 explorer · 2026-07-22 · branch `fix/1956-work-item-sync-lanes` (based on main @ 6a30a6a24, v2.292.0).
Line numbers refer to `all/copy-overwrite/scripts/lisa-work-item.mjs` (1106 lines) unless stated.

## 1. Validator anatomy (all/copy-overwrite/scripts/lisa-work-item.mjs)

### 1a. assertStateBranch — L303–319

- L304: `const branch = currentBranch()` → `currentBranch()` L75-77 = `git branch --show-current` (empty string when HEAD is detached — including mid-rebase).
- L305-308: `if (!branch) throw "Cannot use a work-item binding from detached HEAD"` ← the #1956 throw.
- L309-313: `state.branch === null` → "pending branch attachment; run … attach-branch".
- L314-318: `state.branch !== branch` → "binding belongs to branch <state.branch>, not <branch>".
- Compared state: `state.branch` from the worktree-private state file `.git/lisa/work-item.json` (statePath L71-73 uses `git rev-parse --git-path lisa/work-item.json`, so it is per-worktree) vs live `git branch --show-current`.

Callers (all of them) and ordering vs trailer parsing:

| Caller | Hook | When assertStateBranch runs |
|---|---|---|
| prepareCommitMessage L978-1003 | .husky/prepare-commit-msg (dispatch L1089) | L991 — BEFORE trailer insertion (interpret-trailers L994-1002). Early returns: merge source / release subject L984-988; no state → silent return L989-990. |
| validateCommit L1005-1013 → validateMessage L837-847 | .husky/commit-msg | validateMessage order: merge-in-progress exemption L838-839 (MERGE_HEAD probe L372-378) → release subject L840-841 → trailer parse (exactWorkItem L843, parseTrailers L347-356 via git interpret-trailers) → assertStateMatches L844 → assertStateBranch L826. So the trailer is parsed FIRST but a detached-HEAD binding still throws — matches the issue ("adding the trailer does not help"). |
| validatePush L1015-1030 → validateCommits L853-889 | .husky/pre-push | assertStateMatches at L880, after per-commit trailer parsing (L871) and live validation (L873). |
| assertStateMatches L823-835 | shared | only runs when a state file exists (L825); assertStateBranch at L826. |
| attach-branch (main L1070-1084) | CLI | does NOT call assertStateBranch; uses writeState(..., {requireBranch:true}) L1080 → throw L323-326 when detached. |

Empirical (git 2.53.0, merge backend, verified in /tmp scratch): a CLEAN rebase pick runs prepare-commit-msg (from detached HEAD) but does NOT run commit-msg. So the R1 wedge is: .husky/prepare-commit-msg → `prepare-commit-msg` cmd → readState (binding present) → assertStateBranch throw → hook exit 1 → pick commit refused → rebase stops with the pick staged. validate-commit matters for `git rebase --continue` after a conflict and for manual commits — R1 repro should drive BOTH commands.

Fix-1 shape: when `branch` is empty, probe `git rev-parse --git-path rebase-merge` and `--git-path rebase-apply` (worktree-safe, see §3), read `<dir>/head-name` (= `refs/heads/<branch>`), strip the prefix, validate against that. Keep the detached-HEAD throw when neither dir exists (fail closed).

### 1b. parsePushLines L891-910 + validateCommits L853-889 + commitExemption L380-386

- parsePushLines: pre-push stdin lines `<localref> <localOid> <remoteref> <remoteOid>`; destructured `[, localOid, , remoteOid]` L894; skips zero/empty localOid (ZERO_OID L21).
  Range construction L896-899:
  - remote ref exists: `git rev-list remoteOid..localOid` ← R2 bug: after `git merge origin/main` this range contains foreign main commits.
  - new branch (remoteOid all zeros): `git rev-list localOid --not --remotes=<remote>` ← already excludes foreign commits (why push-as-new-branch works today).
  - empty-stdin fallback L902-908: `git rev-list HEAD --not --remotes=<remote>`.
- commitExemption L380-386: "merge" when `git rev-list --parents -n 1 <sha>` yields more than 2 fields (2+ parents); "release" when subject matches RELEASE_SUBJECT L19-20 (exact `chore(release): x.y.z [skip ci]`). Merge commits skipped in validateCommits L861-864 — but merged-in foreign NON-merge commits are not.
- validateCommits: dedup shas L860, exemptions, exactly-one Work-Item trailer per remaining commit (exactWorkItem L871), mixed-refs rejection L875-878, live validation L873, assertStateMatches L880.

Where the Fix-5 exclusion goes: the args construction at L896-899 (and the L902-908 fallback): append `"--not", "refs/remotes/<remote>/<default>"` to the `remoteOid..localOid` form. Security (T3): exclude ONLY the remote DEFAULT branch — never `--remotes=<remote>` in this lane, because that ref set includes the branch being (force-)updated, which would exempt everything the pusher controls.

Offline-safe default-branch resolution (verified empirically):
- `git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/main` in the lisa repo. It is a LOCAL symref — works offline.
- When unset (fresh `git init` + `update-ref refs/remotes/origin/main` only — exactly the unit-test fixture shape): exit 128 "not a symbolic ref"; `git symbolic-ref -q` exits 1.
- Fail-safe: when unset, SKIP the exclusion (current strict behavior; no weakening, no network). Never shell to `git remote show origin` (network) or gh here. Optional offline fallback: `git rev-parse -q --verify refs/remotes/<remote>/main` then `<remote>/master`.
- Tests can set it: `git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.

### 1c. Test harness — tests/unit/scripts/lisa-work-item.test.ts (731 lines)

- Entrypoint: `SCRIPT = path.resolve("scripts/lisa-work-item.mjs")` (L27) — the 5-line shim; executed via `spawnSync(process.execPath, [SCRIPT, ...args], {cwd: fixture.root, env, input})` in `command()` L74-90 (returns {status, stdout, stderr}).
- gh/acli/curl stubbing — FAKE-BIN pattern (createFixture L93-163): a `fake-bin/` dir inside the temp repo, PREPENDED to PATH (L110), holding `#!/bin/sh` scripts written by `executable()` L60-63. Fake gh (L116-136) switches on `"$1 $2"`: `issue view` → $FAKE_GH_ISSUE_JSON (with a hardcoded issue-43 OPEN payload used by the mixed-refs case), `api graphql` → $FAKE_GH_HIERARCHY_JSON, `pr view` → $FAKE_GH_PR_JSON (exit 1 when FAKE_GH_PR_MISSING=1), `repo view` → acme/code. Optional FAKE_GH_LOG appends argv for invocation-shape assertions. Per-test overrides are passed as `env: { FAKE_GH_ISSUE_JSON: … }` on `command()`.
- Scratch repos: `mkdtempSync(tmpdir() + lisa-work-item-)`; env = `cleanGitEnv(process.env, {...IDENTITY, FAKE_*, GITHUB_REPOSITORY, LINEAR_API_KEY, PATH})` (strips hook-poisoned GIT_* — see project learning); GIT pinned to /usr/bin/git (L28); `git init -q -b main` → write+commit .lisa.config.json → `git switch -c feature/tracked`. Fixture roots pushed to `fixtures[]`, removed in afterEach.
- Push-stdin convention (L377): `refs/heads/feature/tracked <head> refs/heads/feature/tracked <ZERO_OID>\n` piped as `input:`; remote-tracking refs faked with `git update-ref refs/remotes/origin/main <sha>` (L367-371).
- Adding cases: plain `it(...)` in the three describes; write message files under fixture root; assert status 0/1 plus stdout `WORK_ITEM_TRACKING_OK …` or stderr substrings. R1: bind on feature branch, then create a REAL conflicted/mid-rebase state (two commits + conflicting main commit + `git rebase main`, hooks are not installed in fixtures so picks are only wedged when simulated — or `git checkout --detach` plus a hand-written `.git/rebase-merge/{head-name,onto}`; real rebase preferred). R2: commit with a closed-issue trailer on fixture main, merge into bound branch, push line with NON-zero remoteOid, and set the origin/HEAD symref.

## 2. scripts/ vs all/copy-overwrite delta

- `scripts/lisa-work-item.mjs` is a deliberate 5-line SHIM, not a stale copy: `await import("../all/copy-overwrite/scripts/lisa-work-item.mjs")`. Both files were created in the same commit d557349e1 ("feat: require tracked work before durable changes") and the shim never diverged. The relative import resolves against the shim file location, so it always executes the repo copy-overwrite implementation regardless of cwd.
- The unit test executes the shim → therefore the copy-overwrite implementation.
- Lisa repo hooks: .husky/{prepare-commit-msg,commit-msg,pre-push} resolve `WORK_ITEM_SCRIPT="scripts/lisa-work-item.mjs"` and fall back to `all/copy-overwrite/scripts/lisa-work-item.mjs` only if the first is missing. In this repo the shim exists → hooks run shim → copy-overwrite impl. Downstream projects receive the FULL file at scripts/lisa-work-item.mjs via apply (copy-overwrite semantics). Rails wires the same commands through rails/copy-overwrite/lefthook.yml.
- Pinned by tests/unit/hooks/work-item-wiring.test.ts: L31-33 requires the shim to contain the `../all/copy-overwrite/...` import; L34-49 requires all 8 subcommand dispatches in the copy-overwrite file; also pins .husky and typescript/copy-contents/.husky hook text.
- Sanctioned reconciliation (one PR): edit ONLY all/copy-overwrite/scripts/lisa-work-item.mjs (single source of truth); leave the shim untouched. `all/` is an upstream-evidence-manifest root (scripts/generate-upstream-evidence-manifest.mjs L14-15 lists `plugins/src/` and `all/`), so run `bun run build:upstream-evidence-manifest` IN THE SAME COMMIT or CI fails "manifest is stale".

## 3. Rebase state surfaces (verified empirically, git 2.53.0, /tmp scratch repos)

Merge backend (default), conflicted stop — `.git/rebase-merge/` contains: author-script, done, drop_redundant_commits, end, git-rebase-todo, git-rebase-todo.backup, head-name, interactive, message, msgnum, no-reschedule-failed-exec, onto, orig-head, patch, stopped-sha. Top-level `.git/`: AUTO_MERGE, MERGE_MSG, ORIG_HEAD, REBASE_HEAD. head-name = `refs/heads/feature`; onto = sha. `git branch --show-current` = "" (detached). Porcelain `UU f.txt`; `git ls-files -u` = 3 entries.

Clean-pick wedge (prepare-commit-msg exits 1 — the exact #1956 wedge, reproduced): `.git/rebase-merge/` exists but WITHOUT stopped-sha, patch, message. `ls-files -u` = 0; porcelain shows the pick staged (`A  b.txt`); AUTO_MERGE and REBASE_HEAD exist.

Worktree rebase: state lives at `.git/worktrees/<name>/rebase-merge/` (NOT the main .git/); `git rev-parse --git-path rebase-merge` resolves it correctly from inside the worktree. Same file set; head-name = the worktree branch; AUTO_MERGE is a per-worktree ref and resolves there. Always resolve via `git rev-parse --git-path`, never a hardcoded `.git/` path.

Apply backend (`git rebase --apply`): `.git/rebase-apply/` with 0001, 0002, abort-safety, apply-opt, author-script, final-commit, head-name, keep, last, messageid, next, onto, …; conflicts appear as unmerged index entries. (AUTO_MERGE was observed present mid-apply-rebase in a repo with earlier merge-backend activity — do NOT infer the backend from AUTO_MERGE; use the dirs.)

"Conflict resolutions exist" discriminator (verified) — diff worktree/index against the AUTO_MERGE ref (the merge-ort recorded conflicted tree):

| State | git ls-files -u | git diff --quiet AUTO_MERGE | git diff --cached --quiet AUTO_MERGE |
|---|---|---|---|
| conflict stop, untouched | 3 (UU) | rc 0 (worktree == merge-ort output) | n/a |
| resolved, unstaged | 3 | rc 1 | — |
| resolved + git add | 0 | rc 1 | rc 1 |
| clean-pick wedge | 0 | rc 0 | rc 0 |

⇒ abort-safe ⇔ rebase-merge exists AND both diffs vs AUTO_MERGE are quiet (nothing beyond the mechanical state git itself wrote → aborting loses no human/agent work). Non-quiet → resolutions exist → block. Fail closed when: rebase-apply backend, AUTO_MERGE unresolvable, or any probe errors (T3 requirement). Notes: `git rebase --abort` deletes AUTO_MERGE (verified); porcelain alone CANNOT distinguish clean-wedge from resolved-staged (both show staged changes with u=0) — the AUTO_MERGE diff is the discriminating signal.

## 4. Safety-net --abort guard — there is currently NO such guard in the Lisa hook

- plugins/src/base/hooks/parity-safety-net.sh (431 lines) contains NO rebase/merge --abort rule — the Lisa parity hook ALLOWS `git rebase --abort` unconditionally today. Guard map: rm family L180-275, force-push L277-300, reset-dirty L302-313 (the model for a git-state-aware guard: it runs `git status --porcelain` at hook time in the hook cwd), checkout L315-326, switch L328-331, restore L333-342, stash L344-348, clean L350-357, branch force-delete L359-368, tag/reflog/worktree L370-382, find/xargs L384-396, disk L398-410, SQL L412-416, custom rules L418-429. A new abort guard slots naturally after guard 3.
- The block observed in the field comes from the UPSTREAM safety-net@cc-marketplace plugin: REASON_REBASE_ABORT = "git rebase --abort discards rebase conflict resolutions. Use git status first." (cache ~/.claude/plugins/cache/cc-marketplace/safety-net/1b6d3f454003/dist/index.js:2569 and :2825) — unconditional. The lisa repo itself disables that plugin (.claude/settings.json:23 `"safety-net@cc-marketplace": false`) in favor of the lisa@lisa parity hook (registered at plugins/lisa/.claude-plugin/plugin.json:104 → ${CLAUDE_PLUGIN_ROOT}/hooks/parity-safety-net.sh).
- The #1960 guard audit DELIBERATELY skipped absorbing the abort blocks: .lisa/research-1960-guard-audit.md:60-61 rows 15/16 ("blocking it strands agents mid-rebase"). Fix 4 therefore ADDS a conditional guard (block only when the §3 discriminator says resolutions exist), formalizing the allow and closing the lossy case. Red-first framing for R3: the currently-failing fixture is the BLOCK-with-resolutions row; the ALLOW-clean row passes today.
- Fixture rows: none exist for abort yet. Conventions: tests/helpers/safety-net-guard-fixtures.ts — STATELESS_FIXTURES via fx(id, command, verdict, guard) and GIT_STATE_FIXTURES via gfx(id, repo, command, verdict) (currently only clean/dirty repos, rows GS-B1…GS-A6 at L305-317). Driver: tests/unit/hooks/parity-safety-net-guards.test.ts (it.each over fixtures; real hook via tests/helpers/safety-net-guard-harness.ts — HOOK_PATH = plugins/lisa/hooks/parity-safety-net.sh, bash subprocess, PreToolUse JSON on stdin, exit 2 = block / 0 = allow; makeRepo(root, name, dirty) builds repos with GIT_* stripped and GIT_CONFIG_GLOBAL=/dev/null). R3 needs the harness extended with rebase-state repo builders (clean-wedge repo and resolved-conflict repo, built with a real conflicted rebase per §3 recipes) plus a new repo kind in GitStateFixture or a dedicated describe.
- Fanout: plugins/src/base/hooks/parity-safety-net.sh is the SOURCE; `bun run build:plugins` (scripts/build-plugins.sh) fans byte-identical copies to plugins/{lisa,lisa-cursor,lisa-agy,lisa-copilot}/hooks/ (verified identical today); `check:plugins` (scripts/check-plugins-sync.sh) gates drift; plugins/src/ is also a manifest root (§2). There is a parity-safety-net.agy.sh variant — check whether the new guard needs the same edit there (Antigravity parity rule).

## 5. Recently merged on these paths (collision check)

origin/main (today, all already IN v2.292.0 = 6a30a6a24, which this branch is based on — no rebase needed):
- b8bde38b3 / PR #1976 feat/1960-safety-net-guard-parity — commits 29818e25f (rm split gate), 8ab54c7e6 (git global-option + path-prefixed rm bypasses), f02715fa7 (absorb upstream 1.0.6 guards). All touch parity-safety-net.sh + safety-net-guard-fixtures.ts + guards tests. Fix 4 lands on top of these.
- cc87d0d36 test(security) — touched tests/unit/scripts/lisa-work-item.test.ts.
- Last changes to all/copy-overwrite/scripts/lisa-work-item.mjs: 8df8de3b1, d557349e1. Shim: d557349e1 only. No in-flight branches found touching these files.
- Provenance: ledger entry learner-c6b0e3b7de71 carries the upstream-candidate marker for this issue.

## 6. Extra targets the plan needs

- Fix 3-rewritten skill text: plugins/src/base/skills/lisa-implement/SKILL.md:97-98 ("Rebase the feature branch onto `origin/<base>` … BEFORE starting work") — update to document both sync lanes; regenerate fanout via build:plugins (copies under plugins/lisa*/skills and .codex-plugin).
- Hazard for T2 workflow: THIS session runs the lisa parity hook (upstream safety-net disabled), which does not block `git rebase --abort` — scratch-repo abort experiments are safe. But the hook DOES fail-closed on unknown heredocs: write test fixtures with the Write/Edit tools or node/printf, not `cat` heredocs.
- Scratch probes left under /tmp/lisa-1956-rebase-probe/ (repo, repo2-5, wt5) — disposable.

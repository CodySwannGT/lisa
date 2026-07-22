/**
 * Fixture data for the parity-safety-net.sh guard-parity matrix (issue #1960).
 *
 * The tables ARE the contract: every absorbed upstream guard has paired block
 * and near-miss-allow rows (anti-overblocking), and every pre-existing built-in
 * guard has regression rows so nothing relaxes. Source matrix:
 * .lisa/test-matrix-1960.md (task T2).
 * @module tests/helpers/safety-net-guard-fixtures
 */
import type {
  GitStateFixture,
  GuardFixture,
  RebaseRepoKind,
  RebaseStateFixture,
  Verdict,
} from "./safety-net-guard-harness";

/** Replaced at runtime with the temp project dir (for in-project absolute rm). */
export const PROJECT_DIR_TOKEN = "__PROJECT_DIR__";

/** Canonical catastrophic delete used across block fixtures. */
export const RM_RF_ROOT = "rm -rf /";

const BLOCK: Verdict = "block";
const ALLOW: Verdict = "allow";

// Guard identifiers (used in assertion messages and fixture grouping).
const CHECKOUT_DISCARD = "checkout-discard";
const SWITCH_DISCARD = "switch-discard";
const RESTORE_WORKTREE = "restore-worktree";
const STASH_DESTROY = "stash-destroy";
const CLEAN_FORCE = "clean-force";
const BRANCH_FORCE_DELETE = "branch-force-delete";
const TAG_DELETE = "tag-delete";
const REFLOG_DELETE = "reflog-delete";
const WORKTREE_FORCE_REMOVE = "worktree-force-remove";
const RM_HARDENING = "rm-hardening";
const QUOTE_BOUNDARY = "quote-boundary";
const FIND_DELETE = "find-delete";
const FIND_EXEC_RM = "find-exec-rm";
const XARGS_RM = "xargs-rm";
const DISK_DESTROYER = "disk-destroyer";
const RM_ROOT = "rm-root";
const FORCE_PUSH = "force-push";
const SQL = "sql";
const RESET_DIRTY = "reset-dirty";
const REBASE_ABORT = "rebase-abort";

/**
 * Builds a {@link GuardFixture} row.
 * @param id - Matrix row id (e.g. "CO-B1").
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @param guard - Guard identifier the row exercises.
 * @returns The fixture row.
 */
const fx = (
  id: string,
  command: string,
  expected: Verdict,
  guard: string
): GuardFixture => ({ id, command, expected, guard });

/**
 * Builds a {@link GitStateFixture} row for the reset-dirty guard.
 * @param id - Matrix row id (e.g. "GS-B1").
 * @param repo - Which fixture repo the hook runs in.
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @returns The fixture row.
 */
const gfx = (
  id: string,
  repo: "clean" | "dirty",
  command: string,
  expected: Verdict
): GitStateFixture => ({ id, repo, command, expected, guard: RESET_DIRTY });

/** Fixtures whose verdicts do not depend on git working-tree state. */
export const STATELESS_FIXTURES: readonly GuardFixture[] = [
  // A. git checkout discard family (absorb 1)
  fx("CO-B1", "git checkout -- file.ts", BLOCK, CHECKOUT_DISCARD),
  fx("CO-B2", "git checkout main -- src/app.ts", BLOCK, CHECKOUT_DISCARD),
  fx("CO-B3", "git checkout -f main", BLOCK, CHECKOUT_DISCARD),
  fx("CO-B4", "git checkout --force main", BLOCK, CHECKOUT_DISCARD),
  fx(
    "CO-B5",
    "git checkout --pathspec-from-file=list.txt",
    BLOCK,
    CHECKOUT_DISCARD
  ),
  fx("CO-B6", "git checkout .", BLOCK, CHECKOUT_DISCARD),
  fx("CO-A1", "git checkout -b feature", ALLOW, CHECKOUT_DISCARD),
  fx("CO-A2", "git checkout main", ALLOW, CHECKOUT_DISCARD),
  fx("CO-A3", "git checkout -B hotfix", ALLOW, CHECKOUT_DISCARD),
  fx("CO-A4", "git checkout feature-.dotted", ALLOW, CHECKOUT_DISCARD),
  fx("CO-A5", "git log --oneline -- file.ts", ALLOW, CHECKOUT_DISCARD),
  // B. git switch discard (absorb 2)
  fx("SW-B1", "git switch --discard-changes main", BLOCK, SWITCH_DISCARD),
  fx("SW-B2", "git switch -f main", BLOCK, SWITCH_DISCARD),
  fx("SW-B3", "git switch --force main", BLOCK, SWITCH_DISCARD),
  fx("SW-A1", "git switch main", ALLOW, SWITCH_DISCARD),
  fx("SW-A2", "git switch -c new-branch", ALLOW, SWITCH_DISCARD),
  // C. git restore (absorb 3)
  fx("RS-B1", "git restore file.ts", BLOCK, RESTORE_WORKTREE),
  fx("RS-B2", "git restore --worktree file.ts", BLOCK, RESTORE_WORKTREE),
  fx(
    "RS-B3",
    "git restore --staged --worktree file.ts",
    BLOCK,
    RESTORE_WORKTREE
  ),
  fx("RS-B4", "git restore .", BLOCK, RESTORE_WORKTREE),
  fx("RS-A1", "git restore --staged file.ts", ALLOW, RESTORE_WORKTREE),
  fx("RS-A2", "git restore --staged .", ALLOW, RESTORE_WORKTREE),
  // D. git stash drop/clear (absorb 4)
  fx("ST-B1", "git stash drop", BLOCK, STASH_DESTROY),
  fx("ST-B2", "git stash drop 'stash@{0}'", BLOCK, STASH_DESTROY),
  fx("ST-B3", "git stash clear", BLOCK, STASH_DESTROY),
  fx("ST-A1", "git stash push -m wip", ALLOW, STASH_DESTROY),
  fx("ST-A2", "git stash pop", ALLOW, STASH_DESTROY),
  fx("ST-A3", "git stash list", ALLOW, STASH_DESTROY),
  fx("ST-A4", "git stash apply", ALLOW, STASH_DESTROY),
  // E. git clean force (absorb 5)
  fx("CL-B1", "git clean -f", BLOCK, CLEAN_FORCE),
  fx("CL-B2", "git clean -fd", BLOCK, CLEAN_FORCE),
  fx("CL-B3", "git clean -xfd", BLOCK, CLEAN_FORCE),
  fx("CL-B4", "git clean --force", BLOCK, CLEAN_FORCE),
  fx("CL-A1", "git clean -n", ALLOW, CLEAN_FORCE),
  fx("CL-A2", "git clean -nd", ALLOW, CLEAN_FORCE),
  fx("CL-A3", "git clean --dry-run", ALLOW, CLEAN_FORCE),
  fx("CL-A4", "git clean -fdn", ALLOW, CLEAN_FORCE),
  // F. git branch force-delete (absorb 6)
  fx("BR-B1", "git branch -D feature-x", BLOCK, BRANCH_FORCE_DELETE),
  fx("BR-B2", "git branch -df old-branch", BLOCK, BRANCH_FORCE_DELETE),
  fx("BR-B3", "git branch -d -f old-branch", BLOCK, BRANCH_FORCE_DELETE),
  fx("BR-A1", "git branch -d merged-branch", ALLOW, BRANCH_FORCE_DELETE),
  fx("BR-A2", "git branch -m old new", ALLOW, BRANCH_FORCE_DELETE),
  fx("BR-A3", "git branch --delete merged-branch", ALLOW, BRANCH_FORCE_DELETE),
  // G. tag / reflog / worktree (absorb 8)
  fx("TG-B1", "git tag -d v1.0.0", BLOCK, TAG_DELETE),
  fx("TG-B2", "git reflog delete 'HEAD@{1}'", BLOCK, REFLOG_DELETE),
  fx("TG-B3", "git worktree remove --force wt", BLOCK, WORKTREE_FORCE_REMOVE),
  fx("TG-A1", "git tag v1.0.0", ALLOW, TAG_DELETE),
  fx("TG-A2", "git tag -a v1.0.0 -m release", ALLOW, TAG_DELETE),
  fx("TG-A3", "git reflog", ALLOW, REFLOG_DELETE),
  fx("TG-A4", "git reflog expire --expire=now --all", ALLOW, REFLOG_DELETE),
  fx("TG-A5", "git worktree remove wt", ALLOW, WORKTREE_FORCE_REMOVE),
  // H. rm target hardening (absorb 9) — cwd/CLAUDE_PROJECT_DIR = temp project
  fx("RH-B1", "rm -rf .", BLOCK, RM_HARDENING),
  fx("RH-B2", "rm -rf ./", BLOCK, RM_HARDENING),
  fx("RH-B3", "rm -rf ../sibling-project", BLOCK, RM_HARDENING),
  fx("RH-B4", "rm -rf /Users/someone/other-project", BLOCK, RM_HARDENING),
  fx("RH-B5", "rm -rf $DIR", BLOCK, RM_HARDENING),
  fx("RH-A1", "rm -rf build", ALLOW, RM_HARDENING),
  fx("RH-A2", "rm -rf ./build", ALLOW, RM_HARDENING),
  fx("RH-A3", "rm -rf ./node_modules", ALLOW, RM_HARDENING),
  fx("RH-A4", "rm -rf /tmp/scratch-dir", ALLOW, RM_HARDENING),
  fx("RH-A5", 'rm -rf "$TMPDIR/cache"', ALLOW, RM_HARDENING),
  fx("RH-B6", "rm -rf ~/other-project", BLOCK, RM_HARDENING),
  fx("RH-A6", `rm -rf ${PROJECT_DIR_TOKEN}/dist`, ALLOW, RM_HARDENING),
  fx("RH-A7", "rm -rf .cache", ALLOW, RM_HARDENING),
  // I. quote-aware boundaries — verified bypasses (absorb 10 / F1)
  fx("QB-B1", `bash -c "${RM_RF_ROOT}"`, BLOCK, QUOTE_BOUNDARY),
  fx("QB-B2", "sh -c 'rm -rf ~'", BLOCK, QUOTE_BOUNDARY),
  fx(
    "QB-B3",
    `python -c "import os; os.system('${RM_RF_ROOT}')"`,
    BLOCK,
    QUOTE_BOUNDARY
  ),
  fx(
    "QB-B4",
    `node -e "require('child_process').execSync('${RM_RF_ROOT}')"`,
    BLOCK,
    QUOTE_BOUNDARY
  ),
  fx("QB-B5", `perl -e "system('${RM_RF_ROOT}')"`, BLOCK, QUOTE_BOUNDARY),
  fx("QB-B6", 'eval "rm -rf ~"', BLOCK, QUOTE_BOUNDARY),
  fx("QB-A1", 'bash -c "rm -rf build"', ALLOW, QUOTE_BOUNDARY),
  fx("QB-A2", 'python -c "print(1)"', ALLOW, QUOTE_BOUNDARY),
  fx("QB-A3", "python spider.py -c config.yaml", ALLOW, QUOTE_BOUNDARY),
  // I2. git global-option bypasses (security review F1): global options like
  // -C/-c/--git-dir legally sit between `git` and the subcommand, so every
  // subcommand guard must consume them instead of anchoring `git <subcmd>`.
  fx("GO-B1", "git -C /some/path checkout -- file.ts", BLOCK, CHECKOUT_DISCARD),
  fx(
    "GO-B2",
    "git -c core.pager=cat checkout -- file.ts",
    BLOCK,
    CHECKOUT_DISCARD
  ),
  fx(
    "GO-B3",
    "git --git-dir=/x/.git --work-tree=/x checkout -- file.ts",
    BLOCK,
    CHECKOUT_DISCARD
  ),
  fx(
    "GO-B4",
    "git --git-dir /x/.git checkout -- file.ts",
    BLOCK,
    CHECKOUT_DISCARD
  ),
  fx("GO-B5", "git --no-pager checkout -- file.ts", BLOCK, CHECKOUT_DISCARD),
  fx("GO-B6", "git -C /x switch -f main", BLOCK, SWITCH_DISCARD),
  fx("GO-B7", "git -C /x restore file.ts", BLOCK, RESTORE_WORKTREE),
  fx("GO-B8", "git -C /x stash clear", BLOCK, STASH_DESTROY),
  fx("GO-B9", "git -C /repo clean -fd", BLOCK, CLEAN_FORCE),
  fx("GO-B10", "git -C /x branch -D feature", BLOCK, BRANCH_FORCE_DELETE),
  fx("GO-B11", "git -C /repo push --force origin main", BLOCK, FORCE_PUSH),
  fx("GO-B12", "git -C /x tag -d v1.0.0", BLOCK, TAG_DELETE),
  fx("GO-B13", "git -C /x reflog delete 'HEAD@{1}'", BLOCK, REFLOG_DELETE),
  fx(
    "GO-B14",
    "git -C /x worktree remove --force wt",
    BLOCK,
    WORKTREE_FORCE_REMOVE
  ),
  fx("GO-A1", "git -C /p checkout -b feature", ALLOW, CHECKOUT_DISCARD),
  fx("GO-A2", "git -c core.editor=vim commit", ALLOW, CHECKOUT_DISCARD),
  fx("GO-A3", "git -C /p status", ALLOW, CHECKOUT_DISCARD),
  fx(
    "GO-A4",
    "git -C /p push --force-with-lease origin main",
    ALLOW,
    FORCE_PUSH
  ),
  fx("GO-A5", "git -C /p push --force origin feature-x", ALLOW, FORCE_PUSH),
  fx("GO-A6", "git -C /x restore --staged file.ts", ALLOW, RESTORE_WORKTREE),
  // I3. path-prefixed rm bypasses (security review F2): `rm` reached via an
  // absolute or relative path must still trip every rm guard — but ONLY when
  // the basename is exactly `rm` (charm/confirm/rmdir/informant stay allowed).
  fx("PR-B1", `/bin/${RM_RF_ROOT}`, BLOCK, RM_ROOT),
  fx("PR-B2", "/usr/bin/rm -rf ~", BLOCK, RM_ROOT),
  fx("PR-B3", `./${RM_RF_ROOT}`, BLOCK, RM_ROOT),
  fx("PR-B4", `bash -c '/bin/${RM_RF_ROOT}'`, BLOCK, RM_ROOT),
  fx("PR-B5", "/bin/rm -rf /etc", BLOCK, RM_HARDENING),
  fx("PR-B6", "/bin/rm -rf ../other", BLOCK, RM_HARDENING),
  fx("PR-A1", "/bin/rm file.txt", ALLOW, RM_ROOT),
  fx("PR-A2", "/usr/bin/charm x", ALLOW, RM_ROOT),
  fx("PR-A3", "./scripts/confirm -rf /", ALLOW, RM_ROOT),
  fx("PR-A4", "rmdir /tmp/x", ALLOW, RM_ROOT),
  fx("PR-A5", "informant -rf /", ALLOW, RM_ROOT),
  // I4. mixed short/long recursive+force spellings (PR #1976 review): the
  // split-flag gate must pair ANY recursive form with ANY force form, not just
  // short+short / long+long.
  fx("MX-B1", "rm -r --force /", BLOCK, RM_ROOT),
  fx("MX-B2", "rm --recursive -f /", BLOCK, RM_ROOT),
  fx("MX-B3", "rm --recursive -v -f /", BLOCK, RM_ROOT),
  fx("MX-A1", "rm -r --verbose /", ALLOW, RM_ROOT),
  fx("MX-A2", "rm --force -v file.txt", ALLOW, RM_ROOT),
  // J. find / xargs deletion (absorb 11)
  fx("FX-B1", "find . -delete", BLOCK, FIND_DELETE),
  fx("FX-B2", "find . -name '*.tmp' -delete", BLOCK, FIND_DELETE),
  fx("FX-B3", "find . -name x -exec rm -rf {} \\;", BLOCK, FIND_EXEC_RM),
  fx("FX-B4", "xargs rm -rf", BLOCK, XARGS_RM),
  fx("FX-B5", "cat list.txt | xargs rm -rf", BLOCK, XARGS_RM),
  fx("FX-B6", "find /tmp -type d -exec rm -fr {} +", BLOCK, FIND_EXEC_RM),
  fx("FX-A1", "find . -name x -print", ALLOW, FIND_DELETE),
  fx("FX-A2", "find /tmp -name x -exec rm {} +", ALLOW, FIND_EXEC_RM),
  fx("FX-A3", "xargs grep pattern", ALLOW, XARGS_RM),
  fx("FX-A4", "find . -name pre-delete-backup -print", ALLOW, FIND_DELETE),
  fx("FX-A5", "echo a.txt | xargs rm -f", ALLOW, XARGS_RM),
  // K. disk destroyers (absorb 12)
  fx("DD-B1", "dd if=/dev/zero of=/dev/sda", BLOCK, DISK_DESTROYER),
  fx("DD-B2", "mkfs.ext4 /dev/sda1", BLOCK, DISK_DESTROYER),
  fx("DD-B3", "mkfs /dev/sdb", BLOCK, DISK_DESTROYER),
  fx("DD-B4", "shred -u secrets.txt", BLOCK, DISK_DESTROYER),
  fx("DD-A1", "dd if=disk.img of=backup.img", ALLOW, DISK_DESTROYER),
  fx("DD-A2", "dd if=/dev/zero of=./local.img", ALLOW, DISK_DESTROYER),
  fx("DD-A3", "ls shredder/", ALLOW, DISK_DESTROYER),
  fx("DD-A4", "mkfs.ext4 disk.img", ALLOW, DISK_DESTROYER),
  // M1. rm root/home/wildcard regressions (guard 1)
  fx("RG-RM-B1", RM_RF_ROOT, BLOCK, RM_ROOT),
  fx("RG-RM-B2", "rm -rf ~", BLOCK, RM_ROOT),
  fx("RG-RM-B3", "rm -rf $HOME", BLOCK, RM_ROOT),
  fx("RG-RM-B4", "rm -rf ${HOME}", BLOCK, RM_ROOT),
  fx("RG-RM-B5", "rm -rf /*", BLOCK, RM_ROOT),
  fx("RG-RM-B6", "rm -rf *", BLOCK, RM_ROOT),
  fx("RG-RM-B7", "rm -fr ~", BLOCK, RM_ROOT),
  fx("RG-RM-B8", "rm -r -f /", BLOCK, RM_ROOT),
  fx("RG-RM-B9", "rm --recursive --force /", BLOCK, RM_ROOT),
  fx("RG-RM-B10", `sudo ${RM_RF_ROOT}`, BLOCK, RM_ROOT),
  fx("RG-RM-B11", "env FOO=1 rm -rf ~", BLOCK, RM_ROOT),
  fx("RG-RM-A1", "rm -r dir", ALLOW, RM_ROOT),
  fx("RG-RM-A2", "rm -f file.txt", ALLOW, RM_ROOT),
  fx("RG-RM-A3", "rm file.txt", ALLOW, RM_ROOT),
  fx("RG-RM-A4", "rm -rf build && echo done", ALLOW, RM_ROOT),
  // Guard 1 scans per statement, so a harmless `/` in a LATER statement is
  // never attributed to an earlier rm (quality review S1).
  fx("RG-RM-A5", "rm -rf build && cd /", ALLOW, RM_ROOT),
  // M2. force-push regressions (guard 2) — deep coverage stays in the
  // pre-existing parity-safety-net.test.ts suite
  fx("RG-FP-B1", "git push --force origin main", BLOCK, FORCE_PUSH),
  fx("RG-FP-B2", "git push -f origin master", BLOCK, FORCE_PUSH),
  fx("RG-FP-A1", "git push --force-with-lease origin main", ALLOW, FORCE_PUSH),
  fx(
    "RG-FP-A2",
    "git push --force origin feature/experiment",
    ALLOW,
    FORCE_PUSH
  ),
  fx("RG-FP-A3", "git push origin main", ALLOW, FORCE_PUSH),
  // M4. destructive SQL regressions (guard 13)
  fx("RG-SQL-B1", "psql -c 'DROP TABLE users;'", BLOCK, SQL),
  fx("RG-SQL-B2", "mysql -e 'TRUNCATE sessions'", BLOCK, SQL),
  fx("RG-SQL-B3", "echo 'DROP DATABASE prod' | psql", BLOCK, SQL),
  fx("RG-SQL-B4", "psql -c 'DROP SCHEMA public CASCADE'", BLOCK, SQL),
  fx("RG-SQL-B5", "psql -c 'TRUNCATE TABLE audit_log'", BLOCK, SQL),
  fx("RG-SQL-A1", "truncate -s 0 file.log", ALLOW, SQL),
  fx("RG-SQL-A2", "echo drop tables gently", ALLOW, SQL),
  fx("RG-SQL-A3", "git branch -d drop-table-migration", ALLOW, SQL),
];

/** Reset guards asserted in real clean/dirty fixture repos (guard 3 + absorb 7). */
export const GIT_STATE_FIXTURES: readonly GitStateFixture[] = [
  gfx("GS-B1", "dirty", "git reset --hard", BLOCK),
  gfx("GS-B2", "dirty", "git reset --hard HEAD~1", BLOCK),
  gfx("GS-B3", "dirty", "git reset --merge", BLOCK),
  gfx("GS-A1", "clean", "git reset --hard", ALLOW),
  gfx("GS-A2", "clean", "git reset --merge", ALLOW),
  gfx("GS-A3", "dirty", "git reset --soft HEAD~1", ALLOW),
  gfx("GS-A4", "dirty", "git reset --keep", ALLOW),
  gfx("GS-A5", "dirty", "git reset --mixed HEAD", ALLOW),
  // Global options must not dodge the reset guard (security review F1).
  gfx("GS-B4", "dirty", "git -C . reset --hard", BLOCK),
  gfx("GS-A6", "clean", "git -C . reset --hard", ALLOW),
];

/**
 * Builds a {@link RebaseStateFixture} row for the rebase-abort guard.
 * @param id - Matrix row id (e.g. "RB-B1").
 * @param repo - Which mid-rebase fixture repo the hook runs in.
 * @param command - Bash command the hook screens.
 * @param expected - Verdict the hook must produce.
 * @returns The fixture row.
 */
const rfx = (
  id: string,
  repo: RebaseRepoKind,
  command: string,
  expected: Verdict
): RebaseStateFixture => ({ id, repo, command, expected, guard: REBASE_ABORT });

/**
 * `git rebase --abort`/`--quit` guard rows (#1956 Fix 4), asserted in real
 * mid-rebase fixture repos. Block only when aborting would discard human/agent
 * conflict resolutions; fail closed on the apply backend and on an
 * unresolvable AUTO_MERGE ref while rebase-merge state exists.
 */
const REBASE_ABORT_CMD = "git rebase --abort";
const RESOLVED_REPO: RebaseRepoKind = "conflict-resolved";

export const REBASE_STATE_FIXTURES: readonly RebaseStateFixture[] = [
  rfx("RB-B1", RESOLVED_REPO, REBASE_ABORT_CMD, BLOCK),
  rfx("RB-B2", RESOLVED_REPO, "git rebase --quit", BLOCK),
  rfx("RB-B3", "apply-conflict", REBASE_ABORT_CMD, BLOCK),
  rfx("RB-B4", "conflict-missing-automerge", REBASE_ABORT_CMD, BLOCK),
  // Global options must not dodge the abort guard (same model as GS-B4).
  rfx("RB-B5", RESOLVED_REPO, "git -C . rebase --abort", BLOCK),
  rfx("RB-A1", "wedged-clean", REBASE_ABORT_CMD, ALLOW),
  rfx("RB-A2", "conflict-untouched", REBASE_ABORT_CMD, ALLOW),
  rfx("RB-A3", RESOLVED_REPO, "git rebase --continue", ALLOW),
];

/**
 * Pushing through installed carriers in F-mixed, the two-folder repository,
 * and the push carrier as it was written before it told the runner what is
 * being pushed (CodySwannGT/lisa#4989, CodySwannGT/lisa#4988).
 *
 * The suites about the push carrier all need the same repository: F-mixed
 * with one check per folder declared at push, a remote to push to, and a way
 * to see which folder's check was started. They are written once here.
 * @module tests/support/carrier-push
 */
import { type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { operatorGit, stage } from "./carrier-install.js";
import {
  declaredFMixed,
  partsAt,
  RAN,
  type ScopedRepository,
} from "./part-scope-run.js";

/** The two folders of F-mixed that have a part. */
export const API = "api";
export const WEB = "web";

/** A file inside each folder, for a change that touches that folder only. */
export const API_FILE = "api/src/fixture_mixed_api/new_module.py";
export const WEB_FILE = "web/src/new.ts";

/** The line the runner prints for the `web` part when it was left out. */
export const NOT_APPLICABLE_WEB = /NOT APPLICABLE\s+required\s+\S+ in web /u;

/** The line the runner prints for the `api` part when it was left out. */
export const NOT_APPLICABLE_API = /NOT APPLICABLE\s+required\s+\S+ in api /u;

/**
 * The push carrier exactly as `lisa controls install-carriers` wrote it
 * before it handed the pushed refs to the runner. Pinned here, line for
 * line, so the update of an existing install is proved against the real
 * earlier text and not against something derived from today's.
 */
export const PUSH_CARRIER_BEFORE = [
  "#!/bin/sh",
  "# >>> lisa-carrier push",
  '# Runs the checks this repository declares for a push (the "gates"',
  "# block of .lisa.config.json) and stops the push when a required",
  "# check is not proved.",
  '# Written by "lisa controls install-carriers". Run that again to change it.',
  "if ! command -v node >/dev/null 2>&1; then",
  '  echo "Push stopped: Node.js is missing (no \\"node\\" program on PATH), and the checks this repository requires before a push cannot run without it." >&2',
  "  exit 1",
  "fi",
  "if [ ! -f scripts/lisa-run-gates.mjs ]; then",
  '  echo "Push stopped: scripts/lisa-run-gates.mjs is missing, so the checks this repository requires before a push cannot run; run \\"lisa controls install-carriers\\" to put it back." >&2',
  "  exit 1",
  "fi",
  'exec node scripts/lisa-run-gates.mjs --moment=push --builtins=none "$@"',
  "# <<< lisa-carrier push",
  "",
].join("\n");

/** The line that called the push carrier from a host's hook, before. */
export const PUSH_CALL_LINE_BEFORE = 'sh .lisa/hooks/pre-push "$@" || exit $?';

/** The lines added to a host's push hook, before, markers included. */
export const PUSH_CALL_BLOCK_BEFORE = [
  "# >>> lisa-carrier push",
  '# Added by "lisa controls install-carriers". When everything above has',
  "# passed, this runs the checks the repository declares for a push.",
  "lisa_status=$?",
  '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
  PUSH_CALL_LINE_BEFORE,
  "# <<< lisa-carrier push",
].join("\n");

/** F-mixed with a check per folder at push, and a remote to push to. */
export interface PushRepository {
  /** The repository and a folder outside it. */
  readonly scoped: ScopedRepository;
  /** The repository's root. */
  readonly root: string;
  /** The bare repository `origin` names. */
  readonly remote: string;
  /** Remove everything. */
  readonly cleanup: () => void;
}

/**
 * Run git as an operator and require it to succeed.
 * @param root - The repository
 * @param args - Arguments to git
 * @returns What git printed
 */
export function git(root: string, args: readonly string[]): string {
  const child = operatorGit(root, args);
  if (child.status !== 0) {
    throw new Error(
      `git ${args.join(" ")}: ${child.stdout}${child.stderr}`.trim()
    );
  }
  return child.stdout.trim();
}

/**
 * Build F-mixed declaring one check for `api` and one for `web` at push,
 * with an empty remote named `origin`.
 * @returns The repository
 */
export function pushRepository(): PushRepository {
  const scoped = declaredFMixed(
    partsAt("test-correctness", "push", [API, WEB])
  );
  const remote = mkdtempSync(path.join(tmpdir(), "lisa-carrier-remote-"));
  const root = scoped.fixture.repoPath;
  git(remote, ["init", "--quiet", "--bare", "."]);
  git(root, ["remote", "add", "origin", remote]);
  return {
    cleanup: () => {
      scoped.cleanup();
      rmSync(remote, { force: true, recursive: true });
    },
    remote,
    root,
    scoped,
  };
}

/**
 * Change one file and commit it on the branch that is checked out.
 * @param root - The repository
 * @param relative - The file, from the repository root
 */
export function commitChange(root: string, relative: string): void {
  stage(root, relative, "changed\n");
  git(root, ["commit", "--quiet", "-m", `chore: change ${relative}`]);
}

/**
 * Push branches to `origin` the way an operator does, hooks included.
 * @param root - The repository
 * @param branches - The branches to push
 * @returns The finished `git push`; a hook's output is on its two streams
 */
export function push(
  root: string,
  branches: readonly string[]
): SpawnSyncReturns<string> {
  return operatorGit(root, ["push", "origin", ...branches]);
}

/**
 * Everything a finished child printed.
 * @param child - The finished child
 * @returns Both streams, joined
 */
export function said(child: SpawnSyncReturns<string>): string {
  return `${child.stdout}${child.stderr}`;
}

/**
 * The folders whose check was started since the last `forgetRuns`.
 * @param root - The repository
 * @returns `api`, `web`, both or neither
 */
export function startedParts(root: string): string[] {
  return [API, WEB].filter(scope => existsSync(path.join(root, scope, RAN)));
}

/**
 * Remove what the checks left behind, so the next push starts from nothing.
 * @param root - The repository
 */
export function forgetRuns(root: string): void {
  for (const scope of [API, WEB]) {
    rmSync(path.join(root, scope, RAN), { force: true });
  }
}

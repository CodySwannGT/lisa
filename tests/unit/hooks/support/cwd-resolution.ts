/**
 * The harness that drives BOTH cwd-resolving guards over one shared corpus.
 *
 * `parity-safety-net.sh` and `worktree-binding-guard.mjs` answer the same
 * question — "which file will this command actually execute?" — in two
 * languages, and CodySwannGT/lisa#3952 binds them to one written contract
 * rather than to one implementation, because there is no call that reaches from
 * Node into a shell function's file-scope state.
 *
 * Nothing here resolves anything. It plants files, runs each guard, and reports
 * what the guard did. A harness that computed the expected path itself would be
 * the third implementation the ticket exists to avoid.
 *
 * ## How a resolved path is observed, given neither guard returns one
 *
 * By PLANTING. Every candidate directory gets a copy of the same relative
 * script name; exactly one copy gets the body the guard reacts to, and the rest
 * get an inert one. A guard that read the planted copy reacts; a guard that
 * read any other copy does not. Running it once per candidate pins the resolved
 * path from both sides — which is what makes the rows rejection controls rather
 * than assertions that something ran.
 * @module tests/unit/hooks/support/cwd-resolution
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../../support/git-executable.js";

const SHELL_GUARD = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const NODE_GUARD = path.resolve(
  "plugins/src/base/hooks/worktree-binding-guard.mjs"
);

/** The relative name every candidate directory holds a copy of. */
export const SCRIPT = "run.sh";
/** A nested script whose own `cd` must not leak into the outer walk. */
export const NESTED = "nested.sh";

/**
 * The recursive-delete syntax, assembled rather than written out, for the same
 * reason its sibling suites assemble it: spelling it literally would make this
 * file an instance of the class it describes.
 */
const DELETE = `${"r"}${"m"} -${"r"}${"f"}`;
/** A directory no test creates, outside the project and outside every tmp allowance. */
const OUTSIDE = "/Users/probe/outside-the-project/scratch";
/** What the shell guard prints when it cannot say which file would run. */
export const UNCLASSIFIABLE = "cannot classify the file this command executes";
/** What the Node guard prints when an unliteral `cd` left the directory unknown. */
export const UNKNOWN_DIRECTORY = "cannot tell which directory";

export const BLOCKED = 2;
export const ALLOWED = 0;

/** One completed guard run. */
export interface Verdict {
  readonly status: number | null;
  readonly stderr: string;
}

/** The real directories the corpus placeholders name. */
export interface Dirs {
  readonly session: string;
  readonly foreign: string;
  readonly nested: string;
  readonly home: string;
  readonly state: string;
  readonly foreignBase: string;
}

const GIT = resolveGit();
/** Git's quiet flag, named because the fixture repeats it. */
const QUIET = "-q";

/**
 * Directories to remove when the suite ends.
 *
 * This suite builds its fixture ONCE and keeps it for every row, so cleanup is
 * `afterAll`. The sibling harness in `worktree-binding.ts` drains its list
 * `afterEach`, which is right for a suite that rebuilds per case and fatal for
 * one that does not — importing that module would have deleted this fixture
 * after the first row, which is exactly what it did before this was split out.
 */
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
  tempDirs.length = 0;
});

/**
 * Run git in a fixture directory, failing loudly on a non-zero exit.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 */
function git(cwd: string, args: readonly string[]): void {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * A repository with a session worktree, a sibling worktree, a nested directory
 * and a private HOME — one of every directory the corpus can name.
 * @returns The directories the corpus placeholders expand to
 */
export function buildDirs(): Dirs {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-cwd-"));
  const home = mkdtempSync(path.join(tmpdir(), "lisa-cwd-home-"));
  const main = path.join(root, "main");
  const session = path.join(root, "wt-a");
  const foreign = path.join(root, "wt-b");
  const state = path.join(root, "state");
  const nested = path.join(session, "sub");
  const dirs: Dirs = {
    session,
    foreign,
    nested,
    home,
    state,
    foreignBase: path.basename(foreign),
  };

  tempDirs.push(root, home);
  git(root, ["init", QUIET, "main"]);
  git(main, ["config", "user.email", "t@example.invalid"]);
  git(main, ["config", "user.name", "Test"]);
  writeFileSync(path.join(main, "seed.txt"), "seed\n");
  git(main, ["add", "seed.txt"]);
  git(main, ["commit", QUIET, "-m", "seed"]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-a", session]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-b", foreign]);
  mkdirSync(nested, { recursive: true });

  return dirs;
}

/**
 * Every directory a corpus row could resolve into.
 * @param dirs - The fixture directories
 * @returns Absolute candidate directories
 */
export function candidates(dirs: Dirs): readonly string[] {
  return [dirs.session, dirs.foreign, dirs.nested, dirs.home];
}

/**
 * Expand the corpus placeholders in a command.
 * @param command - The row's command text
 * @param dirs - The fixture directories
 * @returns The command with real absolute paths
 */
export function expand(command: string, dirs: Dirs): string {
  return command
    .replaceAll("{session}", dirs.session)
    .replaceAll("{foreign}", dirs.foreign)
    .replaceAll("{nested}", dirs.nested)
    .replaceAll("{foreignBase}", dirs.foreignBase)
    .replaceAll("{home}", dirs.home);
}

/**
 * Expand a row's expected directory to a real path.
 * @param dir - The placeholder the row names
 * @param dirs - The fixture directories
 * @returns The absolute directory
 */
export function expandDir(dir: string, dirs: Dirs): string {
  return expand(dir, dirs);
}

/**
 * Write one script, executable, with a single meaningful line.
 * @param file - Absolute path to write
 * @param body - The one line the script runs
 */
function emit(file: string, body: string): void {
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Put the reactive body in exactly one candidate and an inert body in the rest.
 * @param dirs - The fixture directories
 * @param plantAt - The single directory that gets the reactive body
 * @param body - The line the guard under test reacts to
 */
function plant(dirs: Dirs, plantAt: string, body: string): void {
  for (const dir of candidates(dirs)) {
    emit(path.join(dir, SCRIPT), dir === plantAt ? body : "echo inert");
  }
}

/**
 * Ask the shell guard to classify a command, with the reactive copy planted in
 * one directory.
 * @param command - The expanded command
 * @param dirs - The fixture directories
 * @param plantAt - Directory whose copy holds the destructive line
 * @returns The guard's exit status and refusal text
 */
export function probeShell(
  command: string,
  dirs: Dirs,
  plantAt: string
): Verdict {
  const ask = (): Verdict => {
    const result = boundedSpawnSync({
      label: "parity-safety-net",
      command: "bash",
      args: [SHELL_GUARD],
      cwd: dirs.session,
      env: { ...cleanGitEnv(), HOME: dirs.home },
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: { command },
      }),
    });
    return { status: result.status, stderr: result.stderr };
  };

  plant(dirs, plantAt, `${DELETE} ${OUTSIDE}`);
  // The nested script's own `cd` must not leak into the outer walk, so it is
  // planted with a directory change and nothing else.
  emit(path.join(dirs.session, NESTED), `cd ${dirs.foreign}`);

  return ask();
}

/**
 * Feed one envelope to the Node guard.
 * @param command - The command the session proposes
 * @param dirs - The fixture directories
 * @returns The guard's exit status and refusal text
 */
function runNode(command: string, dirs: Dirs): Verdict {
  const result = boundedSpawnSync({
    label: "worktree-binding-guard",
    command: process.execPath,
    args: [NODE_GUARD],
    cwd: dirs.session,
    env: {
      ...cleanGitEnv(),
      HOME: dirs.home,
      LISA_STATE_HOME: dirs.state,
    },
    input: JSON.stringify({
      session_id: "cwd-corpus",
      cwd: dirs.session,
      tool_name: "Bash",
      tool_input: { command },
    }),
  });
  return { status: result.status, stderr: result.stderr };
}

/**
 * Bind the session to its worktree, the way its first tool call would.
 * @param dirs - The fixture directories
 */
export function bindNode(dirs: Dirs): void {
  runNode("echo hello", dirs);
}

/**
 * Ask the Node guard to classify a command, with the reaching copy planted in
 * one directory.
 *
 * The reactive body here is a path into the sibling worktree, which is what
 * that guard refuses on — a different reaction from the shell guard's, read
 * from the same planted position.
 * @param command - The expanded command
 * @param dirs - The fixture directories
 * @param plantAt - Directory whose copy reaches into the sibling worktree
 * @returns The guard's exit status and refusal text
 */
export function probeNode(
  command: string,
  dirs: Dirs,
  plantAt: string
): Verdict {
  plant(dirs, plantAt, `cd ${dirs.foreign} && echo moved`);
  emit(path.join(dirs.session, NESTED), `cd ${dirs.foreign}`);

  return runNode(command, dirs);
}

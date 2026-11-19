/**
 * Git, as the disposable copy of a repository uses it.
 *
 * Two repositories are in play when commit and push proofs run, and git is
 * started differently for each.
 *
 * The operator's repository is only ever read. {@link sourceGit} removes the
 * variables a hook exports to point git at some other repository, and tells
 * git to skip every optional write: without that, even `git status` rewrites
 * the index when a file's timestamp has moved. The machine's own git settings
 * are kept, because they decide which files the operator's git calls
 * untracked.
 *
 * The copy is built and reset with {@link copyGit}, which is `isolatedGit`
 * from `./proof-patch.ts`: no variable from a hook, no look above the folder
 * for another repository, and none of the machine's git settings. The copy
 * therefore inherits no credential helper, no hook folder and no signing
 * setup from the machine, and behaves the same on every machine.
 *
 * {@link copyCarrierGit} is that same isolated git in the shape the carrier
 * installer asks its questions in, so installing carriers in the copy reads
 * and writes the copy's own settings and nothing else.
 * @module controls/proof-copy-git
 */
import { spawnSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

import { HOOKS_PATH_SETTING, type CarrierGit } from "./carrier-git.js";
import {
  ENV_PROGRAM,
  isolatedGit,
  REPOSITORY_VARIABLES,
} from "./proof-patch.js";

/**
 * How long one git command that builds or resets the copy may take. Cloning
 * and checking out a large repository is the slow case; a check's own time
 * limit is separate and comes from its declaration.
 */
const GIT_BUDGET_MS = 10 * 60_000;

/** The most of git's output that is kept, in bytes. */
const GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

/** The most of git's reason that is quoted, in characters. */
const REASON_LIMIT = 600;

/** How one git command ended. */
export interface GitExit {
  /** The exit code; `null` when git could not be started or was stopped. */
  readonly code: number | null;
  /** What it printed, without the trailing line break. */
  readonly stdout: string;
  /** What it said went wrong. */
  readonly stderr: string;
}

/** Runs one git command in a fixed folder and waits for it. */
export type RunGit = (args: readonly string[]) => GitExit;

/**
 * Build a function that starts git one way, in one folder.
 * @param prefix - The program, then every argument up to and including `git`
 * @param directory - The folder each command is started in
 * @returns The function
 */
function startedWith(prefix: readonly string[], directory: string): RunGit {
  const [program = ENV_PROGRAM, ...before] = prefix;
  return args => {
    const child = spawnSync(program, [...before, ...args], {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: GIT_OUTPUT_BYTES,
      timeout: GIT_BUDGET_MS,
    });
    return child.error === undefined
      ? {
          code: child.status,
          stderr: child.stderr.trim(),
          stdout: child.stdout.replace(/\r?\n$/u, ""),
        }
      : { code: null, stderr: child.error.message, stdout: "" };
  };
}

/**
 * Git for the disposable copy: started in one folder, isolated from the
 * machine and from any repository above that folder.
 * @param directory - Real path of the folder every command is started in
 * @returns Runs one git command there
 */
export function copyGit(directory: string): RunGit {
  return startedWith(isolatedGit(directory), directory);
}

/**
 * Git for the operator's repository: it reads and never writes.
 * @param root - Real path of the repository
 * @returns Runs one read-only git command there
 */
export function sourceGit(root: string): RunGit {
  return startedWith(
    [
      ENV_PROGRAM,
      ...REPOSITORY_VARIABLES.flatMap(name => ["-u", name]),
      "git",
      "--no-optional-locks",
    ],
    root
  );
}

/**
 * Put what git said about a failure on one line, short enough to quote.
 * @param exit - How the command ended
 * @returns Git's reason, or its exit code when it gave none
 */
export function gitSaid(exit: GitExit): string {
  const line = `${exit.stderr} ${exit.stdout}`.trim().replaceAll(/\s+/gu, " ");
  if (line === "") {
    return exit.code === null
      ? "git could not be run"
      : `git exited ${String(exit.code)}`;
  }
  return line.length > REASON_LIMIT ? `${line.slice(0, REASON_LIMIT)}…` : line;
}

/**
 * The isolated git, in the shape the carrier installer asks its questions
 * in.
 *
 * The installer's own git reads the machine's settings, which is right for an
 * operator's checkout and wrong for the copy: a hook folder set for the whole
 * machine would decide who owns hooks there. This one sees only the copy.
 * @returns The questions the installer asks, and the one setting it writes
 */
export function copyCarrierGit(): CarrierGit {
  const answer = (root: string, args: readonly string[]): string => {
    const exit = copyGit(root)(args);
    if (exit.code === 0) return exit.stdout;
    throw new Error(`git ${args.join(" ")} failed: ${gitSaid(exit)}`);
  };
  // Git is run and waited for, so each answer is ready at once; `later` only
  // makes a failure arrive the way the installer expects one, as a rejection.
  const later = <Answer>(work: () => Answer): Promise<Answer> =>
    Promise.resolve().then(work);
  return {
    topLevel: async folder => {
      const exit = copyGit(folder)(["rev-parse", "--show-toplevel"]);
      return exit.code === 0 && exit.stdout !== ""
        ? realpath(exit.stdout)
        : null;
    },
    hooksFolder: root =>
      later(() =>
        path.resolve(root, answer(root, ["rev-parse", "--git-path", "hooks"]))
      ),
    hooksPath: root =>
      later(() => {
        const exit = copyGit(root)(["config", "--get", HOOKS_PATH_SETTING]);
        return exit.code === 0 && exit.stdout !== "" ? exit.stdout : null;
      }),
    isIgnored: (root, relativePath) =>
      later(() => {
        const exit = copyGit(root)([
          "check-ignore",
          "--quiet",
          "--",
          relativePath,
        ]);
        if (exit.code === 0 || exit.code === 1) return exit.code === 0;
        throw new Error(
          `git check-ignore failed for ${relativePath}: ${gitSaid(exit)}`
        );
      }),
    setHooksPath: (root, value) =>
      later(() => {
        answer(root, ["config", "--local", HOOKS_PATH_SETTING, value]);
      }),
  };
}

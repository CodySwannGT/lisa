/**
 * The questions `lisa controls install-carriers` asks git, and the one
 * setting it writes.
 *
 * Where hooks live is git's to say. In a linked worktree or a submodule
 * `.git` is a file, and `core.hooksPath` moves the folder anywhere, so every
 * hook location here comes from git itself and none is worked out from a
 * path.
 *
 * Git is started without a shell and is told on its own command line which
 * repository to answer for: the one whose top folder the operator named.
 * What is written there outranks the variables a hook exports to point git
 * at a repository, so a command run from inside another repository's hook
 * still reads and writes the repository it was pointed at.
 * @module controls/carrier-git
 */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** How long one git command may take. */
const GIT_TIMEOUT_MS = 10_000;

/** The setting that moves git's hooks folder. */
export const HOOKS_PATH_SETTING = "core.hooksPath";

/** What a repository's top folder holds: git's folder, or a file naming it. */
const GIT_ENTRY = ".git";

/** How one git command ended. */
interface GitExit {
  /** The exit code; `null` when git could not be started or was killed. */
  readonly code: number | null;
  /** What it printed, without the trailing line break. */
  readonly stdout: string;
  /** What it said went wrong. */
  readonly stderr: string;
}

/** What the command needs from git, each replaceable in a test. */
export interface CarrierGit {
  /**
   * The top folder of the working tree a folder is the top of.
   * @param folder - A folder
   * @returns Its real path, or `null` when the folder is not the top folder
   *   of a working tree
   */
  readonly topLevel: (folder: string) => Promise<string | null>;
  /**
   * The folder git runs hooks from in this checkout.
   * @param root - The repository
   * @returns Its absolute path
   */
  readonly hooksFolder: (root: string) => Promise<string>;
  /**
   * The value of `core.hooksPath`, wherever it is set.
   * @param root - The repository
   * @returns The value as written, or `null` when it is not set
   */
  readonly hooksPath: (root: string) => Promise<string | null>;
  /**
   * Whether git ignores a path that is not tracked.
   * @param root - The repository
   * @param relativePath - The path, from the repository root
   * @returns Whether an ignore rule covers it
   */
  readonly isIgnored: (root: string, relativePath: string) => Promise<boolean>;
  /**
   * Set `core.hooksPath` in the repository's own configuration. Every
   * working tree of the repository reads that configuration, so the setting
   * is shared by all of them; it is not committed, and not copied to a clone.
   * @param root - The repository
   * @param value - The folder, from the repository root
   */
  readonly setHooksPath: (root: string, value: string) => Promise<void>;
  /**
   * The folder every working tree of the repository shares: git's own
   * folder, where its hooks folder and its configuration are. In a linked
   * working tree it is outside the top folder.
   *
   * Optional, so that a git which only ever sees one working tree (the
   * isolated one a proof copy uses) does not have to answer. Without it a
   * path outside the top folder is named by a neutral description.
   * @param root - The repository
   * @returns Its absolute path
   */
  readonly commonFolder?: (root: string) => Promise<string>;
  /**
   * How many working trees the repository has, this one included. Optional
   * for the same reason; without it the answer is taken to be one.
   * @param root - The repository
   * @returns The count
   */
  readonly workingTrees?: (root: string) => Promise<number>;
}

/**
 * Read a field off whatever a failed command was rejected with.
 * @param failure - The rejection
 * @param field - The field
 * @returns The field's value, or `undefined`
 */
function fieldOf(failure: unknown, field: string): unknown {
  return typeof failure === "object" && failure !== null
    ? (failure as Readonly<Record<string, unknown>>)[field]
    : undefined;
}

/**
 * Open git for the carrier command.
 * @param env - The environment git runs in; the process's own when left out
 * @returns The questions and the one write
 */
export function createCarrierGit(env?: NodeJS.ProcessEnv): CarrierGit {
  const git = async (
    root: string,
    args: readonly string[]
  ): Promise<GitExit> => {
    try {
      const { stdout } = await run(
        "git",
        [
          `--git-dir=${path.join(root, GIT_ENTRY)}`,
          `--work-tree=${root}`,
          ...args,
        ],
        { cwd: root, encoding: "utf8", env, timeout: GIT_TIMEOUT_MS }
      );
      return { code: 0, stderr: "", stdout: stdout.replace(/\r?\n$/u, "") };
    } catch (failure) {
      const code = fieldOf(failure, "code");
      return {
        code: typeof code === "number" ? code : null,
        stderr: String(fieldOf(failure, "stderr") ?? "").trim(),
        stdout: "",
      };
    }
  };
  const answer = async (
    root: string,
    args: readonly string[]
  ): Promise<string> => {
    const exit = await git(root, args);
    if (exit.code === 0) return exit.stdout;
    const detail = exit.stderr === "" ? "git could not be run" : exit.stderr;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  };
  return {
    topLevel: async folder => {
      const exit = await git(folder, ["rev-parse", "--show-toplevel"]);
      return exit.code === 0 && exit.stdout !== ""
        ? realpath(exit.stdout)
        : null;
    },
    hooksFolder: async root =>
      path.resolve(
        root,
        await answer(root, ["rev-parse", "--git-path", "hooks"])
      ),
    hooksPath: async root => {
      const exit = await git(root, ["config", "--get", HOOKS_PATH_SETTING]);
      return exit.code === 0 && exit.stdout !== "" ? exit.stdout : null;
    },
    isIgnored: async (root, relativePath) => {
      const exit = await git(root, [
        "check-ignore",
        "--quiet",
        "--",
        relativePath,
      ]);
      if (exit.code === 0 || exit.code === 1) return exit.code === 0;
      throw new Error(
        `git check-ignore failed for ${relativePath}: ${exit.stderr}`
      );
    },
    setHooksPath: async (root, value) => {
      await answer(root, ["config", "--local", HOOKS_PATH_SETTING, value]);
    },
    commonFolder: async root =>
      path.resolve(root, await answer(root, ["rev-parse", "--git-common-dir"])),
    workingTrees: async root =>
      (await answer(root, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter(line => line.startsWith("worktree ")).length,
  };
}

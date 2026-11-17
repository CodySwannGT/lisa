/**
 * @file resolve-executable.ts
 * @description Resolves a user-installed command name (`git`, `gh`, `claude`,
 * `ps`) to an absolute path, and to the exact file and argv to spawn, before
 * Lisa runs it.
 *
 * Handing a bare name to `spawn`/`execFile` lets the operating system search
 * every `PATH` entry, including relative ones such as `.` or an empty segment,
 * which resolve against the current working directory. Lisa runs inside
 * repositories it does not control, so a relative entry would let a file
 * checked into the repository stand in for the real tool. This resolver walks
 * only the absolute `PATH` directories, in order, and NEVER hands the bare name
 * back: a command no absolute directory holds is reported as not found, with
 * an `ENOENT` error code so every caller's existing "not installed" handling
 * still applies.
 *
 * On Windows it tries the `PATHEXT` extensions and never returns an
 * extensionless file — npm installs a POSIX shell script named `claude` next
 * to `claude.cmd`, and only the latter runs there. A `.cmd`/`.bat` cannot be
 * spawned without a shell since Node's CVE-2024-27980 hardening, so
 * {@link spawnTarget} runs it through an absolute `cmd.exe` with every argument
 * escaped for both cmd parsing passes, instead of `shell: true`.
 * @module utils
 */
import { accessSync, constants, statSync } from "node:fs";
import * as path from "node:path";
import { platform } from "node:process";
import { processEnvironment as env } from "./process-environment.js";

/** Extensions Windows tries when `PATHEXT` is unset. */
const DEFAULT_WINDOWS_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

/** Batch-file extensions, which only `cmd.exe` can run. */
const BATCH_EXTENSION = /\.(?:cmd|bat)$/iu;

/** Characters `cmd.exe` interprets, escaped with `^` (as cross-spawn does). */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/gu;

/** Inputs the resolver reads; injectable so tests state them instead of mutating globals. */
export interface ExecutableSearchContext {
  /** The environment whose `PATH` (and, on Windows, `PATHEXT`) is searched. */
  readonly environment: NodeJS.ProcessEnv;
  /** The platform whose path rules apply. */
  readonly platform: NodeJS.Platform;
}

/** The outcome of a search: the absolute file, or the directories that lacked it. */
export type ExecutableResolution =
  | { readonly found: true; readonly path: string }
  | {
      readonly found: false;
      readonly command: string;
      readonly searched: readonly string[];
    };

/** The exact file, argv and option to spawn a resolved command with. */
export interface SpawnTarget {
  /** Absolute file to spawn. */
  readonly file: string;
  /** Arguments to pass to {@link SpawnTarget.file}. */
  readonly args: readonly string[];
  /** Must be passed through to `spawn`; true only for a batch file via `cmd.exe`. */
  readonly windowsVerbatimArguments: boolean;
}

/** A command no absolute `PATH` directory holds. Carries `code: "ENOENT"`. */
export class ExecutableNotFoundError extends Error {
  /** The errno-style code callers already treat as "not installed". */
  readonly code = "ENOENT";

  /**
   * Creates the error.
   * @param command - The bare command that was searched for
   * @param searched - The absolute directories that were searched
   */
  constructor(
    readonly command: string,
    readonly searched: readonly string[]
  ) {
    super(
      `${command} not found on PATH (absolute directories searched: ${
        searched.length === 0 ? "none" : searched.join(", ")
      })`
    );
    this.name = "ExecutableNotFoundError";
  }
}

const DEFAULT_CONTEXT: ExecutableSearchContext = { environment: env, platform };

/**
 * Reads an environment variable, tolerating Windows' case-insensitive keys.
 * @param environment - Environment to read
 * @param name - Variable name, in upper case
 * @returns The value, or an empty string when unset
 */
function readVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const key = Object.keys(environment).find(
    candidate => candidate.toUpperCase() === name
  );
  return key === undefined ? "" : (environment[key] ?? "");
}

/**
 * Lists the file names to try for a command on the given platform.
 * @param command - Bare command name
 * @param context - Platform and environment to apply
 * @returns Candidate file names, most specific first; never extensionless on Windows
 */
function candidateNames(
  command: string,
  context: ExecutableSearchContext
): readonly string[] {
  if (context.platform !== "win32") return [command];
  const configured = readVariable(context.environment, "PATHEXT");
  const extensions =
    configured === ""
      ? DEFAULT_WINDOWS_EXTENSIONS
      : configured.split(";").filter(extension => extension !== "");
  return extensions.map(extension => `${command}${extension}`);
}

/**
 * Reports whether a path is a regular file this process may execute.
 * @param candidate - Absolute path to test
 * @param context - Platform whose permission model applies
 * @returns True when the path can be spawned
 */
function isExecutableFile(
  candidate: string,
  context: ExecutableSearchContext
): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    // Windows has no execute bit; a PATHEXT match is the test there.
    if (context.platform !== "win32") accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists the absolute directories of the search path, in order.
 * @param context - Environment and platform to read
 * @returns Absolute directories; relative and empty entries are dropped
 */
function absoluteSearchDirectories(
  context: ExecutableSearchContext
): readonly string[] {
  // Delimiter and absoluteness follow the target platform's rules.
  const pathApi = context.platform === "win32" ? path.win32 : path.posix;
  return readVariable(context.environment, "PATH")
    .split(pathApi.delimiter)
    .filter(directory => pathApi.isAbsolute(directory));
}

/**
 * Resolves a bare command name to the absolute path of its first executable
 * match in an absolute `PATH` directory.
 * @param command - Bare command name, such as `git`
 * @param context - Environment and platform to search; defaults to this process
 * @returns The absolute path, or a not-found result naming what was searched
 */
export function resolveExecutable(
  command: string,
  context: ExecutableSearchContext = DEFAULT_CONTEXT
): ExecutableResolution {
  const directories = absoluteSearchDirectories(context);
  const names = candidateNames(command, context);
  // Joined with this host's separator: the result goes to this host's fs.
  const match = directories
    .flatMap(directory => names.map(name => path.join(directory, name)))
    .find(candidate => isExecutableFile(candidate, context));
  return match === undefined
    ? { found: false, command, searched: directories }
    : { found: true, path: match };
}

/**
 * Resolves a command or throws the not-found error callers treat as ENOENT.
 * @param command - Bare command name
 * @param context - Environment and platform to search; defaults to this process
 * @returns The absolute executable path
 * @throws {ExecutableNotFoundError} When no absolute `PATH` directory holds it
 */
export function requireExecutable(
  command: string,
  context: ExecutableSearchContext = DEFAULT_CONTEXT
): string {
  const resolution = resolveExecutable(command, context);
  if (!resolution.found) {
    throw new ExecutableNotFoundError(resolution.command, resolution.searched);
  }
  return resolution.path;
}

/**
 * The inside of an MSVCRT double-quoted argument: a run of backslashes is
 * doubled when a quote or the closing quote follows it, and each quote is
 * escaped. A single linear pass, so no input can make it backtrack.
 * @param argument - One argument, as the caller passed it
 * @returns The quoted form, without the surrounding quotes
 */
function msvcrtQuoteBody(argument: string): string {
  const end = [...argument].reduce(
    (state, character) => {
      if (character === "\\") {
        return { text: state.text, backslashes: state.backslashes + 1 };
      }
      const run =
        character === '"'
          ? `${"\\".repeat(state.backslashes * 2 + 1)}"`
          : `${"\\".repeat(state.backslashes)}${character}`;
      return { text: state.text + run, backslashes: 0 };
    },
    { text: "", backslashes: 0 }
  );
  return end.text + "\\".repeat(end.backslashes * 2);
}

/**
 * Quotes one argument for a `cmd.exe /d /s /c` line that runs a batch file.
 *
 * MSVCRT quoting first (backslashes before a quote and at the end doubled,
 * quotes escaped), then every cmd metacharacter `^`-escaped twice: once for
 * the `/c` line and once for the batch file's own `%*` re-expansion, which is
 * how npm's `.cmd` shims forward arguments. This is cross-spawn's escaping for
 * command shims.
 * @param argument - One argument, as the caller passed it
 * @returns The escaped argument
 */
export function escapeBatchArgument(argument: string): string {
  const quoted = `"${msvcrtQuoteBody(argument)}"`;
  return quoted.replace(CMD_META_CHARS, "^$1").replace(CMD_META_CHARS, "^$1");
}

/**
 * Locates `cmd.exe` as an absolute path, never through `PATH`.
 * @param environment - Environment to read `ComSpec` and `SystemRoot` from
 * @returns Absolute path of the command interpreter
 */
function commandInterpreter(environment: NodeJS.ProcessEnv): string {
  const comspec = readVariable(environment, "COMSPEC");
  if (path.win32.isAbsolute(comspec)) return comspec;
  const systemRoot = readVariable(environment, "SYSTEMROOT") || "C:\\Windows";
  return path.win32.join(systemRoot, "System32", "cmd.exe");
}

/**
 * Resolves a command and builds exactly what to spawn for it, without a shell
 * except where Windows requires one for a batch file.
 * @param command - Bare command name, such as `claude`
 * @param args - Arguments for the command
 * @param context - Environment and platform to search; defaults to this process
 * @returns The file, argv and `windowsVerbatimArguments` to pass to `spawn`
 * @throws {ExecutableNotFoundError} When no absolute `PATH` directory holds it
 */
export function spawnTarget(
  command: string,
  args: readonly string[],
  context: ExecutableSearchContext = DEFAULT_CONTEXT
): SpawnTarget {
  const file = requireExecutable(command, context);
  if (context.platform !== "win32" || !BATCH_EXTENSION.test(file)) {
    return { file, args, windowsVerbatimArguments: false };
  }
  const line = [
    path.win32.normalize(file).replace(CMD_META_CHARS, "^$1"),
    ...args.map(argument => escapeBatchArgument(argument)),
  ].join(" ");
  return {
    file: commandInterpreter(context.environment),
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

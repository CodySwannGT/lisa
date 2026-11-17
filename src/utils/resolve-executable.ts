/**
 * @file resolve-executable.ts
 * @description Resolves a user-installed command name (`git`, `gh`, `claude`,
 * `ps`) to an absolute path before Lisa spawns it.
 *
 * Handing a bare name to `spawn`/`execFile` lets the operating system search
 * every `PATH` entry, including relative ones such as `.` or an empty segment,
 * which resolve against the current working directory. Lisa runs inside
 * repositories it does not control, so a relative entry would let a file
 * checked into the repository shadow the real tool. This resolver walks only
 * the absolute `PATH` directories, in order, and returns the first executable
 * match as an absolute path.
 *
 * When no absolute directory holds the command the bare name is returned
 * unchanged, so the spawn fails (or succeeds) exactly as it did before and
 * every caller's existing "tool not installed" handling still applies.
 * @module utils
 */
import { accessSync, constants, statSync } from "node:fs";
import * as path from "node:path";
import { env, platform } from "node:process";

/** Extensions Windows tries when `PATHEXT` is unset. */
const DEFAULT_WINDOWS_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"];

/** Inputs the resolver reads; injectable so tests state them instead of mutating globals. */
export interface ExecutableSearchContext {
  /** The environment whose `PATH` (and, on Windows, `PATHEXT`) is searched. */
  readonly environment: NodeJS.ProcessEnv;
  /** The platform whose path rules apply. */
  readonly platform: NodeJS.Platform;
}

const DEFAULT_CONTEXT: ExecutableSearchContext = { environment: env, platform };

/**
 * Reads the search path, tolerating Windows' case-insensitive `Path` key.
 * @param environment - Environment to read
 * @returns The raw search path, or an empty string when none is set
 */
function readSearchPath(environment: NodeJS.ProcessEnv): string {
  const key = Object.keys(environment).find(
    name => name.toUpperCase() === "PATH"
  );
  return key === undefined ? "" : (environment[key] ?? "");
}

/**
 * Lists the file names to try for a command on the given platform.
 * @param command - Bare command name
 * @param context - Platform and environment to apply
 * @returns Candidate file names, most specific first
 */
function candidateNames(
  command: string,
  context: ExecutableSearchContext
): readonly string[] {
  if (context.platform !== "win32") return [command];
  const configured = context.environment.PATHEXT;
  const extensions =
    configured === undefined || configured === ""
      ? DEFAULT_WINDOWS_EXTENSIONS
      : configured.split(";").filter(extension => extension !== "");
  return [command, ...extensions.map(extension => `${command}${extension}`)];
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
    // Windows has no execute bit; existence of a PATHEXT match is the test.
    if (context.platform !== "win32") accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a command name to the absolute path of its first executable match
 * in an absolute `PATH` directory.
 * @param command - Bare command name, such as `git`
 * @param context - Environment and platform to search; defaults to this process
 * @returns The absolute executable path, or `command` unchanged when it already
 * contains a path separator or no absolute `PATH` directory holds it
 */
export function resolveExecutable(
  command: string,
  context: ExecutableSearchContext = DEFAULT_CONTEXT
): string {
  if (command.includes("/") || command.includes("\\")) return command;
  // Delimiter and absoluteness follow the target platform's rules; joining
  // uses this host's separator because the result is handed to this host's fs.
  const pathApi = context.platform === "win32" ? path.win32 : path.posix;
  const directories = readSearchPath(context.environment)
    .split(pathApi.delimiter)
    .filter(directory => pathApi.isAbsolute(directory));
  const names = candidateNames(command, context);
  const match = directories
    .flatMap(directory => names.map(name => path.join(directory, name)))
    .find(candidate => isExecutableFile(candidate, context));
  return match ?? command;
}

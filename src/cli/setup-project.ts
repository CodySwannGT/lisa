import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { type CLIOptions } from "./shared-options.js";
import { isSetupType, resolveStarter, SETUP_TYPES } from "./starters.js";

/**
 * Parsed options for the setup-project command.
 */
export interface SetupProjectOptions extends CLIOptions {
  type?: string;
}

/**
 * Injectable collaborators for setup-project.
 */
export interface SetupProjectDependencies {
  runApply: (
    destination: string | undefined,
    options: CLIOptions
  ) => Promise<void>;
  runCommand: (
    command: string,
    args: readonly string[],
    options?: { cwd?: string }
  ) => Promise<void>;
}

/**
 * Remove setup-project-only fields from the options forwarded to apply.
 * @param options - Parsed setup-project options
 * @returns Shared apply options without undefined optional properties
 */
function toCliOptions(options: SetupProjectOptions): CLIOptions {
  return {
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.yes !== undefined ? { yes: options.yes } : {}),
    ...(options.validate !== undefined ? { validate: options.validate } : {}),
    ...(options.skipGitCheck !== undefined
      ? { skipGitCheck: options.skipGitCheck }
      : {}),
    ...(options.harness !== undefined ? { harness: options.harness } : {}),
  };
}

export const DEFAULT_SETUP_PROJECT_DEPENDENCIES: SetupProjectDependencies = {
  runApply: async () => {
    throw new Error("runApply dependency was not configured");
  },
  runCommand,
};

/**
 * Run a command as a child process and reject on non-zero exit.
 * @param command - Executable name
 * @param args - Command arguments
 * @param options - Spawn options
 * @param options.cwd - Optional working directory for the command
 * @returns Promise that resolves when the command exits successfully
 */
async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited ${code ?? 1}`));
    });
  });
}

/**
 * Check whether a destination exists and contains files.
 * @param destination - Project destination path
 * @returns True when the destination directory is non-empty
 */
async function directoryIsNonEmpty(destination: string): Promise<boolean> {
  if (!existsSync(destination)) {
    return false;
  }
  return (await readdir(destination)).length > 0;
}

/**
 * Detect whether the GitHub CLI is authenticated.
 * @param deps - Injectable setup-project dependencies
 * @returns True when `gh auth status` succeeds
 */
async function ghIsAuthenticated(
  deps: SetupProjectDependencies
): Promise<boolean> {
  try {
    await deps.runCommand("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone or create the starter project for a setup type.
 * @param type - Lisa setup type
 * @param destination - Project destination path
 * @param deps - Injectable setup-project dependencies
 * @returns Promise that resolves after the starter is available locally
 */
async function cloneStarter(
  type: string,
  destination: string,
  deps: SetupProjectDependencies
): Promise<void> {
  if (!isSetupType(type)) {
    throw new Error(
      `Unknown setup type ${JSON.stringify(type)}. Valid types: ${SETUP_TYPES.join(", ")}`
    );
  }

  const starter = resolveStarter(type);
  const parentDir = path.dirname(destination);
  const projectName = path.basename(destination);
  const starterRef = `${starter.owner}/${starter.repo}`;

  if (await ghIsAuthenticated(deps)) {
    await deps.runCommand(
      "gh",
      [
        "repo",
        "create",
        projectName,
        "--template",
        starterRef,
        "--public",
        "--clone",
      ],
      { cwd: parentDir }
    );
    return;
  }

  await deps.runCommand("git", [
    "clone",
    "--depth=1",
    `https://github.com/${starterRef}.git`,
    destination,
  ]);
  await rm(path.join(destination, ".git"), { recursive: true, force: true });
  await deps.runCommand("git", ["init", "-b", "main"], { cwd: destination });
  await deps.runCommand("git", ["add", "--all"], { cwd: destination });
  await deps.runCommand(
    "git",
    [
      "-c",
      "user.name=Lisa",
      "-c",
      "user.email=lisa@localhost",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "-m",
      "Initial starter baseline",
    ],
    { cwd: destination }
  );
}

/**
 * Create a Lisa-managed project from a starter and then apply overlays.
 * @param destination - Optional project name or path
 * @param options - Parsed setup-project options
 * @param dependencies - Injectable collaborators
 * @returns Promise that resolves after setup and apply complete
 */
export async function runSetupProject(
  destination: string | undefined,
  options: SetupProjectOptions,
  dependencies: SetupProjectDependencies = DEFAULT_SETUP_PROJECT_DEPENDENCIES
): Promise<void> {
  if (!options.type) {
    throw new Error(
      `Missing required --type. Valid types: ${SETUP_TYPES.join(", ")}`
    );
  }
  if (!isSetupType(options.type)) {
    throw new Error(
      `Unknown setup type ${JSON.stringify(options.type)}. Valid types: ${SETUP_TYPES.join(", ")}`
    );
  }

  const resolvedDestination = path.resolve(
    destination ?? `./${options.type}-app`
  );

  if (!(await directoryIsNonEmpty(resolvedDestination))) {
    if (options.dryRun || options.validate) {
      console.log(
        `Would create ${resolvedDestination} from ${resolveStarter(options.type).owner}/${resolveStarter(options.type).repo}`
      );
    } else {
      await cloneStarter(options.type, resolvedDestination, dependencies);
    }
  }

  await dependencies.runApply(resolvedDestination, toCliOptions(options));
}

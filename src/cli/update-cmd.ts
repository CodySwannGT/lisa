import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

const LISA_PACKAGE = "@codyswann/lisa";

/** Options parsed for `lisa update`. */
export interface UpdateCommandOptions {
  yes?: boolean;
}

/** Runtime collaborators for the update command. */
export interface UpdateCommandDependencies {
  /** Current working directory. */
  cwd: string;
  /** Environment map used for package-manager detection. */
  env: NodeJS.ProcessEnv;
  /** Spawn implementation used when --yes is passed. */
  spawn: typeof spawn;
  /** Write user-facing output. */
  write: (message: string) => void;
}

const DEFAULT_DEPENDENCIES: UpdateCommandDependencies = {
  cwd: process.cwd(),
  env: getProcessEnv(),
  spawn,
  write: message => console.log(message),
};

/**
 * Read process.env through one explicit, reviewable exception to the app-template
 * env rule. The CLI needs externally supplied package-manager metadata.
 * @returns Current process environment
 */
function getProcessEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-restricted-syntax -- CLI package-manager detection must read externally supplied process env once
  return process.env;
}

/**
 * Detect the preferred package manager from the user agent or lockfiles.
 * @param deps - Runtime dependencies
 * @returns Package manager command
 */
export function detectPackageManager(
  deps: Pick<UpdateCommandDependencies, "cwd" | "env">
): "npm" | "pnpm" | "yarn" | "bun" {
  const userAgent = deps.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) {
    return "pnpm";
  }
  if (userAgent.startsWith("yarn")) {
    return "yarn";
  }
  if (userAgent.startsWith("bun")) {
    return "bun";
  }
  if (userAgent.startsWith("npm")) {
    return "npm";
  }

  if (
    existsSync(path.join(deps.cwd, "bun.lock")) ||
    existsSync(path.join(deps.cwd, "bun.lockb"))
  ) {
    return "bun";
  }
  if (existsSync(path.join(deps.cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(deps.cwd, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

/**
 * Compose the project-local Lisa dependency update command for a package manager.
 * @param packageManager - Detected package manager
 * @returns Command and arguments ready for spawn
 */
export function getUpdateCommand(packageManager: string): {
  command: string;
  args: string[];
} {
  switch (packageManager) {
    case "bun":
      return { command: "bun", args: ["update", LISA_PACKAGE] };
    case "pnpm":
      return {
        command: "pnpm",
        args: ["update", LISA_PACKAGE],
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["up", LISA_PACKAGE],
      };
    default:
      return {
        command: "npm",
        args: ["update", LISA_PACKAGE],
      };
  }
}

/**
 * Execute a child command and resolve to its exit code.
 * @param deps - Runtime dependencies
 * @param command - Executable name
 * @param args - Command arguments
 * @returns Child process exit code
 */
async function runSpawn(
  deps: UpdateCommandDependencies,
  command: string,
  args: readonly string[]
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = deps.spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
}

/**
 * Run `lisa update`.
 * @param options - Parsed command options
 * @param dependencies - Optional collaborators for tests
 * @returns Child exit code when --yes runs, otherwise 0
 */
export async function runUpdate(
  options: UpdateCommandOptions,
  dependencies: Partial<UpdateCommandDependencies> = {}
): Promise<number> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const updateCommand = getUpdateCommand(detectPackageManager(deps));
  deps.write([updateCommand.command, ...updateCommand.args].join(" "));

  if (!options.yes) {
    return 0;
  }

  return await runSpawn(deps, updateCommand.command, updateCommand.args);
}

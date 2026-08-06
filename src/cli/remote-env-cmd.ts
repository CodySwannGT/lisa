/**
 * CLI entry point for the remote-environment runner.
 *
 * `lisa workstation` prepares the machine — tools and a credential-manager CLI.
 * It stops there, and a session also needs the credentials themselves: the
 * materialized env file, the shell profile that loads it, and the per-environment
 * AWS profiles.
 *
 * In a repository that work is reached through `scripts/lisa-remote-env/setup.sh`.
 * A session with NO checkout has no such script, and that is an ordinary state:
 * a Claude Tag channel session runs as the organization, and a repository does
 * not enter the session until a request names one.
 *
 * So the runner needs a way in that presumes no checkout, for the same reason
 * the workstation bootstrap does:
 *
 *     npx -y `@codyswann/lisa@latest` remote-env --phase=secrets
 *
 * Without this the no-checkout setup path called a subcommand that did not
 * exist. The call was guarded with `|| true` so the failure was silent, and the
 * session came up with a bootstrap token and nothing able to use it.
 * @module cli/remote-env-cmd
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { getCliInstallPath } from "./version-cmd.js";
import { flagsAfterCommand } from "./workstation-cmd.js";

/** Where the runner sits inside the published package. */
const SCRIPT_RELATIVE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-setup-remote-env",
  "scripts",
  "setup-remote-env.mjs"
);

/** Injectable seams so the command is testable without provisioning anything. */
export interface RemoteEnvDeps {
  /** Resolve the installed package root. */
  readonly installPath?: () => string;
  /** Run the script. */
  readonly run?: (command: string, args: string[]) => { status: number | null };
  /** Report a problem. */
  readonly error?: (message: string) => void;
}

/**
 * Locate the runner inside the installed package.
 *
 * Resolved from the module's own location rather than the working directory,
 * because under npx the cwd is wherever the operator is standing and is often
 * not a project at all — which is the whole point of this command.
 * @param installPath Package root resolver.
 * @returns Absolute path to the runner.
 * @throws {Error} When the package is incomplete.
 */
export function resolveRemoteEnvScript(
  installPath: () => string = getCliInstallPath
): string {
  const script = path.join(installPath(), SCRIPT_RELATIVE);
  if (!existsSync(script)) {
    throw new Error(
      `remote-env runner not found at ${script}.\n` +
        `The installed @codyswann/lisa looks incomplete; reinstall it.`
    );
  }
  return script;
}

/**
 * Run the remote-environment runner with the given flags.
 * @param flags Flags forwarded verbatim to the runner.
 * @param deps Injectable seams.
 * @returns The runner's exit code.
 */
export function runRemoteEnv(
  flags: readonly string[] = [],
  deps: RemoteEnvDeps = {}
): number {
  const {
    installPath = getCliInstallPath,
    run = (command: string, args: string[]) =>
      spawnSync(command, args, { stdio: "inherit" }),
    error = (message: string) => console.error(message),
  } = deps;

  try {
    const script = resolveRemoteEnvScript(installPath);
    // process.execPath rather than "node": under npx the runner must be
    // executed by the same interpreter already running, not whichever node a
    // PATH lookup happens to find first.
    return run(process.execPath, [script, ...flags]).status ?? 1;
  } catch (err) {
    error((err as Error).message);
    return 1;
  }
}

/**
 * Register `lisa remote-env`.
 * @param program Commander program to mutate.
 * @param deps Program dependencies.
 * @param deps.runRemoteEnv Runs the runner and returns its exit code.
 */
export function addRemoteEnvCommand(
  program: Command,
  deps: { readonly runRemoteEnv: (flags: readonly string[]) => number } = {
    runRemoteEnv,
  }
): void {
  program
    .command("remote-env")
    .description(
      "Prepare a remote session's tools and credentials. Needs no checkout: " +
        "run it with 'npx -y @codyswann/lisa@latest remote-env " +
        "--phase=secrets' in a session that has no repository attached."
    )
    // The flags belong to the runner, not to commander; re-declaring them here
    // would give the CLI and the skill two vocabularies to keep in step.
    .allowUnknownOption(true)
    .argument("[flags...]", "flags forwarded to the runner")
    .action(() => {
      const code = deps.runRemoteEnv(
        flagsAfterCommand(process.argv, "remote-env")
      );
      if (code !== 0) {
        process.exitCode = code;
      }
    });
}

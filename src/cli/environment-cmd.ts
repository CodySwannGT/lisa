/**
 * CLI entry point for `lisa environment <surface>`.
 *
 * One verb, one axis — which surface — and the only difference between them is
 * whether Lisa can execute there or has to hand an operator text to paste.
 *
 * It replaces `remote-env --emit=<surface>`, whose name described the machinery
 * rather than the task. From a laptop, `remote-env` reads as "prepare the
 * remote environment I am currently in", which is the opposite of what an
 * operator configuring a cloud environment is doing. The old spelling still
 * works, so nothing in flight breaks.
 * @module cli/environment-cmd
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { flagsAfterCommand } from "./workstation-cmd.js";
import { getCliInstallPath } from "./version-cmd.js";

/** Where the runner sits inside the published package. */
const SCRIPT_RELATIVE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-setup-remote-env",
  "scripts",
  "environment.mjs"
);

/** Injectable seams so the command is testable without provisioning anything. */
export interface EnvironmentDeps {
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
 * Resolved from the module's own location rather than the working directory:
 * this command's whole point is that it works without a checkout, so the cwd is
 * frequently not a project at all.
 * @param installPath Package root resolver.
 * @returns Absolute path to the runner.
 * @throws {Error} When the package is incomplete.
 */
export function resolveEnvironmentScript(
  installPath: () => string = getCliInstallPath
): string {
  const script = path.join(installPath(), SCRIPT_RELATIVE);
  if (!existsSync(script)) {
    throw new Error(
      `environment runner not found at ${script}.\n` +
        `The installed @codyswann/lisa looks incomplete; reinstall it.`
    );
  }
  return script;
}

/**
 * Run the environment runner with the given arguments.
 * @param args Surface and flags, forwarded verbatim.
 * @param deps Injectable seams.
 * @returns The runner's exit code.
 */
export function runEnvironment(
  args: readonly string[] = [],
  deps: EnvironmentDeps = {}
): number {
  const {
    installPath = getCliInstallPath,
    run = (command: string, spawnArgs: string[]) =>
      spawnSync(command, spawnArgs, { stdio: "inherit" }),
    error = (message: string) => process.stderr.write(`${message}\n`),
  } = deps;

  try {
    const script = resolveEnvironmentScript(installPath);
    // process.execPath rather than "node": under npx the runner must be run by
    // the interpreter already running, not whichever node a PATH lookup finds.
    return run(process.execPath, [script, ...args]).status ?? 1;
  } catch (err) {
    error((err as Error).message);
    return 1;
  }
}

/**
 * Register `lisa environment`.
 * @param program Commander program to mutate.
 * @param deps Program dependencies.
 * @param deps.runEnvironment Runs the runner and returns its exit code.
 */
export function addEnvironmentCommand(
  program: Command,
  deps: { readonly runEnvironment: (args: readonly string[]) => number } = {
    runEnvironment,
  }
): void {
  program
    .command("environment")
    .description(
      "Configure one surface for one tenant: 'local' prepares this machine, " +
        "'container', 'claude-web' and 'codex-cloud' print what to paste. " +
        "Needs no checkout: " +
        "'npx -y @codyswann/lisa@latest environment local --tenant=<name>'."
    )
    // The arguments belong to the runner, not to commander. Re-declaring them
    // would give the CLI and the skill two vocabularies to keep in step.
    .allowUnknownOption(true)
    .argument("[args...]", "surface and flags forwarded to the runner")
    .action(() => {
      const code = deps.runEnvironment(
        flagsAfterCommand(process.argv, "environment")
      );
      if (code !== 0) {
        process.exitCode = code;
      }
    });
}

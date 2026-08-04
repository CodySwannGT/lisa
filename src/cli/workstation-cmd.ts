/**
 * CLI entry point for the workstation bootstrap.
 *
 * `lisa-setup-workstation` exists to prepare a machine that has no coding agent
 * and no checkout. As a skill it could only be reached by typing a slash command
 * into an agent — and Lisa ships as a devDependency, so it does not exist until
 * a repo is cloned and its dependencies installed.
 *
 * Both of those are precisely the state the skill is supposed to CREATE. The
 * bootstrap was unreachable in the one scenario it was designed for.
 *
 * This is the way in that presumes nothing:
 *
 *     npx -y `@codyswann/lisa@latest` workstation --install --provider=bitwarden
 *
 * npx resolves the package into its own cache, so no repository is involved and
 * no agent has to exist yet. The skill stays as the surface for people who
 * already have an agent; this is for people who do not.
 * @module cli/workstation-cmd
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { getCliInstallPath } from "./version-cmd.js";

/**
 * The only dependency this command needs, structurally.
 *
 * Declared here rather than importing `ProgramDependencies` from the program
 * module, which imports this one — a cycle for the sake of a single field.
 */
interface WorkstationCommandDeps {
  /** Runs the bootstrap and returns its exit code. */
  readonly runWorkstation: (flags: readonly string[]) => number;
}

/**
 * Register `lisa workstation`.
 *
 * Kept out of the program module so registering it does not push that file past
 * its size limits — the same reason `addGateCommands` lives beside its own
 * command rather than in the middle of the program.
 * @param program Commander program to mutate.
 * @param deps Program dependencies.
 */
export function addWorkstationCommand(
  program: Command,
  deps: WorkstationCommandDeps = { runWorkstation }
): void {
  program
    .command("workstation")
    .description(
      "Prepare this machine to run coding agents — before any repo exists. " +
        "Detects installed agents, asks which credential manager to use, and " +
        "installs what is missing. Needs no checkout and no agent: run it with " +
        "'npx -y @codyswann/lisa@latest workstation --install'."
    )
    // Flags belong to the bootstrap script, not to commander. Re-declaring them
    // here would give the CLI and the skill two vocabularies to keep in step.
    //
    // Read straight off argv rather than via passThroughOptions, which
    // commander only permits once the PARENT enables positional options — a
    // global parsing change affecting every other command, to serve one.
    .allowUnknownOption(true)
    .argument("[flags...]", "flags forwarded to the bootstrap")
    .action(() => {
      const code = deps.runWorkstation(flagsAfterCommand(process.argv));
      if (code !== 0) {
        process.exitCode = code;
      }
    });
}

/**
 * Everything the operator typed after the subcommand name.
 *
 * Taken from argv because the flags are the bootstrap script's vocabulary, not
 * commander's, and forwarding them verbatim is what keeps the CLI and the skill
 * from drifting into two dialects.
 *
 * Searched from index 2 so a project path that happens to be named
 * `workstation` cannot be mistaken for the subcommand.
 * @param argv Full process argv.
 * @param name Subcommand name.
 * @returns Forwarded flags, empty when the subcommand is absent.
 */
export function flagsAfterCommand(
  argv: readonly string[],
  name = "workstation"
): string[] {
  const at = argv.indexOf(name, 2);
  return at === -1 ? [] : argv.slice(at + 1);
}

/** Where the bootstrap script sits inside the published package. */
const SCRIPT_RELATIVE = path.join(
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-setup-workstation",
  "scripts",
  "cli.mjs"
);

/** Injectable seams so the command is testable without provisioning anything. */
export interface WorkstationDeps {
  /** Resolve the installed package root. */
  readonly installPath?: () => string;
  /** Run the script. */
  readonly run?: (command: string, args: string[]) => { status: number | null };
  /** Report a problem. */
  readonly error?: (message: string) => void;
}

/**
 * Locate the bootstrap script inside the installed package.
 *
 * Resolved from the MODULE's own location rather than the working directory:
 * under npx the cwd is wherever the operator happens to be standing, and is
 * frequently not a project at all — which is the entire point of this command.
 * @param installPath Package root.
 * @returns Absolute path to the script.
 * @throws {Error} When the package is incomplete.
 */
export function resolveWorkstationScript(
  installPath: string = getCliInstallPath()
): string {
  const script = path.join(installPath, SCRIPT_RELATIVE);
  if (!existsSync(script)) {
    throw new Error(
      `cannot find the workstation script at ${script}.\n` +
        `This means the installed Lisa package is incomplete — reinstall, or ` +
        `run a newer version with 'npx -y @codyswann/lisa@latest workstation'.`
    );
  }
  return script;
}

/**
 * Run the workstation bootstrap, passing every flag through untouched.
 *
 * Flags are forwarded rather than re-declared. Restating `--install`,
 * `--agents`, `--provider` and the rest here would give the CLI and the skill
 * two vocabularies to keep in step, and the one nobody runs is the one that
 * drifts.
 * @param flags Arguments for the script.
 * @param deps Injected seams.
 * @returns Process exit code.
 */
export function runWorkstation(
  flags: readonly string[] = [],
  deps: WorkstationDeps = {}
): number {
  const report =
    deps.error ?? ((message: string) => process.stderr.write(message));

  const located = ((): string | null => {
    try {
      return resolveWorkstationScript(
        (deps.installPath ?? getCliInstallPath)()
      );
    } catch (error) {
      report(`${(error as Error).message}\n`);
      return null;
    }
  })();
  if (located === null) return 1;

  const run =
    deps.run ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, { stdio: "inherit" }));

  // Spawned rather than imported: the script is plain ESM with no build step,
  // and running it as its own process keeps the interactive prompt attached to
  // the real terminal — a credential-manager question read through a bundler's
  // stdio is how a bootstrap ends up hanging with nothing on screen.
  const result = run(process.execPath, [located, ...flags]);
  return result.status ?? 1;
}

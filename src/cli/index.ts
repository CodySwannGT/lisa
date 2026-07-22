import { Command } from "commander";
import { runApply } from "./apply.js";
import { runCheckLearningsBudget } from "./check-learnings-budget-cmd.js";
import {
  type CrossPollinateOptions,
  runCrossPollinate,
} from "./cross-pollinate-cmd.js";
import { runDoctor } from "./doctor.js";
import { runDeployStatusSync } from "./deploy-status-sync-cmd.js";
import { runFileUpstream } from "./file-upstream-cmd.js";
import { runHealthCli, type HealthCliOptions } from "./health-cmd.js";
import { addGateCommands } from "./gate-commands.js";
import { addKaneCommands } from "./kane-commands.js";
import type { GateCommandDependencies } from "./gate-commands.js";
import { runKaneCli, runKanePilotCli, runKaneProbeCli } from "./kane-cmd.js";
import { printUpdateWarning } from "./print-update-warning.js";
import {
  DEFAULT_SETUP_PROJECT_DEPENDENCIES,
  runSetupProject,
} from "./setup-project.js";
import { runSetupWiki } from "./setup-wiki.js";
import { addSharedOptions, type CLIOptions } from "./shared-options.js";
import { SETUP_TYPES } from "./starters.js";
import { runStandardsProofCli } from "./standards-proof-cmd.js";
import { runSync, type SyncCmdOptions } from "./sync-cmd.js";
import { runUi, type UiCmdOptions } from "./ui-cmd.js";
import { runUpdate } from "./update-cmd.js";
import { runUpdateCheck } from "./update-check.js";
import { addUpdateCheckHook } from "./update-check-hook.js";
import { runVersion } from "./version-cmd.js";
import { getPackageVersion } from "./version.js";

/**
 * Injectable collaborators for {@link createProgram}. Defaults wire the real
 * apply action and npm update-check; tests override them to observe the program
 * wiring without touching the registry or the orchestrator.
 */
export interface ProgramDependencies extends GateCommandDependencies {
  /** Applies Lisa to a destination (defaults to the real {@link runApply}). */
  runApply: typeof runApply;
  /** Creates a starter-backed project and applies Lisa overlays. */
  runSetupProject: typeof runSetupProject;
  /** Prepares an existing project for embedded wiki setup. */
  runSetupWiki: typeof runSetupWiki;
  /** Prints Lisa CLI version metadata. */
  runVersion: typeof runVersion;
  /** Prints or runs the package-manager update command. */
  runUpdate: typeof runUpdate;
  /** Diagnoses Lisa project health. */
  runDoctor: typeof runDoctor;
  /** Cross-pollinates locally-authored agent definitions across the fleet. */
  runCrossPollinate: typeof runCrossPollinate;
  /** Populates and syncs `.lisa.config.json` with its mirrored artifacts. */
  runSync: typeof runSync;
  /** Serves the Lisa settings console (after a config sync). */
  runUi: typeof runUi;
  /** Runs and persists the shared Health v1 consumer. */
  runHealthCli: typeof runHealthCli;
  /** Runs every standards command and writes freshness-bound proof. */
  runStandardsProofCli: typeof runStandardsProofCli;
  /** Runs one policy-approved Kane empirical browser objective. */
  runKaneCli: typeof runKaneCli;
  /** Probes Kane installation, authentication, and Test Manager readiness. */
  runKaneProbeCli: typeof runKaneProbeCli;
  /** Executes or reports the controlled longitudinal Kane pilot. */
  runKanePilotCli: typeof runKanePilotCli;
  /** Runs the non-fatal npm update check (defaults to {@link runUpdateCheck}). */
  runUpdateCheck: typeof runUpdateCheck;
  /** Prints the update warning (defaults to {@link printUpdateWarning}). */
  printUpdateWarning: typeof printUpdateWarning;
}

const DEFAULT_DEPENDENCIES: ProgramDependencies = {
  runApply,
  runSetupProject,
  runSetupWiki,
  runVersion,
  runUpdate,
  runDoctor,
  runCrossPollinate,
  runSync,
  runUi,
  runCheckLearningsBudget,
  runFileUpstream,
  runDeployStatusSync,
  runHealthCli,
  runStandardsProofCli,
  runKaneCli,
  runKaneProbeCli,
  runKanePilotCli,
  runUpdateCheck,
  printUpdateWarning,
};

/** Shared help text for the optional project-path positional argument. */
const PATH_ARG_DESCRIPTION = "Project path (default: current directory)";

/**
 * Register the `doctor` command, including the additive `--readiness` audit.
 * @param program - Commander program to mutate
 * @param deps - Program dependencies
 */
function addDoctorCommand(program: Command, deps: ProgramDependencies): void {
  program
    .command("doctor")
    .description("Diagnose Lisa, project, starter, and wiki health")
    .argument("[path]", "Project path to inspect")
    .option("--json", "Emit JSON")
    .option("--offline", "Skip network checks")
    .option(
      "--readiness",
      "Also audit repository readiness for unattended fleet operation and persist .lisa/readiness.json"
    )
    .action(async (targetPath: string | undefined, options) => {
      await deps.runDoctor(targetPath, options);
    });
}

/**
 * Register the shared deterministic/agentic health consumer.
 * @param program - Commander program to mutate
 * @param deps - Program dependencies
 */
function addHealthCommand(program: Command, deps: ProgramDependencies): void {
  program
    .command("health")
    .description(
      "Run Lisa's shared project health check and persist the result"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .option(
      "--prepare-agentic",
      "Emit bounded agentic evidence without persisting a health result"
    )
    .option(
      "--agentic-evaluation",
      "Read a digest-bound evaluator response from standard input"
    )
    .action(
      async (targetPath: string | undefined, options: HealthCliOptions) => {
        await deps.runHealthCli(targetPath, options);
      }
    );
}

/**
 * Register the explicit, mutating standards proof command.
 * @param program - Commander program to mutate
 * @param deps - Program dependencies
 */
function addStandardsProofCommand(
  program: Command,
  deps: ProgramDependencies
): void {
  program
    .command("standards-proof")
    .description(
      "Run all applicable Lisa standards checks and prove the current Git artifact"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .action(async (targetPath: string | undefined) => {
      await deps.runStandardsProofCli(targetPath);
    });
}

/**
 * Register CLI maintenance commands that do not run the root update warning.
 * @param program - Commander program to mutate
 * @param deps - Program dependencies
 * @returns The same Commander program
 */
function addMaintenanceCommands(
  program: Command,
  deps: ProgramDependencies
): Command {
  program
    .command("version")
    .description("Print Lisa CLI version info")
    .action(async () => {
      await deps.runVersion();
    });

  program
    .command("update")
    .description(
      "Print (or run with --yes) the recommended package-manager update command"
    )
    .option("--yes", "Execute the update command after printing it")
    .action(async (options: { yes?: boolean }) => {
      const code = await deps.runUpdate(options);
      if (code !== 0) {
        process.exitCode = code;
      }
    });

  addDoctorCommand(program, deps);
  addHealthCommand(program, deps);
  addStandardsProofCommand(program, deps);

  program
    .command("sync")
    .description(
      "Populate .lisa.config.json with every missing setting and sync mirrored files (config wins)"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .option("--dry-run", "Report what would change without writing")
    .option("--json", "Emit the report as JSON")
    .action(async (targetPath: string | undefined, options: SyncCmdOptions) => {
      const code = await deps.runSync(targetPath, options);
      if (code !== 0) {
        process.exitCode = code;
      }
    });

  program
    .command("ui")
    .description(
      "Serve the Lisa settings console for a project (runs a config sync first)"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .option("--port <port>", "Port to listen on", "4780")
    .option("--no-sync", "Skip the config sync on startup")
    .action(async (targetPath: string | undefined, options: UiCmdOptions) => {
      await deps.runUi(targetPath, options);
    });

  addGateCommands(program, deps);
  addKaneCommands(program, deps);

  program
    .command("cross-pollinate")
    .description(
      "Make locally-authored agent definitions available to the other agents this project supports"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .option("--write", "Apply emits and update the lockfile (default: dry-run)")
    .action(
      async (
        targetPath: string | undefined,
        options: CrossPollinateOptions
      ) => {
        await deps.runCrossPollinate(targetPath, options);
      }
    );

  return program;
}

/**
 * Create and configure the CLI program.
 *
 * The root program is subcommand-style: `apply` is the explicit subcommand and
 * also the default command, so the historical positional `lisa <dest>`
 * invocation keeps working. Both forms call the same apply action. A
 * `preAction` hook runs the npm update-check exactly once per invocation before
 * any action fires.
 * @param dependencies - Optional collaborator overrides for testing
 * @returns Configured Commander program
 */
export function createProgram(
  dependencies: Partial<ProgramDependencies> = {}
): Command {
  const deps: ProgramDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };
  const program = new Command();

  program
    .name("lisa")
    .description(
      "Claude Code / Codex CLI governance framework - apply guardrails and guidance to projects"
    )
    .version(getPackageVersion())
    .option("--no-update-check", "Skip the npm latest-version check");

  addUpdateCheckHook(program, deps);

  // `apply` is both the explicit subcommand and the default command, so the
  // historical positional form `lisa <destination>` routes here unchanged and
  // produces the same result as `lisa apply <destination>`. Commander rejects a
  // root-level positional `argument` once subcommands exist, so the default
  // command is the supported way to keep the bare-positional invocation.
  addSharedOptions(
    program
      .command("apply", { isDefault: true })
      .description("Apply Lisa to an existing project (backwards-compatible)")
      .argument("[destination]", "Path to the project directory")
  ).action(async (destination: string | undefined, options: CLIOptions) => {
    await deps.runApply(destination, options);
  });

  addSharedOptions(
    program
      .command("setup-project")
      .description("Create a new Lisa-managed project from a starter repo")
      .requiredOption(
        "--type <type>",
        `Project type: ${SETUP_TYPES.join(" | ")}`
      )
      .argument("[destination]", "Project name or path (default: ./<type>-app)")
  ).action(
    async (
      destination: string | undefined,
      options: CLIOptions & { type?: string }
    ) => {
      await deps.runSetupProject(destination, options, {
        ...DEFAULT_SETUP_PROJECT_DEPENDENCIES,
        runApply: deps.runApply,
      });
    }
  );

  addSharedOptions(
    program
      .command("setup-wiki")
      .description("Prepare an existing project for embedded Lisa wiki setup")
      .argument("[path]", PATH_ARG_DESCRIPTION)
  ).action(async (destination: string | undefined, options: CLIOptions) => {
    await deps.runSetupWiki(destination, options);
  });

  addMaintenanceCommands(program, deps);

  return program;
}

export { createPrompter } from "./prompts.js";

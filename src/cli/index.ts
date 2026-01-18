import { Command } from "commander";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { LisaConfig } from "../core/config.js";
import { Lisa, type LisaDependencies } from "../core/lisa.js";
import { DetectorRegistry } from "../detection/index.js";
import { StrategyRegistry } from "../strategies/index.js";
import { ManifestService, DryRunManifestService } from "../core/manifest.js";
import { BackupService, DryRunBackupService } from "../transaction/index.js";
import { ConsoleLogger } from "../logging/index.js";
import { createPrompter } from "./prompts.js";
import { toAbsolutePath } from "../utils/path-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Get Lisa directory (where configs are stored)
 */
function getLisaDir(): string {
  // Go up from dist/cli to project root
  return path.resolve(__dirname, "..", "..");
}

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("lisa")
    .description(
      "Claude Code governance framework - apply guardrails and guidance to projects"
    )
    .version("1.0.0")
    .argument("[destination]", "Path to the project directory")
    .option("-n, --dry-run", "Show what would be done without making changes")
    .option(
      "-y, --yes",
      "Non-interactive mode (auto-accept defaults, overwrite on conflict)"
    )
    .option(
      "-v, --validate",
      "Validate project compatibility without applying changes"
    )
    .option("-u, --uninstall", "Remove Lisa-managed files from the project")
    .action(async (destination: string | undefined, options: CLIOptions) => {
      await runLisa(destination, options);
    });

  return program;
}

interface CLIOptions {
  dryRun?: boolean;
  yes?: boolean;
  validate?: boolean;
  uninstall?: boolean;
}

/**
 * Run Lisa with the given options
 */
async function runLisa(
  destination: string | undefined,
  options: CLIOptions
): Promise<void> {
  // Check for destination
  if (!destination) {
    console.error("Error: destination path is required");
    console.log("");
    console.log("Usage: lisa [options] <destination-path>");
    console.log("");
    console.log("Options:");
    console.log(
      "  -n, --dry-run     Show what would be done without making changes"
    );
    console.log(
      "  -y, --yes         Non-interactive mode (auto-accept defaults, overwrite on conflict)"
    );
    console.log(
      "  -v, --validate    Validate project compatibility without applying changes"
    );
    console.log(
      "  -u, --uninstall   Remove Lisa-managed files from the project"
    );
    console.log("  -h, --help        Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  lisa /path/to/my-project");
    console.log("  lisa --dry-run .");
    console.log("  lisa --yes /path/to/project    # CI/CD pipeline usage");
    console.log("  lisa --validate .              # Check compatibility only");
    console.log(
      "  lisa --uninstall .             # Remove Lisa configurations"
    );
    process.exit(1);
  }

  const lisaDir = getLisaDir();
  const destDir = toAbsolutePath(destination);
  const dryRun = options.dryRun ?? options.validate ?? false;
  const yesMode = options.yes ?? false;
  const validateOnly = options.validate ?? false;

  const config: LisaConfig = {
    lisaDir,
    destDir,
    dryRun,
    yesMode,
    validateOnly,
  };

  const logger = new ConsoleLogger();

  const deps: LisaDependencies = {
    logger,
    prompter: createPrompter(yesMode),
    manifestService: dryRun
      ? new DryRunManifestService()
      : new ManifestService(),
    backupService: dryRun
      ? new DryRunBackupService()
      : new BackupService(logger),
    detectorRegistry: new DetectorRegistry(),
    strategyRegistry: new StrategyRegistry(),
  };

  const lisa = new Lisa(config, deps);

  try {
    let result;

    if (options.uninstall) {
      result = await lisa.uninstall();
    } else if (options.validate) {
      result = await lisa.validate();
    } else {
      result = await lisa.apply();
    }

    if (!result.success) {
      process.exit(1);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { createPrompter } from "./prompts.js";

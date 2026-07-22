/**
 * Registrar for the optional Kane provider command group, extracted from the
 * CLI index to keep that module within its size budget (mirrors the
 * gate-commands registrar pattern).
 * @module cli/kane-commands
 */
import type { Command } from "commander";
import type { KaneRunOptions } from "./kane-cmd.js";

/** Kane runners kept structural to avoid importing the CLI dependency record. */
export interface KaneCommandDependencies {
  runKaneCli: (
    targetPath: string | undefined,
    options: KaneRunOptions
  ) => Promise<void>;
  runKaneProbeCli: (
    targetPath: string | undefined,
    json: boolean
  ) => Promise<void>;
  runKanePilotCli: (manifest: string, reportOnly: boolean) => Promise<void>;
}

const PATH_ARG_DESCRIPTION = "Project path (default: current directory)";

/**
 * Register the optional Kane provider command group.
 * @param program - Commander program to mutate
 * @param deps - Program dependencies
 */
export function addKaneCommands(
  program: Command,
  deps: KaneCommandDependencies
): void {
  const kane = program
    .command("kane")
    .description("Use Lisa's guarded optional Kane CLI browser provider");
  kane
    .command("probe")
    .description(
      "Check Kane installation, auth, target, and AI-credit availability"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .option("--json", "Emit JSON")
    .action(
      async (targetPath: string | undefined, options: { json?: boolean }) => {
        await deps.runKaneProbeCli(targetPath, options.json === true);
      }
    );
  kane
    .command("run")
    .description(
      "Run one empirical browser objective through Lisa's safety gate"
    )
    .argument("[path]", PATH_ARG_DESCRIPTION)
    .requiredOption("--objective <text>", "Self-contained browser objective")
    .requiredOption("--environment <name>", "Lisa exploration environment")
    .requiredOption(
      "--mutation <level>",
      "Resolved Lisa mutation policy (forbidden | read-only | full)"
    )
    .option("--url <url>", "Starting URL")
    .option("--max-steps <count>", "Kane reasoning-step limit")
    .option("--json", "Emit Lisa's normalized JSON result")
    .action(async (targetPath: string | undefined, options: KaneRunOptions) => {
      if (
        !(["forbidden", "read-only", "full"] as const).includes(
          options.mutation
        )
      ) {
        throw new Error("--mutation must be forbidden, read-only, or full");
      }
      await deps.runKaneCli(targetPath, options);
    });
  kane
    .command("pilot")
    .description("Execute or report the 30-day multi-application Kane pilot")
    .argument("<manifest>", "Path to the Kane pilot JSON manifest")
    .option("--report-only", "Read existing JSONL results without executing")
    .action(async (manifest: string, options: { reportOnly?: boolean }) => {
      await deps.runKanePilotCli(manifest, options.reportOnly === true);
    });
}

import type { Command } from "commander";

/** CLI adapter for explicit standards-conformance proof capture. */
import path from "node:path";
import { captureStandardsProof } from "../standards/capture.js";

/**
 * Run every applicable standards command and publish a current proof.
 * @param projectPath - Optional project path
 * @param cwd - Injectable process working directory
 */
export async function runStandardsProofCli(
  projectPath: string | undefined,
  cwd: string = process.cwd()
): Promise<void> {
  const root = path.resolve(cwd, projectPath ?? ".");
  const proof = await captureStandardsProof(root);
  process.stdout.write(
    `standards-proof: PASS ${proof.repository.identity}@${proof.repository.head} (${proof.results.length} checks)\n`
  );
}

/**
 * The only dependency this registration needs, structurally.
 *
 * Declared here rather than importing `ProgramDependencies` from the program
 * module, which would import this one back.
 */
interface StandardsProofCommandDeps {
  /** Runs every standards command and writes freshness-bound proof. */
  readonly runStandardsProofCli: typeof runStandardsProofCli;
}

/**
 * Register the explicit, mutating standards proof command.
 *
 * Lives beside its command rather than in the program module, matching
 * `addGateCommands` — registration is part of the command, and keeping it here
 * is what stops the program file growing without bound.
 * @param program Commander program to mutate.
 * @param deps Program dependencies.
 */
export function addStandardsProofCommand(
  program: Command,
  deps: StandardsProofCommandDeps
): void {
  program
    .command("standards-proof")
    .description(
      "Run all applicable Lisa standards checks and prove the current Git artifact"
    )
    .argument("[path]", "Project path (default: current directory)")
    .action(async (targetPath: string | undefined) => {
      await deps.runStandardsProofCli(targetPath);
    });
}

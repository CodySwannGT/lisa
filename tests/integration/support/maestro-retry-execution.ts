import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { LEDGER_FILE } from "./maestro-android-retry-fixtures.js";
import type { ReusableWorkflow, GateResult } from "./maestro-retry-types.js";

const BASH = "/bin/bash";

/**
 * Runs a command and reports its status and stdout instead of throwing.
 *
 * The subject under test is a script whose EXIT STATUS is half the assertion,
 * so a non-zero status is a reading here, never an error.
 * @param file - Executable to run
 * @param args - Its arguments
 * @param options - Child-process options
 * @param options.cwd - Working directory for the child
 * @param options.env - Environment for the child
 * @returns The exit status and whatever the child printed
 */
export const runCapturing = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): { status: number; output: string } => {
  try {
    return {
      status: 0,
      output: boundedExecFileSync({
        label: `${file} ${args.join(" ")}`,
        command: file,
        args,
        ...options,
      }),
    };
  } catch (error) {
    const failure = error as { exitCode?: number | null; stdout?: string };
    return { status: failure.exitCode ?? -1, output: failure.stdout ?? "" };
  }
};

/**
 * Executes the retry-budget gate step against a hand-written ledger.
 * @param workflow - The parsed workflow
 * @param ledger - Ledger contents, or null to omit the file
 * @param platform - Platform whose real gate should execute
 * @returns Exit status, step output, summary text, and step outputs
 */
export const runGate = async (
  workflow: ReusableWorkflow,
  ledger: string | null,
  platform: "android" | "ios" = "android"
): Promise<GateResult> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-agate-"));
  try {
    const ledgerFile = LEDGER_FILE.replace("android", platform);
    if (ledger !== null) {
      await fs.writeFile(path.join(dir, ledgerFile), ledger);
    }
    const gate = workflow.jobs[platform]?.steps?.find(candidate =>
      candidate.name?.includes("Enforce the per-flow retry budget")
    )?.run;
    if (!gate || gate.includes("${{")) {
      throw new Error(`Missing executable ${platform} retry gate`);
    }
    const outputs = path.join(dir, "outputs");
    const summary = path.join(dir, "summary");
    await fs.writeFile(outputs, "");
    await fs.writeFile(summary, "");
    const { status, output } = runCapturing(
      BASH,
      ["-eo", "pipefail", "-c", gate],
      {
        cwd: dir,
        env: {
          ...process.env,
          LEDGER: ledgerFile,
          GITHUB_OUTPUT: outputs,
          GITHUB_STEP_SUMMARY: summary,
        },
      }
    );
    return {
      status,
      output,
      summary: await fs.readFile(summary, "utf-8"),
      outputs: await fs.readFile(outputs, "utf-8"),
    };
  } finally {
    await fs.remove(dir);
  }
};

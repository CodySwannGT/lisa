/** Lisa CLI entrypoints for the optional Kane empirical-browser adapter. */
import * as path from "node:path";
import {
  probeKaneReadiness,
  runKane,
  type KaneMutationLevel,
  type KaneRunRequest,
} from "../core/kane-cli.js";
import { executeKanePilot, readKanePilotReport } from "../core/kane-pilot.js";

/** Options accepted by `lisa kane run`. */
export interface KaneRunOptions {
  readonly objective: string;
  readonly environment: string;
  readonly mutation: KaneMutationLevel;
  readonly url?: string;
  readonly maxSteps?: string;
  readonly json?: boolean;
}

/** Injectable CLI collaborators. */
export interface KaneCliDependencies {
  readonly run: typeof runKane;
  readonly probe: typeof probeKaneReadiness;
  readonly write: (message: string) => void;
  readonly setExitCode: (code: number) => void;
  readonly executePilot: typeof executeKanePilot;
  readonly readPilotReport: typeof readKanePilotReport;
}

const DEFAULT_DEPENDENCIES: KaneCliDependencies = {
  run: runKane,
  probe: probeKaneReadiness,
  write: message => console.log(message),
  setExitCode: code => {
    process.exitCode = code;
  },
  executePilot: executeKanePilot,
  readPilotReport: readKanePilotReport,
};

/**
 * Map stable adapter outcomes to process exit codes.
 * @param outcome - Stable adapter outcome
 * @returns CLI exit code
 */
function outcomeExitCode(
  outcome: Awaited<ReturnType<typeof runKane>>["outcome"]
): number {
  if (outcome === "passed") return 0;
  if (outcome === "product_failed") return 1;
  if (outcome === "timed_out") return 3;
  return 2;
}

/**
 * Run one Kane objective through Lisa's safety and schema boundary.
 * @param projectPath - Optional downstream project path
 * @param options - Objective and resolved policy options
 * @param dependencies - Injectable CLI collaborators
 * @returns Completion promise
 */
export async function runKaneCli(
  projectPath: string | undefined,
  options: KaneRunOptions,
  dependencies: Partial<KaneCliDependencies> = {}
): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const maxSteps =
    options.maxSteps === undefined ? undefined : Number(options.maxSteps);
  if (
    maxSteps !== undefined &&
    (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100)
  ) {
    throw new Error("--max-steps must be an integer from 1 to 100");
  }
  const request: KaneRunRequest = {
    projectRoot: path.resolve(projectPath ?? process.cwd()),
    environment: options.environment,
    mutation: options.mutation,
    objective: options.objective,
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
  };
  const result = await deps.run(request);
  const exitCode = outcomeExitCode(result.outcome);
  deps.write(
    options.json === true
      ? JSON.stringify(result, null, 2)
      : `${result.outcome.toUpperCase()}: ${result.terminal?.summary ?? result.terminal?.reason ?? "Kane run produced no summary"}`
  );
  if (exitCode !== 0) deps.setExitCode(exitCode);
}

/**
 * Run Kane's read-only readiness probe.
 * @param projectPath - Optional downstream project path
 * @param json - Whether to emit JSON
 * @param dependencies - Injectable CLI collaborators
 * @returns Completion promise
 */
export async function runKaneProbeCli(
  projectPath: string | undefined,
  json: boolean,
  dependencies: Partial<KaneCliDependencies> = {}
): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const readiness = await deps.probe(
    path.resolve(projectPath ?? process.cwd())
  );
  deps.write(
    json
      ? JSON.stringify(readiness, null, 2)
      : `${readiness.status.toUpperCase()}: ${readiness.detail}`
  );
  if (readiness.status === "fail") deps.setExitCode(1);
}

/**
 * Execute one longitudinal pilot sweep and print the current gate report.
 * @param manifestPath - Pilot manifest path
 * @param reportOnly - Skip execution and only evaluate accumulated records
 * @param dependencies - Injectable CLI collaborators
 * @returns Completion promise
 */
export async function runKanePilotCli(
  manifestPath: string,
  reportOnly: boolean,
  dependencies: Partial<KaneCliDependencies> = {}
): Promise<void> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const report = reportOnly
    ? await deps.readPilotReport(manifestPath)
    : await deps.executePilot(manifestPath);
  deps.write(JSON.stringify(report, null, 2));
  if (report.verdict === "reject") deps.setExitCode(1);
}

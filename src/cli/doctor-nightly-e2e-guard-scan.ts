/**
 * @file doctor-nightly-e2e-guard-scan.ts
 * @description Bounded executable-YAML discovery for nightly bypass callers
 * @module cli/doctor-nightly-e2e-guard-scan
 */
import { loadYaml } from "../utils/yaml.js";
import {
  MAX_NIGHTLY_GUARD_CALLERS,
  MAX_NIGHTLY_GUARD_FILE_BYTES,
  MAX_NIGHTLY_GUARD_FILES,
  MAX_NIGHTLY_GUARD_TARGETS,
  MAX_NIGHTLY_GUARD_TOTAL_BYTES,
  NIGHTLY_GUARD_OPERATION_TIMEOUT_MS,
  NIGHTLY_GUARD_WORKFLOWS,
  type NightlyGuardScanResult,
  type NightlyGuardWorkflowRecord,
  nightlyGuardObject,
  orderNightlyGuardStrings,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  createNightlyGuardDeadline,
  type NightlyGuardDeadline,
} from "./doctor-nightly-e2e-guard-deadline.js";
import { traceNightlyGuardCallers } from "./doctor-nightly-e2e-guard-graph.js";
import {
  readNightlyGuardDirectory,
  readNightlyGuardFile,
} from "./doctor-nightly-e2e-guard-io.js";

export {
  MAX_NIGHTLY_GUARD_CALLERS,
  MAX_NIGHTLY_GUARD_FILES,
  MAX_NIGHTLY_GUARD_TARGETS,
};
export type {
  NightlyGuardCaller,
  NightlyGuardScanFailure,
  NightlyGuardScanResult,
} from "./doctor-nightly-e2e-guard-contract.js";

/** Optional shared deadline used by the top-level doctor operation. */
export interface NightlyGuardScanDependencies {
  /** Deadline started before discovery; standalone scans receive their own. */
  readonly deadline?: NightlyGuardDeadline;
}

const unavailable = (
  workflow: string,
  reason: string
): NightlyGuardScanResult => ({
  state: "unavailable",
  failures: [{ workflow, reason }],
});

const parseWorkflow = (
  file: string,
  name: string,
  source: Buffer
): NightlyGuardWorkflowRecord | NightlyGuardScanResult => {
  try {
    const document = nightlyGuardObject(loadYaml(source.toString("utf8")));
    return document
      ? { file, name, document }
      : unavailable(file, "workflow YAML root is not a mapping");
  } catch (error) {
    return unavailable(
      file,
      `workflow is unreadable or malformed (${error instanceof Error ? error.message : String(error)})`
    );
  }
};

const isScanResult = (
  value: NightlyGuardWorkflowRecord | NightlyGuardScanResult
): value is NightlyGuardScanResult => "state" in value;

/**
 * Read the bounded workflow inventory without following path components.
 * @param projectRoot - Project containment root
 * @param deadline - Whole-operation deadline already started by doctor
 * @returns Parsed inventory or an explicit availability refusal
 */
async function readWorkflowRecords(
  projectRoot: string,
  deadline: NightlyGuardDeadline
): Promise<readonly NightlyGuardWorkflowRecord[] | NightlyGuardScanResult> {
  const directory = await readNightlyGuardDirectory(
    projectRoot,
    NIGHTLY_GUARD_WORKFLOWS,
    deadline
  );
  if (directory.state === "missing") return [];
  if (directory.state === "unavailable") {
    return unavailable(NIGHTLY_GUARD_WORKFLOWS, directory.reason);
  }
  const names = orderNightlyGuardStrings(
    directory.names.filter(name => /\.ya?ml$/u.test(name))
  );
  if (names.length > MAX_NIGHTLY_GUARD_FILES) {
    return unavailable(
      NIGHTLY_GUARD_WORKFLOWS,
      `workflow file limit ${MAX_NIGHTLY_GUARD_FILES} exceeded`
    );
  }

  const readNext = async (
    index: number,
    totalBytes: number,
    records: readonly NightlyGuardWorkflowRecord[]
  ): Promise<
    readonly NightlyGuardWorkflowRecord[] | NightlyGuardScanResult
  > => {
    const name = names[index];
    if (name === undefined) return records;
    const file = `${NIGHTLY_GUARD_WORKFLOWS}/${name}`;
    const read = await readNightlyGuardFile(
      projectRoot,
      file,
      MAX_NIGHTLY_GUARD_FILE_BYTES,
      deadline
    );
    if (read.state !== "ok") return unavailable(file, read.reason);
    const nextTotal = totalBytes + read.bytes.length;
    if (nextTotal > MAX_NIGHTLY_GUARD_TOTAL_BYTES) {
      return unavailable(file, "workflow scan exceeds the 8 MiB total limit");
    }
    const parsed = parseWorkflow(file, name, read.bytes);
    return isScanResult(parsed)
      ? parsed
      : await readNext(index + 1, nextTotal, [...records, parsed]);
  };

  return await readNext(0, 0, []);
}

/**
 * Discover every bypass-bearing guard caller reachable from repository events.
 * @param projectRoot - Project root whose workflow tree is inspected
 * @param dependencies - Shared deadline when called by doctor
 * @returns Deterministic callers, or an explicit unavailable refusal
 */
export async function scanNightlyE2eGuardCallers(
  projectRoot: string,
  dependencies: NightlyGuardScanDependencies = {}
): Promise<NightlyGuardScanResult> {
  const deadline =
    dependencies.deadline ??
    createNightlyGuardDeadline(undefined, NIGHTLY_GUARD_OPERATION_TIMEOUT_MS);
  const records = await readWorkflowRecords(projectRoot, deadline);
  return Array.isArray(records)
    ? traceNightlyGuardCallers(records)
    : (records as NightlyGuardScanResult);
}

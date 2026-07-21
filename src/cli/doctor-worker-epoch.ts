import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor.js";
import {
  computeWorkerDrift,
  countWorkerWorkaroundCandidates,
  currentRuntimeWorkerSignature,
  findWorkerRecordForHost,
  normalizeWorkerAgents,
  resolveRecordedEvidence,
  type RuntimeWorkerSignature,
  type WorkerEpochAgentRecord,
  type WorkerEpochRecord,
} from "./doctor-worker-journey.js";

const WORKER_EPOCH_CHECK_NAME = "Worker epoch qualified?";

/**
 * Report whether the project has a worker-epoch record and whether the current
 * runtime signature still matches it. This is intentionally read-only: doctor
 * tells the operator when requalification is needed; lifecycle/repair flows own
 * filing any build-ready tickets from failed representative journeys.
 *
 * The journey machinery it consumes now lives in `doctor-worker-journey.ts` so
 * the readiness execution/proof dimension (RRR-6, #1858) reuses the exact same
 * runner rather than forking a second harness (intake decision F5). This
 * function's output is unchanged by that extraction.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkWorkerEpoch(
  targetPath: string
): Promise<DoctorCheck> {
  const recordPath = path.join(targetPath, ".lisa", "worker-config.json");
  if (!existsSync(recordPath)) {
    if (!looksLikeLisaProject(targetPath)) {
      return {
        name: WORKER_EPOCH_CHECK_NAME,
        status: "ok",
        detail: "Not a Lisa project; skipped worker epoch qualification",
      };
    }
    return {
      name: WORKER_EPOCH_CHECK_NAME,
      status: "warn",
      detail:
        "No .lisa/worker-config.json found; record the qualified model/agent-host epoch and representative journey evidence before relying on unattended factory runs",
    };
  }

  try {
    const record = JSON.parse(
      await readFile(recordPath, "utf8")
    ) as WorkerEpochRecord;
    return evaluateWorkerEpochRecord(
      targetPath,
      record,
      currentRuntimeWorkerSignature()
    );
  } catch (error) {
    return {
      name: WORKER_EPOCH_CHECK_NAME,
      status: "fail",
      detail: `.lisa/worker-config.json is not parseable JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Determine whether a project should carry a Lisa worker epoch record.
 * @param targetPath - Project path to inspect
 * @returns True when Lisa project markers are present
 */
function looksLikeLisaProject(targetPath: string): boolean {
  return [".lisa.config.json", ".lisa.config.local.json", ".lisa"].some(
    fileName => existsSync(path.join(targetPath, fileName))
  );
}

/**
 * Compare a parsed worker record against the current runtime signature.
 * @param targetPath - Project path to inspect for subtraction candidates
 * @param record - Parsed worker epoch record
 * @param signature - Current runtime worker signature
 * @returns Doctor check result
 */
async function evaluateWorkerEpochRecord(
  targetPath: string,
  record: WorkerEpochRecord,
  signature: RuntimeWorkerSignature
): Promise<DoctorCheck> {
  const agents = normalizeWorkerAgents(record);
  if (agents.length === 0) {
    return {
      name: WORKER_EPOCH_CHECK_NAME,
      status: "warn",
      detail:
        ".lisa/worker-config.json does not list any qualified workers; add agent host, model, version, and evidence entries",
    };
  }

  const currentRecord = findWorkerRecordForHost(agents, signature);
  if (!currentRecord) {
    return {
      name: WORKER_EPOCH_CHECK_NAME,
      status: "warn",
      detail:
        `Worker epoch record exists, but current host ${signature.host} is not recorded; ` +
        "run representative journeys, save evidence, and list any scaffolding-subtraction candidates in the report",
    };
  }

  return renderWorkerEpochMatch(targetPath, currentRecord, signature);
}

/**
 * Render the doctor check for the matched worker host.
 * @param targetPath - Project path to inspect for subtraction candidates
 * @param currentRecord - Recorded worker for the current host
 * @param signature - Current runtime worker signature
 * @returns Doctor check result
 */
async function renderWorkerEpochMatch(
  targetPath: string,
  currentRecord: WorkerEpochAgentRecord,
  signature: RuntimeWorkerSignature
): Promise<DoctorCheck> {
  const drift = computeWorkerDrift(currentRecord, signature);
  const subtractionCount = await countWorkerWorkaroundCandidates(targetPath);
  const evidence = resolveRecordedEvidence(currentRecord);

  if (drift.length > 0) {
    return {
      name: WORKER_EPOCH_CHECK_NAME,
      status: "warn",
      detail:
        `Worker epoch drift detected for ${signature.host}: ${drift.join(", ")}. ` +
        "Re-run representative journeys headlessly; passing journeys update qualification evidence, failing journeys file build-ready tickets. " +
        `Scaffolding-subtraction candidates surfaced: ${subtractionCount}.`,
    };
  }

  return {
    name: WORKER_EPOCH_CHECK_NAME,
    status: evidence ? "ok" : "warn",
    detail: evidence
      ? `Worker epoch matches ${signature.host}; qualification evidence: ${evidence}. Scaffolding-subtraction candidates surfaced: ${subtractionCount}.`
      : `Worker epoch matches ${signature.host}, but no qualification evidence is recorded. Scaffolding-subtraction candidates surfaced: ${subtractionCount}.`,
  };
}

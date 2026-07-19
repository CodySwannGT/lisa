import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type { DoctorCheck } from "./doctor.js";

const WORKER_EPOCH_CHECK_NAME = "Worker epoch qualified?";

/** One worker entry from `.lisa/worker-config.json`. */
interface WorkerEpochAgentRecord {
  id?: unknown;
  host?: unknown;
  version?: unknown;
  model?: unknown;
  modelId?: unknown;
  qualificationEvidence?: unknown;
  evidence?: unknown;
}

/** Supported top-level worker epoch record shapes. */
interface WorkerEpochRecord {
  agents?: unknown;
  workers?: unknown;
}

/** Current runtime identity used for epoch comparison. */
interface RuntimeWorkerSignature {
  host: string;
  model: string;
  version: string;
}

/**
 * Report whether the project has a worker-epoch record and whether the current
 * runtime signature still matches it. This is intentionally read-only: doctor
 * tells the operator when requalification is needed; lifecycle/repair flows own
 * filing any build-ready tickets from failed representative journeys.
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

  const currentRecord = agents.find(agent => {
    return (
      typeof agent.host === "string" &&
      agent.host.toLowerCase() === signature.host
    );
  });
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
  const recordedModel = stringField(
    currentRecord.modelId ?? currentRecord.model
  );
  const recordedVersion = stringField(currentRecord.version);
  const drift = [
    compareWorkerField("model", recordedModel, signature.model),
    compareWorkerField("version", recordedVersion, signature.version),
  ].filter((entry): entry is string => entry !== null);
  const subtractionCount = await countWorkerWorkaroundCandidates(targetPath);
  const evidence = stringField(
    currentRecord.qualificationEvidence ?? currentRecord.evidence
  );

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

/**
 * Normalize object- and array-shaped worker records into one array.
 * @param record - Parsed worker epoch record
 * @returns Normalized worker entries
 */
function normalizeWorkerAgents(
  record: WorkerEpochRecord
): WorkerEpochAgentRecord[] {
  if (Array.isArray(record.agents)) {
    return record.agents.filter(isRecord) as WorkerEpochAgentRecord[];
  }
  if (Array.isArray(record.workers)) {
    return record.workers.filter(isRecord) as WorkerEpochAgentRecord[];
  }
  if (isRecord(record.agents)) {
    return Object.entries(record.agents).map(([id, value]) => ({
      ...(isRecord(value) ? value : {}),
      id,
    }));
  }
  if (isRecord(record.workers)) {
    return Object.entries(record.workers).map(([id, value]) => ({
      ...(isRecord(value) ? value : {}),
      id,
    }));
  }
  return [];
}

/**
 * Infer a stable worker signature from explicit Lisa variables first.
 * @returns Current runtime signature
 */
function currentRuntimeWorkerSignature(): RuntimeWorkerSignature {
  const env = process["env"];
  const host =
    env.LISA_WORKER_HOST ??
    (env.CODEX_HOME || env.CODEX_SANDBOX
      ? "codex"
      : env.CLAUDECODE
        ? "claude"
        : "unknown");
  return {
    host: host.toLowerCase(),
    model: env.LISA_WORKER_MODEL ?? env.CODEX_MODEL ?? "unknown",
    version: env.LISA_WORKER_VERSION ?? env.CODEX_VERSION ?? "unknown",
  };
}

/**
 * Return a human-readable drift fragment for one worker field.
 * @param name - Field name
 * @param recorded - Recorded value
 * @param current - Current value
 * @returns Drift fragment, or null when unchanged/unobservable
 */
function compareWorkerField(
  name: string,
  recorded: string | null,
  current: string
): string | null {
  if (!recorded || current === "unknown" || recorded === current) {
    return null;
  }
  return `${name} recorded ${recorded} now ${current}`;
}

/**
 * Count local rules/skills whose rationale mentions worker-specific workarounds.
 * @param targetPath - Project path to scan
 * @returns Number of candidate files
 */
async function countWorkerWorkaroundCandidates(
  targetPath: string
): Promise<number> {
  const roots = [
    path.join(targetPath, "plugins", "src", "base", "rules"),
    path.join(targetPath, "plugins", "src", "base", "skills"),
  ];
  const counts = await Promise.all(
    roots.map(root => countMatchingMarkdownFiles(root, isWorkerWorkaround))
  );
  return counts.reduce((total, count) => total + count, 0);
}

/**
 * Determine whether a markdown file describes a worker workaround.
 * @param content - Markdown content
 * @returns True when content is a subtraction-pass candidate
 */
function isWorkerWorkaround(content: string): boolean {
  return /\b(model|worker|host|epoch|claude|codex|cursor|opencode|copilot|agy)\b[\s\S]{0,160}\b(workaround|limitation|quirk|scaffold|temporary|native capability)\b/iu.test(
    content
  );
}

/**
 * Recursively count markdown files matching a predicate.
 * @param directory - Directory to scan
 * @param predicate - Markdown content predicate
 * @returns Number of matching files
 */
async function countMatchingMarkdownFiles(
  directory: string,
  predicate: (content: string) => boolean
): Promise<number> {
  if (!existsSync(directory)) {
    return 0;
  }
  const counts = await Promise.all(
    (await readdir(directory)).map(async entry => {
      const entryPath = path.join(directory, entry);
      const entryStat = await stat(entryPath);
      if (entryStat.isDirectory()) {
        return countMatchingMarkdownFiles(entryPath, predicate);
      }
      if (
        entry.endsWith(".md") &&
        predicate(await readFile(entryPath, "utf8"))
      ) {
        return 1;
      }
      return 0;
    })
  );
  return counts.reduce((total, count) => total + count, 0);
}

/**
 * Narrow unknown JSON values to plain records.
 * @param value - Value to inspect
 * @returns True for plain object records
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a possibly empty string field.
 * @param value - Value to normalize
 * @returns Trimmed string or null
 */
function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

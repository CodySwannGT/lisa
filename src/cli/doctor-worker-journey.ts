/**
 * The shared worker-epoch journey runner (RRR-6, #1858).
 *
 * #1742 shipped requalification journeys inside `lisa doctor`
 * (`doctor-worker-epoch.ts`): it reads `.lisa/worker-config.json`, compares the
 * recorded qualified epoch against the current runtime signature, reads the
 * recorded `qualificationEvidence`, and surfaces scaffolding-subtraction
 * candidates. RRR-6 must connect that same machinery to the readiness verdict
 * *without building a second harness* (intake decision F5). This module is the
 * extraction: the primitives both the epoch-drift path (`checkWorkerEpoch`) and
 * the readiness execution/proof dimension consume, so there is exactly one
 * journey runner. `checkWorkerEpoch` keeps its byte-identical output by calling
 * these helpers; readiness calls {@link resolveWorkerJourneyEvidence} on top of
 * them. Nothing here files tickets or drives a browser — journey selection and
 * mutation policy live in `lisa-use-the-product`; this only resolves the worker
 * record and the evidence it already carries.
 * @module cli/doctor-worker-journey
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import process from "node:process";

/** One worker entry from `.lisa/worker-config.json`. */
export interface WorkerEpochAgentRecord {
  id?: unknown;
  host?: unknown;
  version?: unknown;
  model?: unknown;
  modelId?: unknown;
  qualificationEvidence?: unknown;
  evidence?: unknown;
  qualifiedAt?: unknown;
  recordedAt?: unknown;
}

/** Supported top-level worker epoch record shapes. */
export interface WorkerEpochRecord {
  agents?: unknown;
  workers?: unknown;
}

/** Current runtime identity used for epoch comparison. */
export interface RuntimeWorkerSignature {
  host: string;
  model: string;
  version: string;
}

/**
 * The consolidated journey-evidence resolution for the current worker, shared by
 * the epoch-drift path and the readiness execution/proof dimension so both read
 * one source of truth.
 */
export interface WorkerJourneyEvidence {
  /** Absolute path to `.lisa/worker-config.json`. */
  readonly recordPath: string;
  /** Whether `.lisa/worker-config.json` exists on disk. */
  readonly recordExists: boolean;
  /** A parse error message when the record is present but not valid JSON. */
  readonly parseError: string | null;
  /** The current runtime worker signature (host/model/version). */
  readonly signature: RuntimeWorkerSignature;
  /** The recorded worker entry matching the current host, if any. */
  readonly matched: WorkerEpochAgentRecord | undefined;
  /** The recorded qualification-evidence pointer, or null when absent. */
  readonly evidence: string | null;
  /** Human-readable model/version drift fragments (empty when in sync). */
  readonly drift: readonly string[];
  /** #1742's scaffolding-subtraction candidate count (surfaced, never deleted). */
  readonly subtractionCount: number;
}

/**
 * Resolve the shared journey evidence for the current worker: read the record,
 * find the entry for this host, and compute drift, evidence, and the
 * subtraction-candidate count in one pass. This is the single journey runner
 * both #1742's epoch-drift path and RRR-6's readiness dimension consume — no
 * second harness. It never throws: an unreadable record degrades to
 * `parseError`, and a missing record to `recordExists: false`.
 * @param targetPath - Project path to inspect
 * @returns The consolidated worker journey evidence
 */
export async function resolveWorkerJourneyEvidence(
  targetPath: string
): Promise<WorkerJourneyEvidence> {
  const recordPath = path.join(targetPath, ".lisa", "worker-config.json");
  const signature = currentRuntimeWorkerSignature();
  const subtractionCount = await countWorkerWorkaroundCandidates(targetPath);
  const base = {
    recordPath,
    signature,
    subtractionCount,
    matched: undefined,
    evidence: null,
    drift: [] as readonly string[],
  };
  if (!existsSync(recordPath)) {
    return { ...base, recordExists: false, parseError: null };
  }
  try {
    const record = JSON.parse(
      await readFile(recordPath, "utf8")
    ) as WorkerEpochRecord;
    const matched = findWorkerRecordForHost(
      normalizeWorkerAgents(record),
      signature
    );
    return {
      ...base,
      recordExists: true,
      parseError: null,
      matched,
      evidence: matched ? resolveRecordedEvidence(matched) : null,
      drift: matched ? computeWorkerDrift(matched, signature) : [],
    };
  } catch (error) {
    return {
      ...base,
      recordExists: true,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Infer a stable worker signature from explicit Lisa variables first, falling
 * back to `LISA_REMOTE_AGENT` (set by the remote-agent bootstrap for Cursor,
 * Copilot, OpenCode, and Antigravity) and then Codex/Claude-specific markers.
 * @returns Current runtime signature
 */
export function currentRuntimeWorkerSignature(): RuntimeWorkerSignature {
  const env = process["env"];
  const host =
    env.LISA_WORKER_HOST ??
    env.LISA_REMOTE_AGENT ??
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
 * Normalize object- and array-shaped worker records into one array.
 * @param record - Parsed worker epoch record
 * @returns Normalized worker entries
 */
export function normalizeWorkerAgents(
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
 * Find the recorded worker entry whose host matches the current signature.
 * @param agents - Normalized worker entries
 * @param signature - Current runtime worker signature
 * @returns The matching worker entry, or undefined
 */
export function findWorkerRecordForHost(
  agents: readonly WorkerEpochAgentRecord[],
  signature: RuntimeWorkerSignature
): WorkerEpochAgentRecord | undefined {
  return agents.find(
    agent =>
      typeof agent.host === "string" &&
      agent.host.toLowerCase() === signature.host
  );
}

/**
 * Compute the model/version drift fragments between a recorded worker entry and
 * the current runtime signature. An empty array means the epoch is in sync.
 * @param record - Recorded worker entry for the current host
 * @param signature - Current runtime worker signature
 * @returns Human-readable drift fragments
 */
export function computeWorkerDrift(
  record: WorkerEpochAgentRecord,
  signature: RuntimeWorkerSignature
): string[] {
  const recordedModel = stringField(record.modelId ?? record.model);
  const recordedVersion = stringField(record.version);
  return [
    compareWorkerField("model", recordedModel, signature.model),
    compareWorkerField("version", recordedVersion, signature.version),
  ].filter((entry): entry is string => entry !== null);
}

/**
 * Resolve the recorded qualification-evidence pointer for a worker entry.
 * @param record - Recorded worker entry
 * @returns Trimmed evidence pointer, or null when absent
 */
export function resolveRecordedEvidence(
  record: WorkerEpochAgentRecord
): string | null {
  return stringField(record.qualificationEvidence ?? record.evidence);
}

/**
 * Return a human-readable drift fragment for one worker field.
 * @param name - Field name
 * @param recorded - Recorded value
 * @param current - Current value
 * @returns Drift fragment, or null when unchanged/unobservable
 */
export function compareWorkerField(
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
export async function countWorkerWorkaroundCandidates(
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
  return /\b(model|worker|host|epoch|claude|codex|cursor|opencode|copilot|agy|antigravity)\b[\s\S]{0,160}\b(workaround|limitation|quirk|scaffold|temporary|native capability)\b/iu.test(
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
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalize a possibly empty string field.
 * @param value - Value to normalize
 * @returns Trimmed string or null
 */
export function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

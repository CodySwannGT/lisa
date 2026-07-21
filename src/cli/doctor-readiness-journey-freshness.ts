/**
 * Freshness and mutation-policy helpers for the readiness journey wiring
 * (RRR-6, #1858).
 *
 * Split out of `doctor-readiness-journey.ts` for file-size hygiene: this module
 * owns the two gates that decide *whether* a representative journey runs — the
 * per-environment mutation policy read from `.lisa.config.json` (mirroring
 * `lisa-use-the-product`'s gate, which readiness never overrides) and the
 * freshness contract that decides when recorded qualification evidence may be
 * reused instead of re-running a journey (same worker signature, evidence newer
 * than the current artifact head).
 * @module cli/doctor-readiness-journey-freshness
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type { WorkerJourneyEvidence } from "./doctor-worker-journey.js";

const execFileAsync = promisify(execFile);

/** The per-environment mutation policy from `.lisa.config.json` `exploration`. */
export type MutationPolicy = "forbidden" | "read-only" | "full";

/**
 * Resolve the per-environment mutation policy from an already-parsed config,
 * mirroring `lisa-use-the-product`'s gate: default `read-only`; a production-
 * named env defaults to `forbidden` and may only be raised to `full` with a
 * written `prodMutationAck`.
 * @param config - Parsed `.lisa.config.json` contents
 * @returns The resolved mutation policy
 */
export function resolveMutationPolicy(config: unknown): MutationPolicy {
  const exploration = isRecord(config) ? config.exploration : undefined;
  if (!isRecord(exploration)) {
    return "read-only";
  }
  const environments = isRecord(exploration.environments)
    ? exploration.environments
    : {};
  const envName =
    typeof exploration.default === "string" ? exploration.default : "default";
  const envConfig = isRecord(environments[envName])
    ? (environments[envName] as Record<string, unknown>)
    : undefined;
  const level =
    envConfig && typeof envConfig.mutation === "string"
      ? envConfig.mutation
      : undefined;
  const ack =
    envConfig && typeof envConfig.prodMutationAck === "string"
      ? envConfig.prodMutationAck.trim() !== ""
      : false;
  return normalizeMutationLevel(envName, level, ack);
}

/**
 * Resolve the mutation policy for a path by reading `.lisa.config.json`.
 * @param targetPath - Project path to read config from
 * @returns The resolved mutation policy (read-only when unreadable)
 */
export async function resolveMutationPolicyForPath(
  targetPath: string
): Promise<MutationPolicy> {
  const configPath = path.join(targetPath, ".lisa.config.json");
  if (!existsSync(configPath)) {
    return "read-only";
  }
  try {
    return resolveMutationPolicy(
      JSON.parse(await readFile(configPath, "utf8"))
    );
  } catch {
    return "read-only";
  }
}

/**
 * Determine whether recorded qualification evidence is fresh enough to reuse:
 * the epoch is in sync (no drift), evidence is present, and it is newer than the
 * current artifact head. When the artifact head cannot be resolved, freshness
 * falls back to "no drift and evidence present" (the shipped #1742 notion).
 * @param evidence - Resolved worker journey evidence
 * @param targetPath - Project path (for git artifact-head resolution)
 * @param artifactHeadOverride - Injected artifact head (skips git resolution)
 * @returns True when the evidence may be reused without a new journey
 */
export async function isQualificationEvidenceFresh(
  evidence: WorkerJourneyEvidence,
  targetPath: string,
  artifactHeadOverride?: Date | null
): Promise<boolean> {
  if (evidence.evidence === null || evidence.drift.length > 0) {
    return false;
  }
  const artifactHead =
    artifactHeadOverride ?? (await resolveArtifactHead(targetPath));
  if (artifactHead === null) {
    // Cannot compare to the artifact head: fall back to the #1742 notion.
    return true;
  }
  const evidenceTime = await resolveEvidenceTimestamp(evidence);
  return (
    evidenceTime !== null && evidenceTime.getTime() >= artifactHead.getTime()
  );
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
 * Normalize a raw mutation level for a resolved environment, applying the
 * production carve-out.
 * @param envName - Resolved environment name
 * @param level - Raw mutation level from config
 * @param hasAck - Whether a non-empty prodMutationAck is present
 * @returns The normalized mutation policy
 */
function normalizeMutationLevel(
  envName: string,
  level: string | undefined,
  hasAck: boolean
): MutationPolicy {
  const isProduction = /^prod(uction)?$/iu.test(envName);
  if (isProduction) {
    if (level === "full" && hasAck) {
      return "full";
    }
    return "forbidden";
  }
  if (level === "forbidden" || level === "full" || level === "read-only") {
    return level;
  }
  return "read-only";
}

/**
 * Resolve the artifact-head timestamp from the git HEAD commit time.
 * @param targetPath - Project path to inspect
 * @returns The HEAD commit time, or null when it cannot be resolved
 */
async function resolveArtifactHead(targetPath: string): Promise<Date | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", targetPath, "log", "-1", "--format=%cI"],
      { encoding: "utf8" }
    );
    const parsed = new Date(stdout.trim());
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve a timestamp for recorded qualification evidence: an explicit
 * `qualifiedAt`/`recordedAt` on the worker entry, else the mtime of
 * `.lisa/worker-config.json`.
 * @param evidence - Resolved worker journey evidence
 * @returns The evidence timestamp, or null when it cannot be resolved
 */
async function resolveEvidenceTimestamp(
  evidence: WorkerJourneyEvidence
): Promise<Date | null> {
  const explicit = readTimestampField(evidence.matched);
  if (explicit !== null) {
    return explicit;
  }
  try {
    return (await stat(evidence.recordPath)).mtime;
  } catch {
    return null;
  }
}

/**
 * Read an explicit `qualifiedAt`/`recordedAt` timestamp from a worker entry.
 * @param matched - The matched worker entry, if any
 * @returns The parsed timestamp, or null when absent/unparseable
 */
function readTimestampField(matched: unknown): Date | null {
  if (!isRecord(matched)) {
    return null;
  }
  const raw = matched.qualifiedAt ?? matched.recordedAt;
  if (typeof raw !== "string") {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

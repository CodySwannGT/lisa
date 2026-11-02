/**
 * `lisa doctor` check: does this repository's seeded third-party review
 * evidence workflow still run now that the reviewer reports through a check
 * run?
 *
 * The workflow woke only on `status` events. A reviewer that reports through a
 * check run fires none, so the workflow stopped running in every repository it
 * was seeded into, and nothing said so — a workflow that never starts produces
 * no red run to notice (CodySwannGT/lisa#4553). The seed is fixed, but it is
 * `create-only`: Lisa wrote it once, the host owns it, and `lisa apply` never
 * refreshes it.
 *
 * This check REPORTS and names the exact lines to add. It edits nothing, for
 * the reason `doctor-skip-jobs-migration` gives: `lisa apply` runs on
 * postinstall, and a repair that edits a host-owned workflow there and gets it
 * wrong is silent. `retireUnmodified` can only delete, and nothing upgrades a
 * create-only file in place. The prover the workflow runs is copy-overwrite, so
 * it is already current; only the workflow's own trigger and token are stale.
 *
 * Every filesystem answer is three-valued — present, absent, or
 * undeterminable — and the last one fails rather than passing quietly: a
 * workflow this check could not read is not a workflow with nothing missing.
 * @module cli/doctor-third-party-evidence-seed
 */
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import {
  readEvidenceSeed,
  THIRD_PARTY_EVIDENCE_WORKFLOW,
  type EvidenceSeedReading,
} from "../core/third-party-evidence-seed.js";
import type { DoctorCheck } from "./doctor.js";

/** Name of the check as doctor reports it. */
export const THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME =
  "Third-party review evidence wakes on check runs?";

/** Where the current seed ships inside the package, for a full comparison. */
const SHIPPED_SEED =
  "typescript/create-only/.github/workflows/third-party-review-evidence.yml";

/**
 * Errno codes that ANSWER the question rather than refusing it: the file is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look.
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/** The trigger lines to add under `on:`. */
export const CHECK_RUN_TRIGGER_LINES = [
  "  check_run:",
  "    types: [completed]",
] as const;

/** The permission line to add under `permissions:`. */
export const CHECKS_READ_LINE = "  checks: read";

/**
 * Read the workflow, REJECTING when the filesystem declines to say.
 * @param projectRoot - Absolute project root
 * @returns Workflow source, or null when the file is provably absent
 * @throws {Error} When the file exists but could not be read
 */
async function readWorkflow(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(
      path.join(projectRoot, THIRD_PARTY_EVIDENCE_WORKFLOW),
      "utf8"
    );
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code !== undefined && ABSENT_CODES.has(code)) return null;
    throw new Error(
      `could not read ${THIRD_PARTY_EVIDENCE_WORKFLOW}: ${code ?? String(error)}`,
      { cause: error }
    );
  }
}

/**
 * The operator-facing finding and its exact remedy.
 *
 * The trigger alone is not a working repair. On a `check_run` event the commit
 * is `github.event.check_run.head_sha` and the reviewer is
 * `github.event.check_run.name`; a copy that still reads only
 * `github.event.sha` would start, pass an empty `--sha`, and fail on every
 * check run. So the remedy names those edits with the trigger.
 * @param reading - What the workflow does about check runs
 * @returns The detail line for a stale copy
 */
export function describeStaleSeed(reading: EvidenceSeedReading): string {
  const gaps = [
    ...(reading.wakesOnCheckRun
      ? []
      : [
          "it has no `check_run` trigger, so it never starts when the reviewer reports through a check run",
        ]),
    ...(reading.readsChecks
      ? []
      : [
          "it does not grant `checks: read`, so its prover cannot read the reviewer's check run",
        ]),
  ];
  const lines = [
    `${THIRD_PARTY_EVIDENCE_WORKFLOW} cannot see a reviewer that reports through a check run: ${gaps.join("; and ")}. ` +
      "Lisa seeded this file once and will not rewrite it; the prover it runs is already current. Add these lines:",
    ...(reading.wakesOnCheckRun
      ? []
      : ["under `on:`", ...CHECK_RUN_TRIGGER_LINES]),
    ...(reading.readsChecks ? [] : ["under `permissions:`", CHECKS_READ_LINE]),
    ...(reading.wakesOnCheckRun
      ? []
      : [
          "Then read the commit and the reviewer from the check run on that event: " +
            "where the file reads `github.event.sha || inputs.sha` (the checkout ref, the concurrency group and EVIDENCE_SHA), read " +
            "`github.event.check_run.head_sha || github.event.sha || inputs.sha`, and where it reads " +
            "`github.event.context`, read `github.event.check_run.name || github.event.context`.",
        ]),
    `The current seed, ${SHIPPED_SEED} in the @codyswann/lisa package, is the full reference.`,
  ];
  return lines.join("\n");
}

/**
 * Report whether the seeded evidence workflow wakes on, and can read, the
 * reviewer's check run.
 *
 * Warns rather than fails on a stale copy: the remedy is an edit to a
 * host-owned file, and nothing about the project is broken locally. Fails when
 * the question could not be answered.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkThirdPartyEvidenceSeed(
  targetPath: string
): Promise<DoctorCheck> {
  try {
    const root = await stat(targetPath);
    if (!root.isDirectory()) {
      throw new Error(`${targetPath} is not a directory`);
    }
    const workflowText = await readWorkflow(targetPath);
    if (workflowText === null) {
      return ok(`No ${THIRD_PARTY_EVIDENCE_WORKFLOW} in this project`);
    }
    const reading = readEvidenceSeed(workflowText);
    if (reading.wakesOnCheckRun && reading.readsChecks) {
      return ok(
        `${THIRD_PARTY_EVIDENCE_WORKFLOW} wakes on a completed check run and its token can read it`
      );
    }
    return {
      name: THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME,
      status: "warn",
      detail: describeStaleSeed(reading),
    };
  } catch (error) {
    return {
      name: THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME,
      status: "fail",
      detail:
        `Could not determine whether ${THIRD_PARTY_EVIDENCE_WORKFLOW} wakes ` +
        `on check runs: ${
          error instanceof Error ? error.message : String(error)
        }. Treated as a failure rather than a pass: a workflow that could ` +
        "not be read is not one with nothing missing",
    };
  }
}

/**
 * A passing line for this check.
 * @param detail - What was found
 * @returns Doctor check result
 */
function ok(detail: string): DoctorCheck {
  return { name: THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME, status: "ok", detail };
}

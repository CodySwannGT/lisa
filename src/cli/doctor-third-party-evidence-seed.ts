/**
 * `lisa doctor` check: does this repository's seeded third-party review
 * evidence workflow still run — and judge safely — now that the reviewer
 * reports through a check run?
 *
 * The workflow woke only on `status` events. A reviewer that reports through a
 * check run fires none, so the workflow stopped running in every repository it
 * was seeded into, and nothing said so — a workflow that never starts produces
 * no red run to notice (CodySwannGT/lisa#4553). The seed is fixed, but it is
 * `create-only`: Lisa wrote it once, the host owns it, and `lisa apply` never
 * refreshes it.
 *
 * This check REPORTS and names the exact lines to change. It edits nothing, for
 * the reason `doctor-skip-jobs-migration` gives: `lisa apply` runs on
 * postinstall, and a repair that edits a host-owned workflow there and gets it
 * wrong is silent. `retireUnmodified` can only delete, and nothing upgrades a
 * create-only file in place. The prover the workflow runs is copy-overwrite, so
 * it is already current; only the workflow's own trigger, token, wiring and
 * checkout are stale.
 *
 * Every filesystem answer is three-valued — present, absent, or
 * undeterminable — and the last one fails rather than passing quietly: a
 * workflow this check could not read is not a workflow with nothing missing.
 * @module cli/doctor-third-party-evidence-seed
 */
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import {
  CHECK_RUN_HEAD,
  CHECK_RUN_NAME,
  isCurrentEvidenceSeed,
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

/** The commit to judge, from whichever event woke the run. */
const SHA_EXPRESSION = `\${{ ${CHECK_RUN_HEAD} || github.event.sha || inputs.sha }}`;

/** The reviewer to judge, from whichever event woke the run. */
const CONTEXT_EXPRESSION = `\${{ ${CHECK_RUN_NAME} || github.event.context }}`;

/** The trigger lines to add under `on:`. */
export const CHECK_RUN_TRIGGER_LINES = [
  "  check_run:",
  "    types: [completed]",
] as const;

/** The permission line to add under an existing `permissions:` block. */
export const CHECKS_READ_LINE = "  checks: read";

/** The whole block, for a copy that declares no `permissions:` at all. */
export const PERMISSIONS_BLOCK_LINES = [
  "permissions:",
  "  contents: read",
  "  statuses: read",
  CHECKS_READ_LINE,
  "  pull-requests: read",
] as const;

/** The values that carry the run's commit and reviewer to the prover. */
export const RUN_IDENTITY_LINES = [
  `  EVIDENCE_SHA: ${SHA_EXPRESSION}`,
  `  EVIDENCE_CONTEXT: ${CONTEXT_EXPRESSION}`,
  `  group: third-party-review-evidence-\${{ github.event_name }}-${SHA_EXPRESSION}-${CONTEXT_EXPRESSION}`,
] as const;

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
 * The plain-language gaps a copy has, in the order an operator fixes them.
 * @param reading - What the copy does
 * @returns One clause per gap
 */
function gapsOf(reading: EvidenceSeedReading): string[] {
  return [
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
    ...(reading.readsRunIdentity
      ? []
      : [
          "it never reads the check run's head SHA and name, so on a check run it would pass an empty --sha and judge nothing",
        ]),
    ...(reading.checksOutEventHead
      ? [
          "it checks out the head of the event that woke it, so a pull request's own code — a fork's included — runs with this repository's token and cache scope",
        ]
      : []),
  ];
}

/**
 * The exact lines that grant `checks: read`.
 *
 * A copy with no `permissions:` block gets the whole block, not the one line:
 * a block holding only `checks: read` sets every other scope to none, and the
 * prover could then no longer find the pull request it is judging.
 * @param reading - What the copy does
 * @returns The permission remedy, or nothing when the grant is there
 */
function permissionRemedyOf(reading: EvidenceSeedReading): string[] {
  if (reading.readsChecks) return [];
  return reading.declaresPermissions
    ? ["Add under `permissions:`:", CHECKS_READ_LINE]
    : [
        "Add this block at the top level, where the file declares none:",
        ...PERMISSIONS_BLOCK_LINES,
      ];
}

/**
 * The exact lines that close each gap.
 * @param reading - What the copy does
 * @returns The remedy, one line per array entry
 */
function remedyOf(reading: EvidenceSeedReading): string[] {
  return [
    ...(reading.wakesOnCheckRun
      ? []
      : ["Add under `on:`:", ...CHECK_RUN_TRIGGER_LINES]),
    ...permissionRemedyOf(reading),
    ...(reading.readsRunIdentity
      ? []
      : [
          "Set these values — the first two in the prover step's `env:`, the third as the `concurrency:` group, so another app's check run cannot cancel the reviewer's:",
          ...RUN_IDENTITY_LINES,
        ]),
    ...(reading.checksOutEventHead
      ? [
          "Delete the `ref:` line under the `actions/checkout` step. The default branch is then checked out, and the commit to judge still arrives as --sha.",
        ]
      : []),
  ];
}

/**
 * The operator-facing finding and its exact remedy.
 * @param reading - What the copy does
 * @returns The detail for a stale copy
 */
export function describeStaleSeed(reading: EvidenceSeedReading): string {
  return [
    `${THIRD_PARTY_EVIDENCE_WORKFLOW} does not judge a reviewer that reports through a check run: ${gapsOf(reading).join("; and ")}. ` +
      "Lisa seeded this file once and will not rewrite it; the prover it runs is already current.",
    ...remedyOf(reading),
    `The current seed, ${SHIPPED_SEED} in the @codyswann/lisa package, is the full reference.`,
  ].join("\n");
}

/**
 * Report whether the seeded evidence workflow wakes on, can read, and safely
 * judges the reviewer's check run.
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
    if (isCurrentEvidenceSeed(reading)) {
      return ok(
        `${THIRD_PARTY_EVIDENCE_WORKFLOW} wakes on a completed check run, can read it, and judges it from the default branch`
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

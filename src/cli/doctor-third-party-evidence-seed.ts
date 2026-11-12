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
 * it is already current; only the workflow's own trigger, token, wiring,
 * checkout and steps are stale.
 *
 * A copy can also run and judge correctly and still show nobody its verdict:
 * one seeded before CodySwannGT/lisa#4630 ends its job on the prover's exit
 * code, and GitHub attaches that job's check run to the default branch's
 * latest commit rather than to the pull request head it judged. Such a copy is
 * reported with the two steps that save the verdict and publish it on the
 * head, and the `checks: write` grant that lets them.
 *
 * The copy-overwrite prover republishes a verdict under every declared
 * reviewer's name, so even a copy seeded before CodySwannGT/lisa#4738 clears a
 * stale reviewer check with a `sha`-only manual run. What such a copy lacks is
 * the `context` input: its manual run cannot target one reviewer's check and
 * always adds a bare-name check. It is reported with the input to add and the
 * `EVIDENCE_CONTEXT` and concurrency lines that read it.
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
  DISPATCH_CONTEXT,
  isCurrentEvidenceSeed,
  readEvidenceSeed,
  THIRD_PARTY_EVIDENCE_WORKFLOW,
  type EvidenceSeedReading,
} from "../core/third-party-evidence-seed.js";
import { errnoCode, isDefinitiveAbsence } from "../utils/fs-absence.js";
import type { DoctorCheck } from "./doctor.js";
import { EVIDENCE_STEPS_LINES } from "./doctor-third-party-evidence-steps.js";

/** Name of the check as doctor reports it. */
export const THIRD_PARTY_EVIDENCE_SEED_CHECK_NAME =
  "Third-party review evidence wakes on check runs?";

/** Where the current seed ships inside the package, for a full comparison. */
const SHIPPED_SEED =
  "typescript/create-only/.github/workflows/third-party-review-evidence.yml";

/** The commit to judge, from whichever event woke the run. */
const SHA_EXPRESSION = `\${{ ${CHECK_RUN_HEAD} || github.event.sha || inputs.sha }}`;

/** The reviewer to judge, from whichever event woke the run or a manual run's input. */
const CONTEXT_EXPRESSION = `\${{ ${CHECK_RUN_NAME} || github.event.context || ${DISPATCH_CONTEXT} }}`;

/**
 * The `workflow_dispatch` input that lets a manual run name the reviewer whose
 * stale check run it brings up to date, beside the existing `sha:` input.
 */
export const DISPATCH_CONTEXT_INPUT_LINES = [
  "      context:",
  "        description: 'Optional. One reviewer context (its status or check-run name, matched exactly against a declared reviewer; anything else publishes nothing) whose check run to bring up to date. Empty republishes every declared reviewer and the bare name'",
  "        required: false",
  "        type: string",
] as const;

/** The trigger lines to add under `on:`. */
export const CHECK_RUN_TRIGGER_LINES = [
  "  check_run:",
  "    types: [completed]",
] as const;

/**
 * The permission line to set under an existing `permissions:` block. `write`
 * includes reading, so it replaces a `checks: read` line rather than joining it.
 */
export const CHECKS_WRITE_LINE = "  checks: write";

/** The whole block, for a copy missing any scope the prover reads with. */
export const PERMISSIONS_BLOCK_LINES = [
  "permissions:",
  "  contents: read",
  "  statuses: read",
  CHECKS_WRITE_LINE,
  "  pull-requests: read",
] as const;

export { EVIDENCE_STEPS_LINES };

/** The values that carry the run's commit and reviewer to the prover. */
export const RUN_IDENTITY_LINES = [
  "    env:",
  `      EVIDENCE_SHA: ${SHA_EXPRESSION}`,
  `      EVIDENCE_CONTEXT: ${CONTEXT_EXPRESSION}`,
] as const;

/** The concurrency key that keeps one run from cancelling another's verdict. */
export const CONCURRENCY_GROUP_LINE = `  group: third-party-review-evidence-\${{ github.event_name }}-${SHA_EXPRESSION}-${CONTEXT_EXPRESSION}`;

/** The whole top-level `concurrency:` block, as the seed ships it. */
export const CONCURRENCY_BLOCK_LINES = [
  "concurrency:",
  CONCURRENCY_GROUP_LINE,
  "  cancel-in-progress: true",
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
    if (isDefinitiveAbsence(error)) return null;
    const code = errnoCode(error);
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
    ...checksGapOf(reading),
    ...(reading.readsStatusesAndPullRequests
      ? []
      : [
          "its token cannot read statuses and pull requests, so every run would read as not being a pull request head and judge nothing",
        ]),
    ...(reading.readsRunIdentity
      ? []
      : [
          "it never reads the check run's head SHA and name, so on a check run it would pass an empty --sha and judge nothing",
        ]),
    ...(reading.keysConcurrencyPerRun
      ? []
      : [
          "its concurrency group is not keyed on the check run's head and name, so any app's check run can cancel the run judging the reviewer",
        ]),
    ...(reading.checksOutEventHead
      ? [
          "it checks out the head of the event that woke it, so a pull request's own code — a fork's included — runs with this repository's token and cache scope",
        ]
      : []),
    ...(reading.publishesVerdict
      ? []
      : [
          "it never publishes its verdict on the pull request head it judged, so the verdict lands only on the default branch's latest commit, where no pull request shows it",
        ]),
    ...(reading.acceptsDispatchContext
      ? []
      : [
          "its manual run takes no `context` input, so a manual run cannot target one reviewer's check run: it republishes every declared reviewer's check and always adds a bare-name check beside them",
        ]),
  ];
}

/**
 * The exact lines that let a manual run name its reviewer.
 *
 * The `EVIDENCE_CONTEXT` and concurrency lines are printed here only when no
 * other remedy already prints them, so each line appears once.
 * @param reading - What the copy does
 * @returns The remedy, or nothing when a manual run can name its reviewer
 */
function dispatchContextRemedyOf(reading: EvidenceSeedReading): string[] {
  if (reading.acceptsDispatchContext) return [];
  const identityPrinted = !(
    reading.readsRunIdentity && reading.publishesVerdict
  );
  return [
    "Add under `workflow_dispatch:` `inputs:`, beside `sha:`:",
    ...DISPATCH_CONTEXT_INPUT_LINES,
    ...(identityPrinted
      ? []
      : [
          "Set `EVIDENCE_CONTEXT` in the evidence job's `env:` to:",
          RUN_IDENTITY_LINES[2],
        ]),
    // A copy with no `concurrency:` block also reads as keyed per run, so the
    // whole block is printed: a bare `group:` line has nowhere to go there.
    ...(reading.keysConcurrencyPerRun
      ? [
          "Make the top-level `concurrency:` block read (add it if the file has none):",
          ...CONCURRENCY_BLOCK_LINES,
        ]
      : []),
  ];
}

/**
 * The gap in what the token may do with check runs, if any.
 * @param reading - What the copy does
 * @returns One clause, or none
 */
function checksGapOf(reading: EvidenceSeedReading): string[] {
  if (!reading.readsChecks) {
    return [
      "it does not grant `checks: write`, so its prover cannot read the reviewer's check run, and its verdict cannot be published on the pull request head",
    ];
  }
  return reading.writesChecks
    ? []
    : [
        "it grants `checks: read` but not `checks: write`, so its verdict cannot be published on the pull request head it judged",
      ];
}

/**
 * The exact lines that grant what the prover reads with.
 *
 * Only a copy whose block already reads statuses and pull requests gets the one
 * `checks: write` line, in place of any `checks: read`. Every other copy gets
 * the whole block: a block holding only `checks: write` sets every other scope
 * to none, and the prover could then no longer find the pull request it is
 * judging.
 * @param reading - What the copy does
 * @returns The permission remedy, or nothing when the grants are there
 */
function permissionRemedyOf(reading: EvidenceSeedReading): string[] {
  if (reading.writesChecks && reading.readsStatusesAndPullRequests) return [];
  if (reading.declaresPermissions && reading.readsStatusesAndPullRequests) {
    return [
      reading.readsChecks
        ? "Add under `permissions:`, in place of `checks: read`:"
        : "Add under `permissions:`:",
      CHECKS_WRITE_LINE,
    ];
  }
  return [
    reading.declaresPermissions
      ? "Make the `permissions:` block that governs the prover's job read:"
      : "Add this block at the top level, where the file declares none:",
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
    // The shipped steps read the run's identity from the job, so a copy
    // taking them needs these values there even if its old step had them.
    ...(reading.readsRunIdentity && reading.publishesVerdict
      ? []
      : [
          "Set these values in the evidence job's own `env:` (beside `runs-on:`), where both the prover and publish steps read them, and remove them from any step's `env:`:",
          ...RUN_IDENTITY_LINES,
        ]),
    ...(reading.keysConcurrencyPerRun
      ? []
      : ["Set the `concurrency:` group to:", CONCURRENCY_GROUP_LINE]),
    ...(reading.checksOutEventHead
      ? [
          "Delete the `ref:` line under the `actions/checkout` step. The default branch is then checked out, and the commit to judge still arrives as --sha.",
        ]
      : []),
    ...(reading.publishesVerdict
      ? []
      : [
          "Replace the prover step with these two steps: the first saves the verdict, the second publishes it on the head it judged.",
          ...EVIDENCE_STEPS_LINES,
        ]),
    ...dispatchContextRemedyOf(reading),
  ];
}

/**
 * The operator-facing finding and its exact remedy.
 * @param reading - What the copy does
 * @returns The detail for a stale copy
 */
export function describeStaleSeed(reading: EvidenceSeedReading): string {
  return [
    `${THIRD_PARTY_EVIDENCE_WORKFLOW} is not ready for a reviewer that reports through a check run, or for its verdict to reach the pull request: ${gapsOf(reading).join("; and ")}. ` +
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
        `${THIRD_PARTY_EVIDENCE_WORKFLOW} wakes on a completed check run, can read it, judges it from the default branch, publishes its verdict on the head it judged, and lets a manual run that names the reviewer bring that reviewer's check run up to date`
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

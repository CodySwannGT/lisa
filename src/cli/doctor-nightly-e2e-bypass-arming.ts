/**
 * Doctor check: a nightly-E2E bypass caller re-evaluates when the pull-request
 * BODY changes, so a waiver's evidence cannot be deleted under a green check.
 *
 * ## What goes wrong without this
 *
 * A valid bypass needs TWO pieces of evidence, and the guard re-checks both on
 * every evaluation: the bypass label, and a `Nightly-E2E-Bypass: <ticket>
 * <reason>` line in the pull-request body. The caller subscribes to
 * `labeled`/`unlabeled`, so deleting the label re-fires the gate. If it does
 * not subscribe to `edited`, deleting the BODY line fires nothing — a body
 * rewrite raises `edited` and nothing else — and the SUCCESS check-run computed
 * from the old body stands, merge-eligible, on evidence that no longer exists.
 *
 * Measured on a caller repo in the portfolio: 49m47s of a green required check
 * vouching for a waiver that was not in the pull request any more, with the
 * merge landing inside that window. It surfaced only because somebody opened
 * the body for an unrelated reason.
 *
 * ## Why a doctor check, when a migration already repairs this
 *
 * The migration reaches the installed base once, on upgrade. It cannot see a
 * consumer who later hand-edits `edited` back out of the list — deliberately,
 * or by reverting a file they own. That repo is then in exactly the original
 * state with no signal anywhere: the gate still runs, still reports, and is
 * merely half-armed. This check is what makes that visible.
 *
 * It shares `assessBodyChangeTrigger` with the migration and the template test,
 * so all three agree about what "armed" means rather than drifting apart.
 * @module cli/doctor-nightly-e2e-bypass-arming
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  assessBodyChangeTrigger,
  BODY_CHANGE_ACTIVITY_TYPE,
  type TriggerGap,
} from "../core/nightly-e2e-pull-request-triggers.js";
import type { DoctorCheck } from "./doctor.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "Nightly E2E bypass arming";

/** Job-level `uses:` pointing at the nightly health reusable — the merge gate. */
const HEALTH_CALLER =
  /^[ \t]*uses:\s*["']?CodySwannGT\/lisa\/\.github\/workflows\/nightly-e2e-health\.ya?ml@/m;

/** One caller whose trigger list leaves the bypass gate half-armed. */
export interface BypassArmingFinding {
  /** Workflow file inside the project, relative to the project root. */
  readonly file: string;
  /** Why the gate does not re-evaluate on a body change. */
  readonly gap: TriggerGap;
  /** Operator-readable statement of what is wrong and what to do. */
  readonly problem: string;
}

/**
 * Every workflow file in a project's `.github/workflows` directory.
 * @param targetPath - Project root
 * @returns Absolute paths, empty when the directory is absent
 */
async function workflowFiles(targetPath: string): Promise<string[]> {
  const dir = path.join(targetPath, ".github", "workflows");
  const entries = await readdir(dir).catch(() => undefined);
  if (entries === undefined) return [];
  return entries
    .filter(name => /\.ya?ml$/.test(name))
    .map(name => path.join(dir, name));
}

/**
 * Explain one gap in the terms an operator has to act on.
 * @param gap - Why the caller is not armed
 * @returns Problem statement including the repair
 */
function problemFor(gap: TriggerGap): string {
  const repair =
    `add \`${BODY_CHANGE_ACTIVITY_TYPE}\` to \`on.pull_request.types\`, or run ` +
    "`lisa` to let the nightly-caller migration add it";
  if (gap === "types-absent") {
    return (
      "declares no `types:` for `pull_request`, and GitHub's implicit default " +
      "(opened, synchronize, reopened) does not include `edited` — so deleting " +
      `a waiver's body evidence re-evaluates nothing: ${repair}`
    );
  }
  return (
    "does not re-evaluate when the pull-request body changes, so a bypass " +
    "waiver's `Nightly-E2E-Bypass:` line can be deleted while the green check " +
    `it produced stays green and merge-eligible: ${repair}`
  );
}

/**
 * Find nightly health callers that do not re-evaluate on a body change.
 *
 * A caller with NO `pull_request` trigger is skipped rather than reported: it
 * gates no merge, so it is not this defect, and a check that fires on it would
 * be noise. A noisy check is one somebody switches off, which would cost more
 * than it finds.
 * @param targetPath - Project root
 * @returns Every finding, in file order
 */
export async function bypassArmingFindings(
  targetPath: string
): Promise<BypassArmingFinding[]> {
  const files = await workflowFiles(targetPath);
  const perFile = await Promise.all(
    files.map(async file => {
      const text = await readFile(file, "utf8").catch(() => "");
      if (!HEALTH_CALLER.test(text)) return [];
      const assessment = assessBodyChangeTrigger(text);
      if (assessment.armed) return [];
      if (
        assessment.gap === undefined ||
        assessment.gap === "pull-request-absent"
      ) {
        return [];
      }
      return [
        {
          file: path.relative(targetPath, file),
          gap: assessment.gap,
          problem: problemFor(assessment.gap),
        },
      ];
    })
  );
  return perFile.flat();
}

/**
 * Report nightly bypass callers whose gate is silently half-armed.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkNightlyE2eBypassArming(
  targetPath: string
): Promise<DoctorCheck> {
  const files = await workflowFiles(targetPath);
  if (files.length === 0) {
    // Absent, not clean. Saying so beats an "ok" that reads as a passed audit.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No .github/workflows directory, so no bypass caller to check",
    };
  }

  const findings = await bypassArmingFindings(targetPath);
  if (findings.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `Every nightly E2E bypass caller re-evaluates on a body change (${files.length} workflow file(s) scanned)`,
    };
  }

  const lines = findings
    .map(finding => `${finding.file} ${finding.problem}`)
    .join("; ");

  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `${findings.length} nightly bypass caller(s) half-armed: ${lines}.`,
  };
}

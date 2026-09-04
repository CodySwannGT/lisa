/**
 * Doctor check: every caller of a Lisa reusable workflow names a full-length
 * commit SHA, so "the rollout is complete" is a measurement rather than a claim.
 *
 * ## What it is measuring
 *
 * A ref that is not a 40-character SHA — `@main`, a version tag, a short SHA —
 * means this repository executes something other than the Lisa it installed.
 * With `@main` that is whatever landed on Lisa's default branch since the run
 * started; with a tag it is a release the project may be a major behind; with
 * a short SHA it is ambiguous, and several GitHub APIs answer a short SHA with
 * an empty result rather than an error.
 *
 * The pin is written by `ensure-pinned-reusable-workflow-refs` on every apply,
 * so a project that has been applied since the pinner shipped has none of
 * these. One that still does has not been reached, which is exactly the fact
 * this check exists to report: a repository still on a mutable ref is the unit
 * of work remaining in the rollout, and nothing else surfaces it.
 *
 * ## Why it does not check WHICH SHA
 *
 * Being one release behind is not the defect. That project self-heals on its
 * next apply and, in the meantime, runs a Lisa somebody reviewed. A project on
 * `@main` never self-heals into immutability and never ran a reviewed Lisa at
 * all. Reporting both as the same finding would bury the second in the first.
 *
 * ## Not the same question as action pinning
 *
 * `doctor-readiness-action-pins` wants third-party *step* actions pinned to a
 * full SHA. This is job-level `uses:` pointing at Lisa itself. The subjects
 * differ; since CodySwannGT/lisa#3893 the answer no longer does, because a
 * host project is a third party to Lisa in exactly the sense that guidance
 * means.
 * @module cli/doctor-reusable-workflow-refs
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  findReusableWorkflowRefs,
  isMutableRef,
} from "../core/reusable-workflow-pin.js";
import type { DoctorCheck } from "./doctor.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "Lisa reusable workflow refs";

/** One caller still naming something other than a full commit SHA. */
export interface RefFinding {
  /** Workflow file inside the project, relative to the project root. */
  file: string;
  /** The Lisa reusable being called. */
  reusable: string;
  /** The ref it currently uses. */
  ref: string;
  /** Operator-readable statement of what is wrong. */
  problem: string;
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
 * Describe what is wrong with a mutable ref, in the operator's terms.
 * @param ref - The ref the caller currently names
 * @returns A problem statement
 */
function refProblem(ref: string): string {
  if (/^[0-9a-f]{7,39}$/.test(ref)) {
    return (
      "is a SHORT commit SHA, which is ambiguous — pin the full 40 characters, " +
      "which is what GitHub's APIs answer questions about"
    );
  }
  return (
    `is the mutable ref \`@${ref}\`, so this repository runs whatever that ref ` +
    "points at when a run starts rather than the Lisa it installed; run " +
    "`lisa apply` to pin it at the installed version's commit"
  );
}

/**
 * Find callers still naming something other than a full-length commit SHA.
 * @param targetPath - Project root
 * @returns Every finding, in file order
 */
export async function reusableRefFindings(
  targetPath: string
): Promise<RefFinding[]> {
  const files = await workflowFiles(targetPath);
  const perFile = await Promise.all(
    files.map(async file => {
      // Matched as text rather than through a YAML parse: a caller whose YAML
      // is malformed still runs nothing and still needs reporting, and a parse
      // failure would silently drop the file from the audit — reporting a clean
      // project because it could not read one.
      const text = await readFile(file, "utf8").catch(() => "");
      return findReusableWorkflowRefs(text)
        .filter(reference => isMutableRef(reference))
        .map(reference => ({
          file: path.relative(targetPath, file),
          reusable: reference.workflow,
          ref: reference.ref,
          problem: refProblem(reference.ref),
        }));
    })
  );
  return perFile.flat();
}

/**
 * Report callers of Lisa's reusable workflows that are still mutable.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkReusableWorkflowRefs(
  targetPath: string
): Promise<DoctorCheck> {
  const files = await workflowFiles(targetPath);
  if (files.length === 0) {
    // Absent, not clean. Saying so beats an "ok" that reads as a passed audit.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No .github/workflows directory, so no callers to check",
    };
  }

  const findings = await reusableRefFindings(targetPath);
  if (findings.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `Every Lisa reusable workflow caller is pinned at a full commit SHA (${files.length} workflow file(s) scanned)`,
    };
  }

  const lines = findings
    .map(f => `${f.file} calls ${f.reusable}@${f.ref} — it ${f.problem}`)
    .join("; ");

  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `${findings.length} caller(s) are not pinned to a full commit SHA: ${lines}.`,
  };
}

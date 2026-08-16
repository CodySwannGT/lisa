/**
 * Doctor check: callers of Lisa's reusable workflows point at the ref their
 * role requires — `@main` for almost all of them, an immutable pin for the two
 * that are merge gates.
 *
 * ## Why `@main` is right for almost all of them
 *
 * Consumers tracking `@main` is an owner decision, and the rest of the gate
 * subsystem is built on it. The permission-scope baseline is frozen precisely
 * because "an installed caller is a snapshot of the past, so the property that
 * keeps it working is that the callee does not move", and a renamed required
 * context has to reach every consumer in one release. Both assume a caller
 * receives a change on its next run.
 *
 * A pinned caller breaks that silently, and silently is the problem: it keeps
 * running, keeps reporting, and stops receiving fixes. Nothing surfaces it.
 *
 * ## Why two of them are the opposite
 *
 * `nightly-e2e-health` and `nightly-e2e-report` produce a **required merge
 * gate** context. The thing deciding whether code may merge must not change
 * under you between two runs of the same pull request, so those callers pin an
 * immutable ref and `@main` is a defect there. That is a ratified exception
 * guarded by `tests/integration/nightly-e2e-{health,report}-workflow.test.ts`,
 * and the shipped templates carry the reasoning inline.
 *
 * So the rule is two-directional, and a check enforcing only "everything must
 * be `@main`" would delete a deliberate guarantee — which is exactly what the
 * first draft of this module did before those tests caught it.
 *
 * ## Not the same question as action pinning
 *
 * `doctor-readiness-action-pins` wants third-party *step* actions pinned to a
 * full SHA — supply-chain immutability for code Lisa does not control. This is
 * job-level `uses:` pointing at Lisa itself, where mutability is usually the
 * point. Opposite answers, different subjects.
 * @module cli/doctor-reusable-workflow-refs
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import type { DoctorCheck } from "./doctor.js";

/** Name rendered in the doctor report. */
const CHECK_NAME = "Lisa reusable workflow refs";

/** The ref an ordinary caller is expected to track. */
const EXPECTED_REF = "main";

/**
 * Reusables whose callers MUST pin an immutable ref instead of `@main`.
 *
 * Both produce a required merge-gate context, and a merge gate that can change
 * between two runs of the same pull request is not a gate. Guarded upstream by
 * `nightly-e2e-health-workflow.test.ts` and `nightly-e2e-report-workflow.test.ts`,
 * so this set cannot grow silently.
 */
const MERGE_GATE_REUSABLES = new Set([
  "nightly-e2e-health.yml",
  "nightly-e2e-report.yml",
]);

/** A ref that cannot move under a running pull request. */
const IMMUTABLE_REF = /^(v\d+\.\d+\.\d+|[0-9a-f]{40})$/;

/** Job-level `uses:` pointing at a Lisa reusable workflow, capturing the ref. */
const LISA_REUSABLE_USES =
  /uses:\s*["']?CodySwannGT\/lisa\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)@([^\s"']+)/g;

/** One caller pointing at the wrong kind of ref for its role. */
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
 * Judge one caller's ref against the role of the reusable it calls.
 * @param reusable - Reusable workflow file name
 * @param ref - The ref the caller uses
 * @returns A problem statement, or null when the ref is correct
 */
function refProblem(reusable: string, ref: string): string | null {
  if (MERGE_GATE_REUSABLES.has(reusable)) {
    if (IMMUTABLE_REF.test(ref)) return null;
    return (
      `produces a required merge-gate context, so it must pin an immutable ref ` +
      `(a version tag or a full SHA); \`@${ref}\` can change between two runs of ` +
      "the same pull request"
    );
  }
  if (ref === EXPECTED_REF) return null;
  return (
    `should track @${EXPECTED_REF}; a pinned caller keeps running and keeps ` +
    "reporting while it stops receiving fixes, so nothing surfaces the drift"
  );
}

/**
 * Find callers whose ref does not match the role of the reusable they call.
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
      return [...text.matchAll(LISA_REUSABLE_USES)].flatMap(match => {
        const [, reusable, ref] = match;
        if (reusable === undefined || ref === undefined) return [];
        const problem = refProblem(reusable, ref);
        if (problem === null) return [];
        return [
          { file: path.relative(targetPath, file), reusable, ref, problem },
        ];
      });
    })
  );
  return perFile.flat();
}

/**
 * Report callers of Lisa's reusable workflows using the wrong ref for their role.
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
      detail: `Every Lisa reusable workflow caller uses the ref its role requires (${files.length} workflow file(s) scanned)`,
    };
  }

  const lines = findings
    .map(f => `${f.file} calls ${f.reusable}@${f.ref} — it ${f.problem}`)
    .join("; ");

  return {
    name: CHECK_NAME,
    status: "fail",
    detail: `${findings.length} caller(s) use the wrong ref: ${lines}.`,
  };
}

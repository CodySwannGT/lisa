/**
 * Proves the threshold-ratchet gate fails CLOSED when its script is absent.
 *
 * MEASURED before this existed, on a real pull-request run in this repository —
 * job `🔍 Quality Checks / 📐 Threshold Ratchet`, conclusion **success**:
 *
 *   scripts/check-threshold-ratchet.mjs not present — project not yet on the
 *   ratchet template; skipping.
 *
 * Lisa ships that script from a stack template and deliberately keeps no second
 * copy under `scripts/`, so the one path the gate looked at was the one path
 * that would never exist here. The gate had never evaluated a threshold.
 *
 * It compounds one layer down. `plugins/src/base/hooks/threshold-ratchet.sh`
 * fails open on every infrastructure gap and says why in its own header — "the
 * CI layer still guarantees the gate". Both layers stood down together, and the
 * outer one printed green.
 *
 * The step is pulled verbatim out of the workflow and EXECUTED, rather than
 * string-matched, because the property under test is an exit code. A test that
 * greps the YAML for `exit 1` passes against a step whose `exit 1` sits on an
 * unreachable branch — the same class of bug as the one being fixed. The
 * sibling security gate is tested this way for the same reason; this is its
 * counterpart.
 *
 * @module tests/integration/threshold-ratchet-gate-fail-closed
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Filename of the script the gate runs. */
const SCRIPT_BASENAME = "check-threshold-ratchet.mjs";

/** Where the gate looks for an installed copy, relative to a repo root. */
const INSTALLED_RELATIVE = path.join("scripts", SCRIPT_BASENAME);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** One workflow, one job, and the stack template that job falls back to. */
interface Lane {
  readonly label: string;
  readonly workflow: string;
  readonly jobId: string;
  readonly templateDir: string;
}

/**
 * Both lanes carry the same gate against their own stack's template copy, and
 * both carried the same silent skip.
 */
const LANES: readonly Lane[] = [
  {
    label: "typescript",
    workflow: "quality.yml",
    jobId: "threshold_ratchet",
    templateDir: path.join("typescript", "copy-overwrite", "scripts"),
  },
  {
    label: "rails",
    workflow: "quality-rails.yml",
    jobId: "threshold_ratchet",
    templateDir: path.join("rails", "copy-overwrite", "scripts"),
  },
];

/**
 * Extracts the gate's `run:` block from a lane's workflow.
 * @param lane The lane whose step is under test.
 * @returns The shell source GitHub Actions would execute for that step.
 */
function gateStepScript(lane: Lane): string {
  const workflow = loadWorkflow(
    path.join(REPO_ROOT, ".github", "workflows", lane.workflow)
  );
  const job = workflow.jobs[lane.jobId];
  const step = (job?.steps ?? []).find(candidate =>
    candidate.run?.includes(SCRIPT_BASENAME)
  );
  // The block carries no `${{ }}` expressions, so it runs as written. An absent
  // job and an absent step collapse to the same empty string, asserted on here
  // rather than executed.
  const script = step?.run ?? "";

  expect(
    script,
    `${lane.workflow} job '${lane.jobId}' must run ${SCRIPT_BASENAME}`
  ).toBeTruthy();

  return script;
}

describe.each(LANES)("📐 Threshold Ratchet gate ($label)", lane => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "ratchet-gate-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs the gate step in the temp workdir.
   * @param baseRef Value for the workflow's BASE_REF environment variable.
   * @returns Exit status and the step's combined output.
   */
  function runGate(baseRef: string): { status: number; output: string } {
    const result = spawnSync(BASH, ["-c", gateStepScript(lane)], {
      cwd: workdir,
      encoding: "utf8",
      env: { ...process.env, BASE_REF: baseRef, HEAD_REF: "" },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  it("fails when the script is absent from BOTH resolution paths", () => {
    // The measured defect. A project with no installed copy and no template
    // got a green quality gate that examined nothing, forever.
    const { status, output } = runGate("main");

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(INSTALLED_RELATIVE);
    // The failure must name its own remedy, the way the sibling gate does.
    expect(output).toContain("lisa apply");
  });

  it("names skip_jobs as the deliberate way to decline the gate", () => {
    // Fail-closed is only defensible if declining is possible AND visible in
    // the caller. A silent `exit 0` was neither.
    const { output } = runGate("main");

    expect(output).toContain("threshold_ratchet");
    expect(output).toContain("skip_jobs");
  });

  it("resolves the in-repo template when no copy is installed", async () => {
    // Lisa's own repository is this case: it SHIPS the script from a stack
    // template and keeps no second copy under scripts/. Without the fallback
    // the fail-closed flip would redden Lisa's own CI forever, and the obvious
    // way to quiet that — mirroring the file — is the drift surface the repo
    // already declined to create.
    //
    // The temp dir is not a git repository, so the run stops at the base-ref
    // check immediately after. That is the assertion: reaching a message about
    // the BASE REF proves resolution got past the script check, which pre-fix
    // it never did.
    await fs.ensureDir(path.join(workdir, lane.templateDir));
    await fs.writeFile(
      path.join(workdir, lane.templateDir, SCRIPT_BASENAME),
      "// placeholder; resolution is what is under test here\n"
    );
    expect(await fs.pathExists(path.join(workdir, INSTALLED_RELATIVE))).toBe(
      false
    );

    const { output } = runGate("main");

    // The fallback announces itself; a silent substitution would be the same
    // unreadable state the skip created.
    expect(output).toContain(lane.templateDir);
    expect(output).toContain("origin/main");
  });

  it("still exits 0 outside a pull request", () => {
    // Guards the other direction. There is no base ref to ratchet against on a
    // push, and reddening those runs would get the gate switched off.
    const { status, output } = runGate("");

    expect(status).toBe(0);
    expect(output).toContain("Not a pull request");
  });
});

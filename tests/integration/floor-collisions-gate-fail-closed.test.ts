/**
 * Proves the security-floor gate fails CLOSED when its script is absent.
 *
 * The step is pulled verbatim out of `quality.yml` and executed, rather than
 * string-matched, because the property under test is an EXIT CODE. A test that
 * greps the YAML for `exit 1` passes against a step whose `exit 1` sits on an
 * unreachable branch — which is the same class of bug as the one being fixed:
 * something reporting a property it never evaluated.
 *
 * The gate's sibling in the same workflow — the BDD coverage gate — already
 * fails loudly on the identical condition (a Lisa-managed `.mjs` that
 * `lisa apply` installs being missing). This one used to `exit 0` with a
 * `::notice::`, so a project without the script got a green SECURITY check
 * that examined nothing.
 *
 * @module tests/integration/floor-collisions-gate-fail-closed
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
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** Filename of the script the gate runs. */
const GATE_SCRIPT_BASENAME = "lisa-floor-collisions.mjs";

/** The script the gate runs, at the path the gate looks for it. */
const GATE_SCRIPT_RELATIVE = path.join("scripts", GATE_SCRIPT_BASENAME);

/** Where Lisa ships that script from. */
const GATE_SCRIPT_SOURCE = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  GATE_SCRIPT_RELATIVE
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The job whose one substantive step is under test. */
const JOB_ID = "floor_collisions";

/**
 * Extracts the gate's `run:` block from the workflow.
 * @returns The shell source GitHub Actions would execute for that step.
 */
function gateStepScript(): string {
  const workflow = loadWorkflow(QUALITY_YML);
  const job = workflow.jobs[JOB_ID];
  const step = (job?.steps ?? []).find(candidate =>
    candidate.run?.includes(GATE_SCRIPT_BASENAME)
  );
  // The block carries no `${{ }}` expressions, so it runs as written. An
  // absent job and an absent step collapse to the same empty string, which
  // this asserts on rather than executing.
  const script = step?.run ?? "";

  expect(
    script,
    `quality.yml job '${JOB_ID}' must run ${GATE_SCRIPT_BASENAME}`
  ).toBeTruthy();

  return script;
}

describe("🧱 Security Floor Collisions gate", () => {
  let workdir = "";
  let summary = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "floor-gate-"));
    summary = path.join(workdir, "step-summary.md");
    await fs.writeFile(summary, "");
    await fs.writeJson(path.join(workdir, "package.json"), {
      name: "fixture",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs the gate step in the temp workdir.
   * @returns Exit status and the step's combined output.
   */
  function runGate(): { status: number; output: string } {
    const result = spawnSync(BASH, ["-c", gateStepScript()], {
      cwd: workdir,
      encoding: "utf8",
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  it("fails when the Lisa-managed script is absent", () => {
    // No scripts/ directory at all — a project that has never run `lisa apply`,
    // or one whose copy was deleted. Reporting green here is a metal detector
    // reading all-clear while unplugged.
    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(GATE_SCRIPT_RELATIVE);
    // The failure must name its own remedy, the way the sibling BDD gate does.
    expect(output).toContain("lisa apply");
  });

  it("names skip_jobs as the deliberate way to decline the gate", () => {
    // Fail-closed is only defensible if declining is possible AND visible in
    // the caller. A silent `exit 0` was neither.
    const { output } = runGate();

    expect(output).toContain("floor_collisions");
    expect(output).toContain("skip_jobs");
  });

  it("still passes when the script is present and finds no collision", async () => {
    // Guards the other direction: fail-closed must not redden a project that
    // has the gate installed and clean.
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(GATE_SCRIPT_SOURCE, path.join(workdir, GATE_SCRIPT_RELATIVE));

    const { status, output } = runGate();

    expect(status).toBe(0);
    expect(output).toContain("No override can be collapsed");
    // `tee -a "$GITHUB_STEP_SUMMARY"` must still reach the job summary.
    expect(await fs.readFile(summary, "utf8")).toContain("Floor collisions");
  });
});

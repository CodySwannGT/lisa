/**
 * Proves the skipped-required-check gate fails CLOSED, and bites on OUTCOMES.
 *
 * MEASURED before this existed, on this repository: job
 * `🔍 Quality Checks / 🔒 Skipped Required Checks`, conclusion **success**, with
 * the whole of its work being:
 *
 *   scripts/check-skipped-required-checks.mjs not present — project not yet on
 *   this template; skipping.
 *
 * Lisa ships that prover from a stack template and keeps no second copy under
 * `scripts/`, and it had no `.github/required-checks.json` at all — so both of
 * the step's two `exit 0` branches fired on every pull request and the guard
 * had never compared a single skip token against a single required context. The
 * guard against silencing required checks was itself silently green, on the
 * repository that owns the epic against exactly that shape (#2933).
 *
 * A later shortcut (#3385) passed without either artifact whenever `skip_jobs`
 * was empty. Once `skip_jobs` was retired that was every pull request, and a
 * caller repository merged with a ruleset-required context `skipped` under this
 * job's green. The step now judges what each required context's job concluded,
 * and the shortcut is gone.
 *
 * The step is pulled verbatim out of the workflow and EXECUTED, rather than
 * string-matched, because the property under test is an exit code. A test that
 * greps the YAML for `exit 1` passes against a step whose `exit 1` sits on an
 * unreachable branch — the same class of bug as the one being fixed. Sibling of
 * `threshold-ratchet-gate-fail-closed.test.ts`, which pins the same property for
 * the same reason on the gate next to it.
 *
 * Five cases, because fail-closed is only half the claim. An absent prover
 * fails; an absent declaration fails; a SKIPPED required context fails naming
 * it; a required context that RAN passes, listing what was examined; and a skip
 * token silencing a required context still fails. Without the passing case, a
 * step that failed unconditionally would satisfy every other assertion here.
 *
 * @module tests/integration/skipped-required-checks-gate-fail-closed
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Filename of the prover the gate runs. */
const SCRIPT_BASENAME = "check-skipped-required-checks.mjs";

/** The in-repo template directory the prover ships from. */
const TEMPLATE_DIR = path.join("typescript", "copy-overwrite", "scripts");

/** Where the job checks the prover out, at the workflow's own revision. */
const PROVER_DIR = path.join(".lisa-workflow-source", TEMPLATE_DIR);

/** The per-repo reviewed snapshot the prover reads. */
const DECLARATION_RELATIVE = path.join(".github", "required-checks.json");

/** The workflow whose `skip_jobs` the declaration points the prover at. */
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** One required context, posted by the `lint` job. */
const REQUIRED_CONTEXT = "🔍 Quality Checks / 🧹 Lint";

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/**
 * Extracts the gate's `run:` block from `quality.yml`.
 *
 * @returns The shell source GitHub Actions would execute for that step.
 */
function gateStepScript(): string {
  const workflow = loadWorkflow(
    path.join(REPO_ROOT, ".github", "workflows", "quality.yml")
  );
  const job = workflow.jobs.skipped_required_checks;
  const step = (job?.steps ?? []).find(candidate =>
    candidate.run?.includes(SCRIPT_BASENAME)
  );
  // The block carries no `${{ }}` expressions — every one reaches it through
  // `env:` — so it runs as written. An absent job and an absent step collapse
  // to the same empty string, asserted on here rather than executed.
  const script = step?.run ?? "";

  expect(
    script,
    `quality.yml job 'skipped_required_checks' must run ${SCRIPT_BASENAME}`
  ).toBeTruthy();

  return script;
}

describe("🔒 Skipped Required Checks gate", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "skipreq-gate-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs the gate step in the temp workdir with the environment the job sets.
   *
   * @param lintResult The `lint` job's result in the simulated run.
   * @returns Exit status and the step's combined output.
   */
  function runGate(lintResult = "success"): { status: number; output: string } {
    const result = boundedSpawnSync({
      label: "the skipped-required-checks gate step",
      command: BASH,
      args: ["-c", gateStepScript()],
      cwd: workdir,
      env: {
        ...process.env,
        LISA_GATE_MOMENT: "pull-request",
        LISA_JOB_RESULTS: JSON.stringify({
          lint: { result: lintResult, outputs: {} },
        }),
        LISA_JOB_NAMES: JSON.stringify({ lint: "🧹 Lint" }),
      },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  /**
   * Installs the REAL prover where the job's second checkout puts it.
   */
  async function installProver(): Promise<void> {
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, "lib"),
      path.join(workdir, PROVER_DIR, "lib")
    );
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, SCRIPT_BASENAME),
      path.join(workdir, PROVER_DIR, SCRIPT_BASENAME)
    );
  }

  /**
   * Writes a `ci.yml` carrying one `skip_jobs` value.
   *
   * @param skipJobs The raw token list, written with no spaces.
   */
  async function writeCallerWorkflow(skipJobs: string): Promise<void> {
    await fs.ensureDir(path.join(workdir, ".github", "workflows"));
    await fs.writeFile(
      path.join(workdir, CI_WORKFLOW),
      [
        "jobs:",
        "  quality:",
        "    with:",
        `      skip_jobs: '${skipJobs}'`,
        "",
      ].join("\n")
    );
  }

  /**
   * Writes a transcribed declaration, optionally declaring a skipped token.
   *
   * @param declarations The `skip_job_declarations` map to write.
   */
  async function writeDeclaration(
    declarations: Record<string, unknown> = {}
  ): Promise<void> {
    await fs.ensureDir(path.join(workdir, ".github"));
    await fs.writeJson(path.join(workdir, DECLARATION_RELATIVE), {
      ruleset: {
        repo: "owner/name",
        ids: [1],
        // Stamped. An unstamped snapshot makes the prover refuse rather than
        // answer, which would pass the failure cases for the wrong reason.
        baseline_fetched_at: new Date().toISOString().slice(0, 10),
      },
      workflows: [CI_WORKFLOW],
      required_contexts: [REQUIRED_CONTEXT],
      skip_job_declarations: declarations,
    });
  }

  it("prefers the prover this repository ships over a fetched copy", async () => {
    // The path taken in THIS repository, where the workspace already holds the
    // prover at the revision under test. Without this case the step could read
    // only a fetched copy and a change to the prover would be proved by
    // whatever sits on `main`, not by the pull request making it.
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, "lib"),
      path.join(workdir, TEMPLATE_DIR, "lib")
    );
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, SCRIPT_BASENAME),
      path.join(workdir, TEMPLATE_DIR, SCRIPT_BASENAME)
    );
    await writeCallerWorkflow("");
    await writeDeclaration();

    const { status, output } = runGate("skipped");

    expect(output).toContain(
      `Prover: ${path.join(TEMPLATE_DIR, SCRIPT_BASENAME)}`
    );
    expect(status).not.toBe(0);
    expect(output).toContain("required_context_skipped");
  });

  it("fails when the prover was not checked out", () => {
    // The measured defect, in its original form: a guard that examined nothing
    // because its prover was not where it looked, reported as a pass.
    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(path.join(PROVER_DIR, SCRIPT_BASENAME));
    // And it must not have reverted to either message it replaced.
    expect(output).not.toContain("project not yet on this template");
    expect(output).not.toContain("skip_jobs is empty");
  });

  it("fails when the prover resolves but the declaration is absent", async () => {
    // A prover with no snapshot cannot tell which outcomes a merge depends on,
    // and a step that shrugged at that reported success from a comparison that
    // never happened.
    await installProver();

    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(DECLARATION_RELATIVE);
    expect(output).toContain("lisa apply");
  });

  it("fails naming the required context whose job SKIPPED", async () => {
    // The shape that merged under a green guard: no token anywhere, and a
    // required context that ran zero steps.
    await installProver();
    await writeCallerWorkflow("");
    await writeDeclaration();

    const { status, output } = runGate("skipped");

    expect(status).not.toBe(0);
    expect(output).toContain("required_context_skipped");
    expect(output).toContain(REQUIRED_CONTEXT);
  });

  it("passes when the required context RAN, listing what it examined", async () => {
    // The gate NOT biting. Without this case a step that failed
    // unconditionally would satisfy every other assertion in this file.
    await installProver();
    await writeCallerWorkflow("");
    await writeDeclaration();

    const { status, output } = runGate("success");

    expect(status).toBe(0);
    expect(output).toContain("✅ 1 ruleset-required context(s) examined");
    expect(output).toContain(`\`${REQUIRED_CONTEXT}\` ← job \`lint\``);
    expect(output).not.toContain("::error");
  });

  it("still fails naming the violation when a skip token silences a required context", async () => {
    // The vestigial token arm keeps ADDING findings on top of a clean outcome.
    await installProver();
    await writeCallerWorkflow("lint");
    await writeDeclaration({
      lint: {
        suppressed_contexts: [REQUIRED_CONTEXT],
        ruleset_required: true,
      },
    });

    const { status, output } = runGate("success");

    expect(status).not.toBe(0);
    expect(output).toContain("skipped_required_check");
    expect(output).toContain(REQUIRED_CONTEXT);
  });
});

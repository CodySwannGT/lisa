/**
 * Proves the skipped-required-check gate fails CLOSED when its inputs are absent.
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
 * The step is pulled verbatim out of the workflow and EXECUTED, rather than
 * string-matched, because the property under test is an exit code. A test that
 * greps the YAML for `exit 1` passes against a step whose `exit 1` sits on an
 * unreachable branch — the same class of bug as the one being fixed. Sibling of
 * `threshold-ratchet-gate-fail-closed.test.ts`, which pins the same property for
 * the same reason on the gate next to it.
 *
 * Four cases, because fail-closed is only half the claim. A NON-EMPTY skip list
 * with an absent prover fails; a non-empty list with an absent declaration
 * fails; a PLANTED violation fails naming the violation; and an EMPTY list
 * passes without demanding either artifact. Without the last two, a step that
 * failed unconditionally would satisfy every other assertion here.
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

/** Where the gate looks for an installed copy, relative to a repo root. */
const INSTALLED_RELATIVE = path.join("scripts", SCRIPT_BASENAME);

/** The in-repo template directory the gate falls back to. */
const TEMPLATE_DIR = path.join("typescript", "copy-overwrite", "scripts");

/** The per-repo reviewed snapshot the prover reads. */
const DECLARATION_RELATIVE = path.join(".github", "required-checks.json");

/** The workflow whose `skip_jobs` the declaration points the prover at. */
const CI_WORKFLOW = ".github/workflows/ci.yml";

/** One required context, used as the thing a planted skip silences. */
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
  // The block carries no `${{ }}` expressions, so it runs as written. An absent
  // job and an absent step collapse to the same empty string, asserted on here
  // rather than executed.
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
   * Runs the gate step in the temp workdir.
   *
   * @param skipJobs The exact workflow input exposed to the guard step.
   * @returns Exit status and the step's combined output.
   */
  function runGate(skipJobs = "lint"): { status: number; output: string } {
    const result = boundedSpawnSync({
      label: "the skipped-required-checks gate step",
      command: BASH,
      args: ["-c", gateStepScript()],
      cwd: workdir,
      env: { ...process.env, SKIP_JOBS: skipJobs },
    });
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  /**
   * Installs the REAL prover under `scripts/`, with the lib it imports.
   */
  async function installProver(): Promise<void> {
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, "lib"),
      path.join(workdir, "scripts", "lib")
    );
    await fs.copy(
      path.join(REPO_ROOT, TEMPLATE_DIR, SCRIPT_BASENAME),
      path.join(workdir, INSTALLED_RELATIVE)
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
    declarations: Record<string, unknown>
  ): Promise<void> {
    await fs.ensureDir(path.join(workdir, ".github"));
    await fs.writeJson(path.join(workdir, DECLARATION_RELATIVE), {
      ruleset: {
        repo: "owner/name",
        ids: [1],
        // Stamped NOW. An expired stamp makes the prover refuse rather than
        // answer, which would pass the failure cases for the wrong reason.
        baseline_fetched_at: new Date().toISOString().slice(0, 10),
      },
      workflows: [CI_WORKFLOW],
      required_contexts: [REQUIRED_CONTEXT],
      skip_job_declarations: declarations,
    });
  }

  it("fails when a non-empty skip list has no prover in either resolution path", () => {
    // The measured defect. Lisa's own repository was exactly this case and got
    // a green required-check guard that examined nothing, forever.
    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(INSTALLED_RELATIVE);
    // The failure must name its own remedy, the way the sibling gate does.
    expect(output).toContain("lisa apply");
    // And it must not have reverted to the message it replaced.
    expect(output).not.toContain("project not yet on this template");
  });

  it("fails when a non-empty skip list has a prover but no declaration", async () => {
    // The step's SECOND `exit 0`. A prover with no snapshot to compare against
    // cannot answer, and a step that shrugged at that reported success from a
    // comparison that never happened.
    await installProver();

    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    expect(output).toContain(DECLARATION_RELATIVE);
    expect(output).not.toContain("Skipping.");
  });

  it("fails naming the violation when a skip silences a required context", async () => {
    // The gate BITING, not merely running. Without this case a step that failed
    // unconditionally would satisfy every other assertion in this file.
    await installProver();
    await writeCallerWorkflow("lint");
    await writeDeclaration({
      lint: {
        suppressed_contexts: [REQUIRED_CONTEXT],
        ruleset_required: true,
      },
    });

    const { status, output } = runGate();

    expect(status).not.toBe(0);
    expect(output).toContain("skipped_required_check");
    expect(output).toContain(REQUIRED_CONTEXT);
  });

  it("passes without a prover or snapshot when skip_jobs is empty", () => {
    // With no skipped job, there is nothing that can silence a required
    // context. Lightweight consumers do not need 2,354 lines of prover code
    // merely to establish that an empty input is empty (#3385).
    const { status, output } = runGate("");

    expect(status).toBe(0);
    expect(output).toContain("skip_jobs is empty");
    expect(output).not.toContain("::error");
  });
});

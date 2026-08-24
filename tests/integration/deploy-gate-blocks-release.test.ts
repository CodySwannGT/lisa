/**
 * The pre-deploy gate stops the deploy, executed rather than inspected.
 *
 * The sibling suite proves the WIRING — that `release` waits on a gate job and
 * that every exit code is routed. Wiring is necessary and not sufficient: eight
 * green-but-inert guards were found in this repository in a single day, and each
 * one had a passing happy-path test proving it RAN. What none of them proved was
 * that it BIT.
 *
 * So this file runs the shell the workflow actually ships, verbatim, against the
 * runner the workflow actually resolves, in a throwaway project that declares
 * the gate the issue names:
 *
 * ```json
 * "runtime-web-vulnerability": { "pre-deploy:production": "required" }
 * ```
 *
 * GitHub's scheduler is the only part left simulated, and it is the part that
 * cannot silently misbehave: `needs:` either holds or the workflow is invalid.
 *
 * The three cases below are the three that matter, and the third is the reason
 * the issue exists at all. A required gate whose prover does not exist must
 * FAIL — not skip, not pass quietly having found nothing to run. A deploy gate
 * that passes when nothing ran is worse than no deploy gate.
 * @module tests/integration/deploy-gate-blocks-release
 */

import * as fs from "fs-extra";
import { load as loadYaml } from "js-yaml";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The reusable workflow whose shell is executed here. */
const GATES_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/gates.yml");

/** Where the shipped runner and its resolver live. */
const SCRIPT_DIR = path.join(REPO_ROOT, "all/copy-overwrite/scripts");

/** The moment the issue's own example declares. */
const MOMENT = "pre-deploy:production";

/** The gate the issue's own example declares. */
const DAST = "runtime-web-vulnerability";

/** The script two stacks ship, which the registry resolves `security:dast` to. */
const SHIPPED_PROVER = "security:zap";

/** Wall-clock ceiling for one gate run. A killed child is not a verdict. */
const RUN_TIMEOUT_MS = 60_000;

/**
 * The shell the step runs under, by absolute path.
 *
 * GitHub gives a `run:` block `bash`; POSIX `sh` is the stricter of the two, so
 * a step that works here works there. Absolute rather than resolved through
 * `PATH`, which is a writable-directory hazard the linter is right about.
 */
const SHELL = "/bin/sh";

/** One workflow step, in the shape this suite reads. */
interface Step {
  /** The step's id, if it has one. */
  id?: string;
  /** The shell body. */
  run?: string;
}

/**
 * The shell body of the gate step, read out of the shipped workflow.
 *
 * Read rather than copied. A copy would keep passing after the workflow's own
 * routing was broken, which is the exact shape of an inert guard.
 * @returns The step's `run:` script.
 */
function gateScript(): string {
  const workflow = loadYaml(fs.readFileSync(GATES_WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
  const step = steps.find(candidate => candidate.id === "gates");
  if (!step?.run) throw new Error("gates.yml has no step with id `gates`");
  return step.run;
}

let project = "";

/**
 * Write the throwaway project the gate step will run against.
 * @param options Inputs.
 * @param options.scripts The project's package scripts.
 * @param options.gates The gates block, or null for no block at all.
 */
function seed(options: {
  scripts: Record<string, string>;
  gates: object | null;
}): void {
  fs.mkdirpSync(path.join(project, "scripts"));
  for (const file of ["lisa-gates.mjs", "lisa-run-gates.mjs"]) {
    fs.copySync(
      path.join(SCRIPT_DIR, file),
      path.join(project, "scripts", file)
    );
  }
  fs.copySync(
    path.join(SCRIPT_DIR, "lib"),
    path.join(project, "scripts", "lib")
  );
  fs.writeJsonSync(path.join(project, "package.json"), {
    name: "deploy-gate-fixture",
    private: true,
    version: "1.0.0",
    scripts: options.scripts,
  });
  if (options.gates !== null) {
    fs.writeJsonSync(path.join(project, ".lisa.config.json"), {
      gates: options.gates,
    });
  }
}

/**
 * Run the shipped gate step against the throwaway project.
 * @param moment The moment to resolve.
 * @returns Exit status and combined output.
 */
function runGateStep(moment: string): { status: number; output: string } {
  const outputs = path.join(project, "github_output");
  const summary = path.join(project, "github_step_summary");
  const env = {
    ...process.env,
    GATE_MOMENT: moment,
    GITHUB_OUTPUT: outputs,
    GITHUB_STEP_SUMMARY: summary,
  };
  const result = spawnSync(SHELL, ["-c", gateScript()], {
    cwd: project,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
    env,
  });
  if (result.signal !== null) {
    throw new Error(
      `the gate step was KILLED (${result.signal}) rather than reaching a verdict.`
    );
  }
  // The step appends to `$GITHUB_STEP_SUMMARY`, so an absent file means it
  // wrote no summary — not that the run failed to happen.
  const recorded = fs.existsSync(summary)
    ? fs.readFileSync(summary, "utf8")
    : "";
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${recorded}`,
  };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-deploy-gate-"));
});

afterEach(() => {
  fs.removeSync(project);
});

describe("a pre-deploy declaration gates the deploy", () => {
  it("stops the workflow and cites the gate when the prover fails", () => {
    seed({
      scripts: { [SHIPPED_PROVER]: "echo scanned; exit 3" },
      gates: { [DAST]: { [MOMENT]: "required" } },
    });

    const { status, output } = runGateStep(MOMENT);

    // Nonzero is what stops `release`, which `needs:` this job.
    expect(status).toBe(1);
    // "citing the gate" — the operator has to be told WHICH gate, at WHICH
    // moment, without opening the runner's own output.
    expect(output).toContain(DAST);
    expect(output).toContain(MOMENT);
    expect(output).toContain("::error");
  });

  it("stops the workflow when a required gate resolves to no prover at all", () => {
    // The defect this issue is about, in its purest form. `accessibility` is
    // the one deploy-only gate no stack ships a prover for, and it is
    // deliberately left that way — declare-only, not silently satisfied.
    // Skipping here would be a release shipping past a guarantee that was
    // written down, accepted, and never evaluated.
    seed({
      scripts: {},
      gates: { accessibility: { [MOMENT]: "required" } },
    });

    const { status, output } = runGateStep(MOMENT);

    expect(status).toBe(1);
    expect(output).toContain("accessibility");
  });

  it("runs the prover the project ships, not the registry's name for it", () => {
    // `security:dast` is the registry's name and no stack ships it. Resolving
    // literally would make every real DAST declaration fail as unprovable —
    // a gate that blocks every deploy is not a stricter gate, it is a broken
    // one, and it gets switched off.
    seed({
      scripts: { [SHIPPED_PROVER]: "echo scanned-ok" },
      gates: { [DAST]: { [MOMENT]: "required" } },
    });

    const { status, output } = runGateStep(MOMENT);

    expect(status).toBe(0);
    expect(output).toContain("scanned-ok");
  });
});

describe("a project that declared nothing keeps today's behaviour", () => {
  it("passes, and says it ran nothing, when there is no gates block", () => {
    // Exit 78. The one case where green is correct: the project has not adopted
    // the registry, and inventing a verdict for it would change behaviour for
    // someone who declared nothing. The message is what keeps it honest.
    seed({ scripts: {}, gates: null });

    const { status, output } = runGateStep(MOMENT);

    expect(status).toBe(0);
    expect(output).toContain("no gates block");
  });

  it("passes when the block declares nothing at this moment", () => {
    seed({
      scripts: { lint: "true" },
      gates: { "code-style": { commit: "required" } },
    });

    expect(runGateStep(MOMENT).status).toBe(0);
  });

  it("fails closed when no runner can be found at all", () => {
    // A caller reaches this workflow only by writing a `uses:` line, which is
    // an explicit request to be gated. Answering that request with a silent
    // pass would make the request unfalsifiable.
    fs.writeJsonSync(path.join(project, "package.json"), {
      name: "no-runner",
      private: true,
      version: "1.0.0",
    });

    const { status, output } = runGateStep(MOMENT);

    expect(status).toBe(1);
    expect(output).toContain("::error");
  });
});

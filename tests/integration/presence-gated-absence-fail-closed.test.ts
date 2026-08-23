/**
 * Proves a presence-gated `quality.yml` job can be made to FAIL when it finds
 * neither the script it greps for nor a declaration for the property.
 *
 * The six jobs in this family used to end in a `⏭️` notice that warned and
 * exited 0. Two of the six post required contexts, so on a project with
 * neither an executor nor a declaration the context reported satisfied having
 * proved nothing — which is the condition #2929 forbids.
 *
 * The step is pulled verbatim out of the workflow and EXECUTED rather than
 * string-matched, for the reason the floor-collisions bite test gives: the
 * property under test is an exit code, and a grep for `exit 1` passes against
 * an `exit 1` sitting on an unreachable branch.
 *
 * Two directions matter equally and both are asserted:
 *
 * - a project that declares nothing at all is NOT reddened (the default is
 *   `warn`, so a version bump cannot turn a fleet red); and
 * - a project that opts in with `gates.unproven: "fail"` IS reddened, with a
 *   message naming the property and both remedies.
 *
 * @module tests/integration/presence-gated-absence-fail-closed
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

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** Wall-clock ceiling for one extracted step. */
const STEP_TIMEOUT_MS = 30_000;

/** The settings file the decision body reads its one control out of. */
const CONFIG_FILE = ".lisa.config.json";

/** The Actions expression marker a body must not contain to be executable. */
const EXPRESSION = "${{";

/** One presence-gated job, its ⏭️ step, and the gate that job proves. */
interface Subject {
  /** Job id in `quality.yml`. */
  job: string;
  /** Exact name of the ⏭️ step that runs when nothing proved the property. */
  step: string;
  /** The registry gate the job's façade resolves. */
  gate: string;
}

/**
 * Every presence-gated job, with the ⏭️ step this suite executes.
 *
 * Literals, not lookups, for the reason the inventory fixture keeps literals:
 * a renamed step has to fail here rather than be followed silently.
 * Exhaustiveness against the workflow is `quality-script-presence-jobs`'s job;
 * this list is asserted equal in length to that family below.
 */
const SUBJECTS: readonly Subject[] = [
  {
    job: "e2e_coverage",
    step: "⏭️ Skip e2e coverage (no check-e2e-coverage.mjs script)",
    gate: "journey-coverage",
  },
  {
    job: "state_classification",
    step: "⏭️ Skip state classification (no check-state-classification.mjs script)",
    gate: "state-classification",
  },
  {
    job: "test_unit",
    step: "⏭️ Skip unit tests (no test:unit script)",
    gate: "test-correctness",
  },
  {
    job: "test_mutation",
    step: "⏭️ Skip mutation gate (no test:mutation script)",
    gate: "test-meaningfulness",
  },
  {
    job: "test_integration",
    step: "⏭️ Skip integration tests (no test:integration script)",
    gate: "test-integration",
  },
  {
    job: "performance_budget",
    step: "⏭️ Skip the performance budget (no export:web script)",
    gate: "performance-budget",
  },
];

/**
 * The `run:` body and `env:` block of one job's ⏭️ step, as written.
 * @param subject The job and step to extract.
 * @returns The shell source and the step's declared environment.
 */
function extract(subject: Subject): {
  script: string;
  env: Record<string, string>;
} {
  const workflow = loadWorkflow(QUALITY_YML);
  const job = workflow.jobs[subject.job];
  const step = (job?.steps ?? []).find(
    candidate => candidate.name === subject.step
  );
  if (step === undefined) {
    throw new Error(
      `quality.yml job '${subject.job}' must still have the step ` +
        `${JSON.stringify(subject.step)} — a renamed step turns every ` +
        `assertion about it into an assertion about undefined.`
    );
  }
  const script = String((step as Record<string, unknown>)["run"] ?? "");
  // `${{ }}` in the BODY would not run as written; in `env:` it is resolved
  // from the fixture below instead, which is what makes the body executable.
  if (script.includes(EXPRESSION)) {
    throw new Error(
      `${subject.job}'s ⏭️ body carries a ${EXPRESSION} expression, so what ` +
        `this suite executes is not what GitHub Actions would run.`
    );
  }
  const declared = ((step as Record<string, unknown>)["env"] ?? {}) as Record<
    string,
    unknown
  >;
  const env = Object.fromEntries(
    Object.entries(declared).map(([key, value]) => {
      const raw = String(value);
      // The expression-valued keys resolve from the resolve step and the
      // workflow input; both are supplied by `run` below.
      return [key, raw.includes(EXPRESSION) ? "" : raw];
    })
  );
  return { script, env };
}

describe("presence-gated jobs fail closed when nothing proves the property", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "presence-gate-"));
    await fs.writeJson(path.join(workdir, "package.json"), {
      name: "fixture",
      version: "1.0.0",
    });
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Runs one job's ⏭️ step in the fixture project.
   * @param subject The job under test.
   * @returns Exit status and combined output.
   */
  function run(subject: Subject): { status: number; output: string } {
    const { script, env } = extract(subject);
    const result = spawnSync(BASH, ["-c", script], {
      cwd: workdir,
      encoding: "utf8",
      timeout: STEP_TIMEOUT_MS,
      env: {
        ...process.env,
        ...env,
        GATE_ID: subject.gate,
        GATE_MOMENT: "pull-request",
      },
    });
    // A killed child returns EMPTY streams, which reads as a content bug and
    // never says "time". Say it here instead.
    expect(
      result.signal,
      `${subject.job}'s ⏭️ step was KILLED (${String(result.signal)}) rather ` +
        `than completing; its output is empty for that reason, not because ` +
        `the step printed nothing.`
    ).toBeNull();
    return {
      status: result.status ?? -1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  }

  it("covers the whole presence-gated family", () => {
    const workflow = loadWorkflow(QUALITY_YML);
    const found = Object.entries(workflow.jobs)
      .filter(([, definition]) =>
        (definition.steps ?? []).some(step => step.id === "check_script")
      )
      .map(([job]) => job)
      .sort((left, right) => left.localeCompare(right));

    expect(found).toEqual(
      SUBJECTS.map(subject => subject.job).sort((left, right) =>
        left.localeCompare(right)
      )
    );
  });

  describe("a project that declares nothing is not reddened", () => {
    it.each(SUBJECTS)(
      "$job warns and exits 0 with no config at all",
      subject => {
        const { status, output } = run(subject);

        expect(status).toBe(0);
        expect(output).toContain("::warning");
        expect(output).toContain(subject.gate);
      }
    );

    it.each(SUBJECTS)(
      "$job warns and exits 0 when the config declares no response",
      async subject => {
        await fs.writeJson(path.join(workdir, CONFIG_FILE), {
          gates: { runner: "npm run" },
        });

        const { status } = run(subject);

        expect(status).toBe(0);
      }
    );
  });

  describe("a project that opts in is failed, not warned", () => {
    it.each(SUBJECTS)(
      "$job exits non-zero under gates.unproven = fail",
      async subject => {
        await fs.writeJson(path.join(workdir, CONFIG_FILE), {
          gates: { unproven: "fail" },
        });

        const { status, output } = run(subject);

        expect(status).not.toBe(0);
        expect(output).toContain("::error");
        // The property, by the name a declaration would use.
        expect(output).toContain(subject.gate);
        // Both remedies, because a red gate that does not say how to clear it
        // is answered by deleting the gate.
        expect(output).toContain(`gates.${subject.gate}`);
        expect(output).toContain("lisa apply");
      }
    );
  });

  describe("an unrecognised response is refused rather than read as permission", () => {
    it.each(SUBJECTS)("$job exits non-zero on a typo", async subject => {
      // A denylist fails OPEN on exactly the value nobody anticipated, so the
      // permitted values are an allowlist and anything else is refused — the
      // same rule `bdd_mode` states for itself.
      await fs.writeJson(path.join(workdir, CONFIG_FILE), {
        gates: { unproven: "fial" },
      });

      const { status, output } = run(subject);

      expect(status).not.toBe(0);
      expect(output).toContain("unproven");
      expect(output).toContain("warn");
      expect(output).toContain("fail");
    });
  });
});

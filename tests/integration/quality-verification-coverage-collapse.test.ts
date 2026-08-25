/**
 * `verification_coverage` has exactly one adoption control, proved by running it.
 *
 * The job used to carry two: the `coverage-adequacy` gate row it answers to,
 * and the `verify_enforced` workflow input its `if:` also read. The two could
 * disagree, and the losing one lost in silence — a project declaring the gate
 * `required` at pull-request while leaving the input at its default `false`
 * got no job at all (#2930, #3016, #3021).
 *
 * Retiring the input is two lines. NOT REDDENING THE 20 CALLERS THAT RELIED ON
 * ITS DEFAULT is the work, and it is why the collapse is not a deletion: with
 * the input simply gone, the job runs for every consumer and the façade's
 * `configured=false` fallback runs a bespoke spec-delta check most of them
 * fail, because an undeclared gate falls back rather than standing down.
 *
 * So this job stands down instead: undeclared means zero proving steps and a
 * warning, which is byte-for-byte the outcome a skipped job already had. That
 * inverts the registry's general rule for exactly one job, which is recorded in
 * `DECLARATION_REQUIRED_JOBS` and owned by #3147.
 *
 * Every assertion that matters here EXECUTES the shipped shell against a
 * fixture config rather than matching the YAML as text. A text assertion is
 * what let `gates.runner: ":"` silence every gate for a whole release.
 * @module tests/integration/quality-verification-coverage-collapse
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import {
  GATES_SCRIPT,
  NOT_CONFIGURED,
  jobIn,
  stepNamed,
  workflow,
} from "./quality-gate-facade-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The job whose single control this file pins. */
const JOB = "verification_coverage";

/** The gate that job answers to, and now answers to alone. */
const GATE_ID = "coverage-adequacy";

/** The moment `quality.yml` resolves by default. */
const MOMENT = "pull-request";

/** Where the façade looks for a project-local resolver. */
const RESOLVER_RELATIVE = path.join("scripts", "lisa-gates.mjs");

/** The step that answers "is this gate declared at all", by id. */
const DECLARATION_STEP_ID = "declaration";

/** The condition selecting the declaration-present path. */
const DECLARED_PRESENT = "steps.declaration.outputs.present == 'true'";

/** The condition selecting the stand-down path. */
const DECLARED_ABSENT = "steps.declaration.outputs.present != 'true'";

/** The step that refuses a caller still passing the retired input. */
const REFUSAL_STEP = "🚫 verify_enforced is retired";

/** The step that says the job proved nothing, on the undeclared path. */
const STAND_DOWN_STEP = "⏭️ Stand down — coverage-adequacy is not declared";

/** The built-in this job runs when a declaration resolves to no task. */
const FALLBACK_STEP = "✅ Require a verification (e2e) spec delta on feat/fix";

/** The settings file a consumer declares its gates in. */
const CONFIG_FILE = ".lisa.config.json";

/** What the probe emits for a consumer that declared this gate. */
const DECLARED = "present=true";

/** What the probe emits for a consumer that did not. */
const UNDECLARED = "present=false";

/**
 * The shell of one step of this job, as GitHub Actions would run it.
 * @param name - Exact step name.
 * @returns The `run:` block.
 */
function shellOf(name: string): string {
  const step = stepNamed(JOB, name);
  const script = step?.run ?? "";
  expect(step, `${JOB} must have a step named ${name}`).toBeDefined();
  // The block must carry no `${{ }}` of its own: everything the workflow
  // interpolates arrives through the step's `env:`, which is what makes it
  // executable here and, more importantly, keeps a PR-editable value an
  // argument rather than workflow source.
  expect(script).not.toContain("${{");
  return script;
}

/**
 * The name of the declaration step, located by id rather than by title.
 *
 * Titles carry an emoji and a sentence and are the part most likely to be
 * reworded; the id is what the conditions reference, so a rename that breaks
 * the wiring fails here rather than passing against a stale string.
 * @returns The step's `name:`.
 */
function declarationStepName(): string {
  const step = (jobIn(JOB).steps ?? []).find(
    candidate => candidate.id === DECLARATION_STEP_ID
  );
  expect(
    step,
    `${JOB} must have a step with id '${DECLARATION_STEP_ID}'`
  ).toBeDefined();
  return step?.name ?? "";
}

describe("verification_coverage answers to the declaration alone", () => {
  describe("the retired input", () => {
    it("no longer appears in the job's own condition", () => {
      // The `if:` is what decided whether the job ran at all, and an input
      // there is a control the declaration cannot beat. Its absence is the
      // collapse; everything below is what makes the collapse survivable.
      expect(jobIn(JOB).if ?? "").not.toContain("verify_enforced");
    });

    it("is still accepted, so an unmigrated caller keeps a valid workflow", () => {
      // The `bdd_mode` precedent (#3016). Deleting the input makes every
      // caller still passing it fail to PARSE, which is a worse failure than
      // the one it replaces: it names no remedy and takes the whole workflow
      // with it.
      expect(Object.keys(workflow.on?.workflow_call?.inputs ?? {})).toContain(
        "verify_enforced"
      );
    });

    it("fails the job by name, rather than being ignored in silence", () => {
      const step = stepNamed(JOB, REFUSAL_STEP);
      expect(step?.if).toContain("inputs.verify_enforced");
      const result = boundedSpawnSync({
        label: "the retired-input refusal",
        command: BASH,
        args: ["-c", shellOf(REFUSAL_STEP)],
        cwd: REPO_ROOT,
        env: { ...process.env },
      });
      // Executed, not read. A refusal that echoes and exits 0 reports success
      // while the control it names is gone — the exact shape this campaign
      // keeps finding.
      expect(result.status).not.toBe(0);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(output).toContain("::error::");
      expect(output).toContain(GATE_ID);
      expect(output).toContain(CONFIG_FILE);
    });
  });

  describe("what a declaration resolves to, executed", () => {
    let workdir = "";
    let output = "";

    beforeEach(async () => {
      workdir = await fs.mkdtemp(path.join(os.tmpdir(), "verify-collapse-"));
      output = path.join(workdir, "github-output.txt");
      await fs.writeFile(output, "");
      await fs.ensureDir(path.join(workdir, "scripts"));
      await fs.copy(GATES_SCRIPT, path.join(workdir, RESOLVER_RELATIVE));
      // The resolver imports a sibling helper, so a lone copy cannot start.
      await fs.copy(
        path.join(path.dirname(GATES_SCRIPT), "lib"),
        path.join(workdir, "scripts", "lib")
      );
      await fs.writeJson(path.join(workdir, "package.json"), {
        name: "fixture",
        scripts: { "test:cov": "vitest run --coverage" },
      });
    });

    afterEach(async () => {
      await fs.remove(workdir);
    });

    /**
     * Writes the fixture settings file and clears the captured output.
     * @param config - The whole settings file, written verbatim.
     */
    function declare(config: unknown): void {
      fs.writeJsonSync(path.join(workdir, CONFIG_FILE), config);
      fs.writeFileSync(output, "");
    }

    /**
     * Runs the shipped declaration step against whatever `declare` wrote.
     * @returns What reached `$GITHUB_OUTPUT`.
     */
    function present(): string {
      const result = boundedSpawnSync({
        label: "the coverage-adequacy declaration probe",
        command: BASH,
        args: ["-c", shellOf(declarationStepName())],
        cwd: workdir,
        env: {
          ...process.env,
          GATE_ID,
          GATE_MOMENT: MOMENT,
          RESOLVER: RESOLVER_RELATIVE,
          GITHUB_OUTPUT: output,
        },
      });
      expect(
        result.status,
        `the probe exited ${String(result.status)}: ${result.stderr ?? ""}`
      ).toBe(0);
      return fs.readFileSync(output, "utf8").trim();
    }

    it("reports a consumer that declares nothing as undeclared", () => {
      declare({});

      expect(present()).toBe(UNDECLARED);
    });

    it("reports a gates block that omits this gate as undeclared", () => {
      declare({ gates: { "code-style": { [MOMENT]: "required" } } });

      expect(present()).toBe(UNDECLARED);
    });

    it("reports a declaration at this moment as present", () => {
      declare({ gates: { [GATE_ID]: { [MOMENT]: "required" } } });

      expect(present()).toBe(DECLARED);
    });

    it("counts an explicit off as a declaration, not as an absence", () => {
      // `off` is a project SAYING no. Reading it as "undeclared" would make the
      // stand-down and the declaration indistinguishable, which is how `off`
      // stopped working the last time these three states were collapsed to two.
      declare({ gates: { [GATE_ID]: { [MOMENT]: "off" } } });

      expect(present()).toBe(DECLARED);
    });

    it("does not count a declaration made at another moment", () => {
      declare({ gates: { [GATE_ID]: { push: "required" } } });

      expect(present()).toBe(UNDECLARED);
    });

    it("leaves this repository's own real config exactly where it was", () => {
      // THE NEGATIVE CONTROL, run against the shipped file rather than a
      // fixture shaped like it. Lisa calls quality.yml, has never set
      // verify_enforced, and declares coverage-adequacy at push only — it is
      // one of the 20. If the collapse reddened a default-relying consumer,
      // it would redden this one first.
      const real: unknown = fs.readJsonSync(path.join(REPO_ROOT, CONFIG_FILE));
      declare(real);

      expect(present()).toBe(UNDECLARED);
    });
  });

  describe("the built-in cannot run for a consumer that declared nothing", () => {
    it("gates the spec-delta fallback on the declaration as well as on resolution", () => {
      const step = stepNamed(JOB, FALLBACK_STEP);
      expect(step?.if).toContain(NOT_CONFIGURED);
      expect(step?.if).toContain(DECLARED_PRESENT);
    });

    it("no longer runs the fallback merely because no gates block exists", () => {
      // The one-line difference between the safe collapse and the one that
      // reddens 20 repositories. `declared == 'false'` used to SELECT the
      // built-in, and a project with no gates block is precisely the
      // population that relied on the input's default.
      expect(stepNamed(JOB, FALLBACK_STEP)?.if).not.toContain(
        "steps.gates_declared.outputs.declared == 'false'"
      );
    });

    it("says out loud that it proved nothing", () => {
      const step = stepNamed(JOB, STAND_DOWN_STEP);
      expect(step?.if).toContain(DECLARED_ABSENT);
      const result = boundedSpawnSync({
        label: "the verification-coverage stand-down notice",
        command: BASH,
        args: ["-c", shellOf(STAND_DOWN_STEP)],
        cwd: REPO_ROOT,
        env: { ...process.env, GATE_MOMENT: MOMENT },
      });
      // A stand-down that fails is a reddened consumer; a stand-down that says
      // nothing is a green check nobody knows is inert. It must be both.
      expect(result.status).toBe(0);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(output).toContain("::warning::");
      expect(output).toContain(GATE_ID);
      expect(output).toContain("3147");
    });
  });
});

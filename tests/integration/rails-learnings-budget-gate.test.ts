/**
 * A Rails project's gate declaration governs `quality-rails.yml` (#3018).
 *
 * MEASURED before this existed, on `origin/main`: the resolve step looked for
 * `lisa-gates.mjs` at three on-disk paths, `quality-rails.yml` runs no
 * `npm ci` / `bun install` / `setup-node`, and no Rails consumer carries a
 * copy — so every Rails project resolved `configured=false` and the job ran the
 * built-in prover no matter what its `.lisa.config.json` said. A declaration
 * set `off` could not turn the job off, which is the clause #2932's first
 * acceptance criterion carried here verbatim.
 *
 * The step is EXECUTED rather than string-matched. Everything about this fix
 * is which branch runs, and a test that greps the YAML for the new branch
 * passes against one nothing can reach.
 * @module tests/integration/rails-learnings-budget-gate
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  runDeclaredProver,
  runResolve,
  stepNamedInJob,
  stepsThatRun,
  type Project,
} from "./support/rails-learnings-budget-gate.js";

// The bounded children this suite starts live in its support module, which
// cannot know what budget the case runs under. Without this call the case
// budget is the flat one from `vitest.config.local.ts` while the children
// scale, and the two deadlines invert from a slowdown of 4.0x up
// (CodySwannGT/lisa#3202).
useIoLatencyBudget();

/** A Rails project that carries the dependency the fetch resolves from. */
const PACKAGE_JSON = JSON.stringify({
  name: "a-rails-consumer",
  devDependencies: { "@codyswann/lisa": "^3.0.0" },
});

/** The same project with no `@codyswann/lisa` anywhere. */
const NO_LISA_PACKAGE_JSON = JSON.stringify({ name: "a-rails-consumer" });

/** The gate id, spelt once because four declarations below name it. */
const GATE = "learnings-budget";

/** The task a declaring project points the gate at. */
const PROJECT_TASK = "lisa:learnings_budget";

/**
 * A declaration of the gate at one level, proved by the project's own task.
 * @param level The declared level.
 * @returns The `.lisa.config.json` contents.
 */
const declaring = (level: string): string =>
  JSON.stringify({
    gates: {
      runner: "bundle exec",
      [GATE]: { "pull-request": { level, run: PROJECT_TASK } },
    },
  });

/** Declares the gate off at the moment this job proves. */
const DECLARES_OFF = JSON.stringify({
  gates: { [GATE]: { "pull-request": "off" } },
});

/** Declares the gate required, proved by a task the project owns. */
const DECLARES_REQUIRED = declaring("required");

/** The prover step that runs when nothing resolves. */
const BUILT_IN = "📚 Check learnings budget";

/** The prover step that runs what the project declared. */
const DECLARED = "📚 Run the learnings-budget gate";

/** The step that names the declaration when it said `off`. */
const ANNOUNCES_OFF = "⏭️ Learnings budget declared off";

/** The same declaration, at the level that asks not to be blocked on. */
const DECLARES_OPTIONAL = declaring("optional");

/** The step that keeps a non-blocking failure visible. */
const REPORTS_OPTIONAL = "🟡 Report the optional gate that failed";

/** The only condition under which the declared prover may not block. */
const OPTIONAL_ONLY = "${{ steps.gate.outputs.level == 'optional' }}";

describe("quality-rails.yml learnings-budget declaration", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "rails-gate-"));
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Resolves the gate for a project.
   * @param project The project under test.
   * @returns The step run.
   */
  const resolve = (project: Project) => runResolve(workdir, project);

  it("stops the job proving anything when the project declares it off", () => {
    const run = resolve({ config: DECLARES_OFF, packageJson: PACKAGE_JSON });

    expect(run.status).toBe(0);
    expect(run.outputs["configured"]).toBe("off");
    // The whole clause, evaluated rather than asserted about: with `off`
    // resolved, neither prover step is among the steps GitHub would run.
    expect(stepsThatRun("off")).not.toContain(BUILT_IN);
    expect(stepsThatRun("off")).not.toContain(DECLARED);
  });

  it("says which declaration decided that", () => {
    const run = resolve({ config: DECLARES_OFF, packageJson: PACKAGE_JSON });
    const announcement = stepsThatRun(run.outputs["configured"] ?? "");

    expect(announcement).toContain(ANNOUNCES_OFF);
    // The resolver that read it is published, so the log names a file rather
    // than leaving "which declaration" to be inferred from a green job.
    expect(run.outputs["resolver"]).toContain("lisa-gates.mjs");
  });

  it("runs the project's own prover when it declares the gate required", () => {
    const run = resolve({
      config: DECLARES_REQUIRED,
      packageJson: PACKAGE_JSON,
    });

    expect(run.status).toBe(0);
    expect(run.outputs["configured"]).toBe("true");
    expect(run.outputs["runner"]).toBe("bundle exec");
    expect(run.outputs["task"]).toBe(PROJECT_TASK);
    expect(stepsThatRun("true")).toContain(DECLARED);
    // And the prover step, run with those outputs, really invokes it.
    expect(runDeclaredProver(workdir, run.outputs)).toEqual([
      `exec ${PROJECT_TASK}`,
    ]);
  });

  it("carries the declared level through, rather than collapsing it", () => {
    // The defect this closes: `required` and `optional` both resolved to the
    // single string `true`, every downstream condition read that boolean, and
    // an `optional` gate therefore failed this reusable workflow exactly as a
    // `required` one did — failing the caller and skipping everything after it.
    const required = resolve({
      config: DECLARES_REQUIRED,
      packageJson: PACKAGE_JSON,
    });
    const optional = resolve({
      config: DECLARES_OPTIONAL,
      packageJson: PACKAGE_JSON,
    });

    expect(required.outputs["configured"]).toBe("true");
    expect(required.outputs["level"]).toBe("required");
    expect(optional.outputs["configured"]).toBe("true");
    expect(optional.outputs["level"]).toBe("optional");
  });

  it("blocks unless the declared level says not to", () => {
    // The gate step is the one step that may continue on error, and only for
    // the level that asked to. Pinned as an exact string: a literal `true`, or
    // anything that also exempts `required`, is the same defect pointed the
    // other way.
    const declared = stepNamedInJob(DECLARED);

    expect(declared["continue-on-error"]).toBe(OPTIONAL_ONLY);
    expect(declared.id).toBe("gate_run");
  });

  it("reports the failure an optional gate did not block on", () => {
    // Continuing on error is half the fix; on its own it trades a silent skip
    // for a silent pass. `outcome`, not `conclusion` — `conclusion` is the
    // value `continue-on-error` already rewrote to success.
    const report = stepNamedInJob(REPORTS_OPTIONAL);
    const condition = String(report.if ?? "");

    expect(condition).toContain("steps.gate_run.outcome == 'failure'");
    expect(condition).toContain("steps.gate.outputs.level == 'optional'");
    expect(condition).not.toContain("steps.gate_run.conclusion");
    expect(String(report.run ?? "")).toContain("::warning");
    expect(String(report.run ?? "")).toContain("GITHUB_STEP_SUMMARY");
  });

  it("emits the level on the off path too, so the log can name it", () => {
    const run = resolve({ config: DECLARES_OFF, packageJson: PACKAGE_JSON });

    expect(run.outputs["level"]).toBe("off");
  });

  it("refuses a level that is not one of the three", () => {
    // Fail closed. `.lisa.config.json` is a file a pull request can edit, and
    // the level now reaches `$GITHUB_OUTPUT` and decides whether a gate blocks.
    const run = resolve({
      config: declaring("advisory"),
      packageJson: PACKAGE_JSON,
    });

    expect(run.status).not.toBe(0);
    expect(run.outputs["configured"]).toBeUndefined();
  });

  it("fetches the resolver at the version the project declares", () => {
    const run = resolve({ config: DECLARES_OFF, packageJson: PACKAGE_JSON });

    expect(run.npmInvocations).toHaveLength(1);
    expect(run.npmInvocations[0]).toContain("pack @codyswann/lisa@^3.0.0");
    // No literal version, for the reason #2932 gave: a written-in pin drifted
    // sixty releases behind while every consumer enforced a contract none of
    // them was on.
    expect(run.npmInvocations[0]).not.toMatch(
      /@codyswann\/lisa@\d+\.\d+\.\d+/u
    );
    expect(run.temporaryRoots).toHaveLength(1);
    expect(run.temporaryRoots[0]).toMatch(
      new RegExp(`${path.sep}tmp\\.[A-Za-z0-9]{6}$`, "u")
    );
    expect(run.temporaryRoots.every(root => !fs.existsSync(root))).toBe(true);
  });

  describe("negative control: a project that declares nothing", () => {
    it("behaves exactly as it does today — built-in prover, no fetch", () => {
      const run = resolve({ config: null, packageJson: PACKAGE_JSON });

      expect(run.status).toBe(0);
      expect(run.outputs["configured"]).toBe("false");
      expect(stepsThatRun("false")).toContain(BUILT_IN);
      // Nothing to resolve is not the same as unresolvable, so no network call
      // is made and the default cannot have been silently altered.
      expect(run.npmInvocations).toEqual([]);
    });

    it("treats an empty gates block the same way", () => {
      const run = resolve({
        config: JSON.stringify({ gates: {} }),
        packageJson: PACKAGE_JSON,
      });

      expect(run.status).toBe(0);
      expect(run.outputs["configured"]).toBe("false");
      expect(run.npmInvocations).toEqual([]);
    });
  });

  describe("fails closed rather than proving what nobody declared", () => {
    it("refuses when the declaring project pins no @codyswann/lisa", () => {
      const run = resolve({
        config: DECLARES_OFF,
        packageJson: NO_LISA_PACKAGE_JSON,
      });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("::error");
      expect(run.output).toContain("Gate declaration cannot be resolved");
      expect(run.output).toContain("skip_jobs");
      expect(run.outputs["configured"]).toBeUndefined();
    });

    it("refuses when the resolver cannot be fetched", () => {
      const run = resolve({
        config: DECLARES_OFF,
        packageJson: PACKAGE_JSON,
        packMode: "fail",
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain("Could not fetch @codyswann/lisa@^3.0.0");
      expect(run.outputs["configured"]).toBeUndefined();
      expect(run.temporaryRoots).toHaveLength(1);
      expect(run.temporaryRoots.every(root => !fs.existsSync(root))).toBe(true);
    });

    it("fails closed when temporary resolver cleanup reports failure", () => {
      const run = resolve({
        config: DECLARES_OFF,
        packageJson: PACKAGE_JSON,
        cleanupMode: "fail",
      });

      expect(run.status).toBe(1);
      expect(run.output).toContain("Fetched gates resolver cleanup failed");
      expect(run.outputs["configured"]).toBe("off");
      expect(run.temporaryRoots).toHaveLength(1);
      expect(run.temporaryRoots.every(root => !fs.existsSync(root))).toBe(true);
    });

    it("refuses when the declared version ships no resolver", () => {
      // The real shape: 2.x tarballs carry all/copy-overwrite/scripts WITHOUT
      // lisa-gates.mjs, so a project pinned there cannot resolve its own block.
      const run = resolve({
        config: DECLARES_OFF,
        packageJson: PACKAGE_JSON,
        packMode: "no-resolver",
      });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("does not ship");
      expect(run.output).toContain("lisa-gates.mjs");
    });

    it("refuses when .lisa.config.json is present but unparseable", () => {
      // A config nobody can read is the UNKNOWN case, not the empty one.
      const run = resolve({ config: "{ not json", packageJson: PACKAGE_JSON });

      expect(run.status).not.toBe(0);
      expect(run.output).toContain("Gate declaration cannot be read");
      expect(run.outputs["configured"]).toBeUndefined();
    });
  });
});

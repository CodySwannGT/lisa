/**
 * What the release reconcile job does for each registry verdict
 * (CodySwannGT/lisa#5106).
 *
 * Run 44743107550 published v8.2.4, but npm took about 55 minutes to serve
 * it, and the publish job's check gave up first. The reconcile job then asked
 * the registry again and got `published`, yet its "File the skipped version"
 * step still filed #5105 ("did not reach npm") and "Refuse to end green" still
 * failed, because neither read the verdict. These cases evaluate every step's
 * `if:` in `reconcile_release` the way Actions would, for each verdict the
 * check can print, and require the steps a verdict should and should not run.
 * @module tests/unit/config/reconcile-release-verdicts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { evaluateIf } from "../../helpers/workflow-job-graph.js";

const DEPLOY = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "deploy.yml"
);

/** One step of the reconcile job, as far as these cases read it. */
interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly uses?: string;
}

const STEPS: readonly Step[] =
  (
    yaml.load(readFileSync(DEPLOY, "utf8")) as {
      jobs: Record<string, { steps?: Step[] }>;
    }
  ).jobs.reconcile_release?.steps ?? [];

/** The step that converts the GitHub Release to a draft. */
const RETRACT = "Retract the GitHub Release that asserts a shipped version";

/** The step that files the "did not reach npm" issue. */
const FILE = "File the skipped version so it outlives this run";

/** The step that fails the job. */
const REFUSE = "Refuse to end green";

/** The step that reports a release that landed after the publish check. */
const LATE = "Report a release that landed after the publish check gave up";

/** The steps after the registry is asked, which the verdict decides. */
const DECIDED = [RETRACT, LATE, FILE, REFUSE];

/**
 * The verdict-dependent steps that run for one verdict.
 * @param verdict - What the registry check printed
 * @returns The names of the steps that run, in order
 */
function stepsRunFor(verdict: string): readonly string[] {
  const context = { steps: { landed: { outputs: { verdict } } } };
  return STEPS.filter(step => DECIDED.includes(step.name ?? ""))
    .filter(step => evaluateIf(step.if, context))
    .map(step => step.name ?? "");
}

describe("the reconcile job acts on what the registry said (#5106)", () => {
  it("declares every step these cases decide on", () => {
    expect(STEPS.map(step => step.name)).toEqual(
      expect.arrayContaining(DECIDED)
    );
  });

  it("treats `published` as a landed release: no issue, no refusal, a plain report", () => {
    expect(stepsRunFor("published")).toEqual([LATE]);
  });

  it("still retracts, files and refuses on a proven `missing`", () => {
    expect(stepsRunFor("missing")).toEqual([RETRACT, FILE, REFUSE]);
  });

  it("still files and refuses on `unprovable`, and retracts nothing", () => {
    expect(stepsRunFor("unprovable")).toEqual([FILE, REFUSE]);
  });

  it("says the release is good and warns against re-running the publish", () => {
    const report = STEPS.find(step => step.name === LATE)?.run ?? "";

    expect(report).toContain("GITHUB_STEP_SUMMARY");
    expect(report).toContain("Nothing needs doing");
    expect(report).toContain("Do not re-run the publish job");
    expect(report).not.toMatch(/exit 1/u);
  });
});

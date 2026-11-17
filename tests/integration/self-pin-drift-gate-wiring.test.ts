/**
 * The self-pin drift check must run somewhere that BLOCKS.
 *
 * A prover that exists and is never invoked, or is invoked in a job nothing
 * requires, is the recurring defect in this repository: a control that reports
 * success while permitting what it forbids. `scripts/check-self-dependency-pin.mjs`
 * decides correctly — that is asserted next door in
 * `tests/unit/scripts/check-self-dependency-pin.test.ts` — and this file asserts
 * the other half: that CI actually asks it, inside a job whose status context
 * this repository declares REQUIRED, with no override that would point it at a
 * fixture instead of the registry (CodySwannGT/lisa#3768).
 *
 * The last clause is not pedantry. A step carrying `--registry` or `--manifest`
 * would be green for a reason unrelated to what it checks, which is exactly how
 * the stale pin survived a month of green runs in the first place.
 * @module tests/integration/self-pin-drift-gate-wiring
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

/** Repository root, resolved from this file rather than the process cwd. */
const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** The package script every caller of the check goes through. */
const SCRIPT_TASK = "check:self-pin";

/** The job whose context this repository declares required. */
const REQUIRED_CONTEXT = "🧩 Plugin artifacts match source";

/** The workflow that reports that context. */
const WORKFLOW = ".github/workflows/plugins-sync.yml";

/** One workflow step, as far as this test needs to see it. */
interface Step {
  /** The step's shell command, when it has one. */
  readonly run?: string;
}

/** One workflow job, as far as this test needs to see it. */
interface Job {
  /** The job's display name — the half of the status context that varies. */
  readonly name?: string;
  /** The job's steps. */
  readonly steps?: readonly Step[];
}

/**
 * Read one JSON file from the repository root.
 * @param relative - Path relative to the repository root.
 * @returns The parsed document.
 */
function readJson(relative: string): Record<string, never> {
  return JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"));
}

/**
 * The steps of the job that reports the required context.
 * @returns Every step in that job.
 */
function requiredJobSteps(): readonly Step[] {
  const workflow = loadYaml(
    readFileSync(path.join(ROOT, WORKFLOW), "utf8")
  ) as { jobs: Record<string, Job> };
  const job = Object.values(workflow.jobs).find(
    candidate => candidate.name === REQUIRED_CONTEXT
  );
  expect(
    job,
    `no job in ${WORKFLOW} is named "${REQUIRED_CONTEXT}"`
  ).toBeDefined();
  return job?.steps ?? [];
}

describe("the self-pin drift check is wired where it blocks (#3768)", () => {
  it("declares the package script that every caller goes through", () => {
    const manifest = readJson("package.json") as unknown as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts[SCRIPT_TASK]).toBe(
      "node scripts/check-self-dependency-pin.mjs"
    );
  });

  it("runs the check inside the job that reports the required context", () => {
    const invocations = requiredJobSteps().filter(step =>
      (step.run ?? "").includes(SCRIPT_TASK)
    );

    expect(invocations).toHaveLength(1);
  });

  it("declares that context required, so the step blocks rather than informs", () => {
    const config = readJson(".lisa.config.json") as unknown as {
      github: {
        rulesets: {
          requiredChecks: Record<string, readonly { context: string }[]>;
        };
      };
    };
    const contexts = Object.values(
      config.github.rulesets.requiredChecks
    ).flatMap(group => group.map(entry => entry.context));

    expect(contexts).toContain(REQUIRED_CONTEXT);
  });

  it("points the check at the real registry and the real manifest", () => {
    const invocation = requiredJobSteps()
      .map(step => step.run ?? "")
      .find(run => run.includes(SCRIPT_TASK));

    expect(invocation).not.toContain("--registry");
    expect(invocation).not.toContain("--manifest");
  });
});

/** The workflow whose release job owns the self-pin raise. */
const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";

/** One deploy-workflow job, as far as the raise wiring needs to see it. */
interface DeployJob extends Job {
  /** Jobs this one waits for. */
  readonly needs?: readonly string[];
  /** The job's run condition. */
  readonly if?: string;
  /** Steps, with the action inputs the checkout carries. */
  readonly steps?: readonly (Step & {
    readonly uses?: string;
    readonly with?: Record<string, string>;
    readonly if?: string;
  })[];
}

/**
 * The deploy workflow's raise job.
 * @returns The job definition.
 */
function raiseJob(): DeployJob {
  const workflow = loadYaml(
    readFileSync(path.join(ROOT, DEPLOY_WORKFLOW), "utf8")
  ) as { jobs: Record<string, DeployJob> };
  const job = workflow.jobs.raise_self_pin;
  expect(job, `${DEPLOY_WORKFLOW} has no raise_self_pin job`).toBeDefined();
  return job as DeployJob;
}

describe("the release raises the self-pin the check guards (#4951)", () => {
  it("runs only after a successful npm publish on main", () => {
    const job = raiseJob();

    expect(job.needs).toEqual(
      expect.arrayContaining(["release", "publish_npm"])
    );
    expect(job.if).toContain("needs.publish_npm.result == 'success'");
    expect(job.if).toContain("== 'main'");
  });

  it("raises with the published version and proves the check before pushing", () => {
    const runs = (raiseJob().steps ?? []).map(step => step.run ?? "");
    const raise = runs.findIndex(run =>
      run.includes('scripts/raise-self-dependency-pin.mjs --version "$VERSION"')
    );
    const prove = runs.findIndex(run => run.includes(`bun run ${SCRIPT_TASK}`));
    const push = runs.findIndex(run =>
      run.includes("git push origin HEAD:main")
    );

    expect(raise).toBeGreaterThanOrEqual(0);
    expect(prove).toBeGreaterThan(raise);
    expect(push).toBeGreaterThan(prove);
    expect(runs[prove]).toContain("bun install --frozen-lockfile");
  });

  it("pushes with the deploy key the rulesets already let bypass", () => {
    const checkout = (raiseJob().steps ?? []).find(step =>
      (step.uses ?? "").startsWith("actions/checkout@")
    );

    expect(checkout?.with?.["ssh-key"]).toBe("${{ secrets.DEPLOY_KEY }}");
  });

  it("waits for npm to serve the version before re-resolving the lockfile", () => {
    const runs = (raiseJob().steps ?? []).map(step => step.run ?? "");
    const landed = runs.findIndex(run =>
      run.includes("scripts/check-npm-publish-landed.mjs")
    );
    const raise = runs.findIndex(run =>
      run.includes("scripts/raise-self-dependency-pin.mjs")
    );

    expect(landed).toBeGreaterThanOrEqual(0);
    expect(landed).toBeLessThan(raise);
  });
});

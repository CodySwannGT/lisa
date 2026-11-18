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

/** One deploy-workflow step, with the inputs and env this test reads. */
interface DeployStep extends Step {
  /** The action the step uses, when it uses one. */
  readonly uses?: string;
  /** The action's inputs. */
  readonly with?: Record<string, string | number | boolean>;
  /** The step's environment. */
  readonly env?: Record<string, string>;
  /** The step's run condition. */
  readonly if?: string;
}

/** One deploy-workflow job, as far as the raise wiring needs to see it. */
interface DeployJob {
  /** Jobs this one waits for. */
  readonly needs?: readonly string[];
  /** The job's run condition. */
  readonly if?: string;
  /** The job's environment. */
  readonly env?: Record<string, string>;
  /** The job's steps. */
  readonly steps?: readonly DeployStep[];
}

/** The job that computes and proves the raise, holding no secret. */
const PREPARE_JOB = "prepare_self_pin_raise";

/** The job that pushes the raise with the deploy key. */
const PUSH_JOB = "push_self_pin_raise";

/** The only secret reference either job may carry, and only in one place. */
const DEPLOY_KEY = "${{ secrets.DEPLOY_KEY }}";

/**
 * One job of the deploy workflow.
 * @param name - The job id.
 * @returns The job definition.
 */
function deployJob(name: string): DeployJob {
  const workflow = loadYaml(
    readFileSync(path.join(ROOT, DEPLOY_WORKFLOW), "utf8")
  ) as { jobs: Record<string, DeployJob> };
  const job = workflow.jobs[name];
  expect(job, `${DEPLOY_WORKFLOW} has no ${name} job`).toBeDefined();
  return job as DeployJob;
}

/**
 * The `run:` bodies of a job's steps, in order.
 * @param name - The job id.
 * @returns One string per step, empty for action steps.
 */
function runs(name: string): readonly string[] {
  return (deployJob(name).steps ?? []).map(step => step.run ?? "");
}

/**
 * Index of the first step whose `run:` contains the text.
 * @param name - The job id.
 * @param text - The text to find.
 * @returns The step index, or -1.
 */
function stepIndex(name: string, text: string): number {
  return runs(name).findIndex(run => run.includes(text));
}

/**
 * Every place a job mentions a secret, as `step-index:field` strings.
 * @param name - The job id.
 * @returns Where secrets are referenced.
 */
function secretReferences(name: string): readonly string[] {
  const job = deployJob(name);
  const jobLevel = Object.values(job.env ?? {}).some(value =>
    value.includes("secrets.")
  )
    ? ["job:env"]
    : [];
  const stepLevel = (job.steps ?? []).flatMap((step, index) =>
    JSON.stringify({ with: step.with, env: step.env, run: step.run }).includes(
      "secrets."
    )
      ? [`${index}`]
      : []
  );
  return [...jobLevel, ...stepLevel];
}

/**
 * The `actions/checkout` steps of a job.
 * @param name - The job id.
 * @returns Every checkout step in that job.
 */
function checkouts(name: string): readonly DeployStep[] {
  return (deployJob(name).steps ?? []).filter(step =>
    (step.uses ?? "").startsWith("actions/checkout@")
  );
}

describe("the release raises the self-pin the check guards (#4951)", () => {
  it("prepares only after a successful npm publish on main", () => {
    const job = deployJob(PREPARE_JOB);

    expect(job.needs).toEqual(
      expect.arrayContaining(["release", "publish_npm"])
    );
    expect(job.if).toContain("needs.publish_npm.result == 'success'");
    expect(job.if).toContain("== 'main'");
  });

  it("waits for npm, raises, then proves the lockfile, check, types and audit", () => {
    const landed = stepIndex(
      PREPARE_JOB,
      "scripts/check-npm-publish-landed.mjs"
    );
    const raise = stepIndex(
      PREPARE_JOB,
      'scripts/raise-self-dependency-pin.mjs --version "$VERSION"'
    );
    const prove = stepIndex(PREPARE_JOB, `bun run ${SCRIPT_TASK}`);
    const proof = runs(PREPARE_JOB)[prove] ?? "";

    expect(landed).toBeGreaterThanOrEqual(0);
    expect(raise).toBeGreaterThan(landed);
    expect(prove).toBeGreaterThan(raise);
    expect(proof).toContain("bun install --ignore-scripts --frozen-lockfile");
    expect(proof).toContain("bun run typecheck");
    expect(proof).toContain("bun run security:audit");
  });

  it("never runs a lifecycle script during the install", () => {
    const installs = runs(PREPARE_JOB)
      .flatMap(run => run.split("\n"))
      .map(line => line.trim())
      .filter(line => line.startsWith("bun install"));

    expect(installs.length).toBeGreaterThan(0);
    installs.forEach(line => expect(line).toContain("--ignore-scripts"));
  });

  it("holds no secret and persists no credential while dependency code runs", () => {
    expect(secretReferences(PREPARE_JOB)).toEqual([]);
    expect(checkouts(PREPARE_JOB)).not.toHaveLength(0);
    checkouts(PREPARE_JOB).forEach(step => {
      expect(step.with?.["persist-credentials"]).toBe(false);
      expect(step.with?.["ssh-key"]).toBeUndefined();
    });
  });

  it("refuses to hand over anything but package.json and bun.lock", () => {
    const guard = stepIndex(PREPARE_JOB, "git status --porcelain");
    const upload = (deployJob(PREPARE_JOB).steps ?? []).findIndex(step =>
      (step.uses ?? "").startsWith("actions/upload-artifact@")
    );

    expect(guard).toBeGreaterThan(
      stepIndex(PREPARE_JOB, `bun run ${SCRIPT_TASK}`)
    );
    expect(upload).toBeGreaterThan(guard);
    expect(
      String(deployJob(PREPARE_JOB).steps?.[upload]?.with?.path)
        .trim()
        .split(/\s+/)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual(["bun.lock", "package.json"]);
  });

  it("pushes from a job that installs nothing and runs no dependency code", () => {
    const pushRuns = runs(PUSH_JOB).join("\n");

    expect(deployJob(PUSH_JOB).needs).toContain(PREPARE_JOB);
    // A package-manager COMMAND, not the word inside `bun.lock`.
    expect(pushRuns).not.toMatch(/(?:^|[\s;&|(])(?:bun|npm|npx|yarn|pnpm)\s/m);
    expect(pushRuns).toContain("scripts/verify-self-pin-raise.mjs");
    checkouts(PUSH_JOB).forEach(step => {
      expect(step.with?.["persist-credentials"]).toBe(false);
      expect(step.with?.["ssh-key"]).toBeUndefined();
    });
  });

  it("loads the deploy key only in the final push step, after the proof", () => {
    const steps = deployJob(PUSH_JOB).steps ?? [];
    const last = steps.length - 1;
    const verify = stepIndex(PUSH_JOB, "scripts/verify-self-pin-raise.mjs");

    expect(secretReferences(PUSH_JOB)).toEqual([`${last}`]);
    expect(steps[last]?.env?.DEPLOY_KEY).toBe(DEPLOY_KEY);
    expect(steps[last]?.run).toContain("HEAD:main");
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(verify).toBeLessThan(last);
    expect(runs(PUSH_JOB)[verify]).toContain("git status --porcelain");
  });
});

/**
 * The comparison that OBSERVES which copy of the registry the gates ran.
 *
 * ## The claim that was never observed
 *
 * The identity stamp reports a `registry path`, and a reader takes that to
 * mean "these are the bytes that produced the verdicts on this run". Two
 * different claims hide inside it: that the stamp is self-consistent — the
 * digest it printed really is the digest of the file at the path it printed —
 * and that the file it printed is the file the GATE jobs executed. Only the
 * first was ever demonstrated, by a single-process digest check. The second
 * rested on an invariant over the workflow FILE: the stamp job installs before
 * its search exactly when some other job in that workflow does. That is an
 * argument about YAML, and a change that breaks the correspondence without
 * breaking the YAML shape satisfies it.
 *
 * ## What this suite pins
 *
 * The instrument, not the observation. The observation happens on a runner —
 * two jobs resolve a path, a third compares them — and nothing here can make
 * it happen. What is checkable without a runner is that the instrument exists,
 * that it reads values the other jobs PRODUCED rather than re-deriving them,
 * that it reaches every verdict it claims to, and that it cannot report
 * agreement on a run where it could not look.
 *
 * The last one is the reason this file exists at all. The healthy state of the
 * comparison is "the paths are equal", so every way of failing to look —
 * a stamp that resolved nothing, a gate job that never ran, a comparison that
 * died before printing — also produces "no divergence found". An instrument
 * that reports success because it could not see is the exact defect the stamp
 * was built to prevent, reintroduced one level up.
 * @module tests/integration/registry-path-agreement
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The workflow carrying both the stamp and the jobs that execute gates. */
const QUALITY = path.join(REPO_ROOT, ".github/workflows/quality.yml");

/** The job that compares the stamped copy against the executed copy. */
const COMPARISON_JOB = "registry_path_agreement";

/** The jobs whose resolved path the comparison reads, and what each is for. */
const OBSERVED_JOBS = {
  lisa_identity: "registry_path",
  gate_plan: "registry_path",
  lint: "registry_path",
  test_unit: "registry_path",
} as const;

/** One job of a parsed workflow, in the shape these assertions need. */
type Job = {
  readonly if?: unknown;
  readonly needs?: readonly string[];
  readonly outputs?: Readonly<Record<string, string>>;
  readonly steps?: readonly {
    readonly id?: string;
    readonly if?: unknown;
    readonly run?: string;
    readonly env?: Readonly<Record<string, string>>;
  }[];
};

/**
 * The parsed quality workflow, as a map of job id to job.
 * @returns Every job in `quality.yml`.
 */
function jobs(): Readonly<Record<string, Job>> {
  return loadWorkflow(QUALITY).jobs as unknown as Record<string, Job>;
}

/**
 * The comparison step's shell body.
 * @returns The shell the comparison job runs, or "" when the job is gone.
 */
const comparisonBody = (): string =>
  jobs()[COMPARISON_JOB]?.steps?.[0]?.run ?? "";

/**
 * The comparison program itself, lifted out of the shell that invokes it.
 *
 * Extracted rather than duplicated. A second copy of the program kept beside
 * the workflow would be the thing under test only until the two drifted, and
 * the drift is silent: this suite would stay green against a program the
 * runner no longer executes.
 * @returns The JavaScript the comparison step runs.
 */
function comparisonProgram(): string {
  const body = comparisonBody();
  const opener = "node -e '";
  const start = body.indexOf(opener);
  const end = body.indexOf("\n' || true", start);
  expect(
    start,
    "the comparison step no longer invokes node -e"
  ).toBeGreaterThan(-1);
  expect(
    end,
    "the comparison program is not closed as expected"
  ).toBeGreaterThan(start);
  return body.slice(start + opener.length, end);
}

/** What a single simulated run reports. */
type Observation = {
  readonly status: number | null;
  readonly stdout: string;
};

/**
 * Run the comparison program over one set of job outputs.
 * @param env - The `needs` values a runner would have handed it.
 * @returns The exit status and everything it printed.
 */
function compare(env: Readonly<Record<string, string>>): Observation {
  const run = boundedSpawnSync({
    label: "registry path comparison",
    command: process.execPath,
    args: ["-e", comparisonProgram()],
    cwd: REPO_ROOT,
    childMayExitBeforeReading: true,
    env: {
      PATH: process.env.PATH ?? "",
      STAMP_RESULT: "success",
      LINT_RESULT: "success",
      TEST_UNIT_RESULT: "success",
      PLAN_RESULT: "success",
      ...env,
    },
  });
  return { status: run.status, stdout: run.stdout };
}

/** A run on which every job resolved the copy the installer put in place. */
const INSTALLED =
  "/w/node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-gates.mjs";

/** The copy `lisa apply` writes into a consuming repository. */
const CHECKED_IN = "/w/scripts/lisa-gates.mjs";

describe("the comparison instrument", () => {
  it("reports agreement only when a gate job executed the stamped copy", () => {
    const run = compare({
      STAMP_PATH: INSTALLED,
      LINT_PATH: INSTALLED,
      TEST_UNIT_PATH: INSTALLED,
      PLAN_PATH: CHECKED_IN,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("::notice");
    expect(run.stdout).toContain("AGREED");
  });

  it("names both paths when the stamp measured a copy the gates did not run", () => {
    const run = compare({
      STAMP_PATH: CHECKED_IN,
      LINT_PATH: INSTALLED,
      TEST_UNIT_PATH: INSTALLED,
      PLAN_PATH: CHECKED_IN,
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("DIVERGED");
    // Both, not one. A divergence report naming only the copy it disliked
    // leaves a reader unable to tell which of the two is the surprise.
    expect(run.stdout).toContain(CHECKED_IN);
    expect(run.stdout).toContain(INSTALLED);
  });

  it("separates a stamp that resolved nothing from a stamp that disagreed", () => {
    const run = compare({
      STAMP_PATH: "",
      LINT_PATH: INSTALLED,
      TEST_UNIT_PATH: INSTALLED,
      PLAN_PATH: "",
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("NOT_DETERMINED");
    expect(run.stdout).toContain("the identity job reported no resolved");
    expect(run.stdout).toContain("NOT the finding that the two copies differ");
  });

  it("refuses to call a run clean when no gate job resolved anything", () => {
    // The failure this forbids: every gate skipped, nothing executed, and a
    // comparison that finds no difference because it had nothing to compare.
    const run = compare({
      STAMP_PATH: INSTALLED,
      LINT_PATH: "",
      TEST_UNIT_PATH: "",
      PLAN_PATH: "",
      LINT_RESULT: "skipped",
      TEST_UNIT_RESULT: "skipped",
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("NOT_DETERMINED");
    expect(run.stdout).toContain("::error");
    expect(run.stdout).not.toContain("AGREED");
  });

  it("never lets a job that installed nothing stand in for a gate job", () => {
    // `gate_plan` resolves without installing, so it can legitimately land on
    // a copy no gate executes. It is reported so the comparison cannot be
    // closed by leaving it out, and it may never satisfy the comparison on
    // its own.
    const run = compare({
      STAMP_PATH: INSTALLED,
      LINT_PATH: "",
      TEST_UNIT_PATH: "",
      PLAN_PATH: INSTALLED,
      LINT_RESULT: "skipped",
      TEST_UNIT_RESULT: "skipped",
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("gate_plan=");
  });
});

describe("the wiring the observation needs", () => {
  it.each(Object.entries(OBSERVED_JOBS))(
    "%s carries its resolved registry path out as an output",
    (job, output) => {
      expect(jobs()[job]?.outputs?.[output]).toBeTruthy();
    }
  );

  it("depends on every job it claims to have observed", () => {
    const byName = (left: string, right: string): number =>
      left.localeCompare(right);
    expect([...(jobs()[COMPARISON_JOB]?.needs ?? [])].sort(byName)).toEqual(
      Object.keys(OBSERVED_JOBS).sort(byName)
    );
  });

  it("reads the choice each gate job made instead of searching again", () => {
    // A second search is a second answer that can disagree with the first,
    // and the property under observation is about the copy the job EXECUTES.
    for (const job of ["lint", "test_unit"]) {
      const step = jobs()[job]?.steps?.find(each => each.id === "registry");
      expect(step, `${job} records no resolved path`).toBeTruthy();
      expect(step?.env?.RESOLVER).toBe("${{ steps.gate.outputs.resolver }}");
      expect(step?.run ?? "").not.toContain("for candidate in");
    }
  });

  it("still observes a run whose gate jobs failed", () => {
    // A failing job resolved a copy too, and a run that went wrong is where
    // the divergence is likeliest. `success()` would look away from exactly
    // the runs worth looking at.
    expect(jobs()[COMPARISON_JOB]?.if).toBe("${{ always() }}");
    for (const job of ["lint", "test_unit"])
      expect(jobs()[job]?.steps?.find(each => each.id === "registry")?.if).toBe(
        "always()"
      );
  });

  it("cannot redden the run it reports on", () => {
    // Report only, like the stamp it checks: a failed job here fails the
    // reusable workflow, which fails the caller's job, which in some
    // consumers is a required context.
    expect(comparisonBody()).toMatch(/\nexit 0\n?$/);
  });

  it("reports a verdict it could not read as unobserved rather than clean", () => {
    // The comparison writes its verdict to a file the shell reads back, so a
    // program that dies before printing is still reported. Without this the
    // silence of a crashed comparison is indistinguishable from agreement.
    const body = comparisonBody();
    expect(body).toContain("VERDICT_FILE");
    expect(body).toContain("AGREED | DIVERGED | NOT_DETERMINED");
    expect(body).toContain("never as agreement");
  });
});

/**
 * Behavioural proof of the `@main` staleness detector (CodySwannGT/lisa#3698).
 *
 * Every consumer reference to a Lisa reusable workflow tracks `@main` by owner
 * ruling, so one push here changes what gates — and what ships — in every
 * downstream repository at once, with no pull request and no record there. An
 * unchanged workflow and a rewritten one produced identical silence, which is
 * also why an audit could not reproduce itself: an investigation that fetches
 * `@main` afterwards is reading a different artifact than the run it is
 * investigating, and cannot tell.
 *
 * **This file drives the detector; it does not look for it.** The issue is
 * explicit about the difference, and it is the whole reason the file exists: a
 * test that greps a caller template for `expected_workflow_contract_major`
 * proves SEEDING, not DETECTION, and would pass unchanged against an assertion
 * whose comparison had been deleted. So every case below extracts the shell
 * body that a real reusable workflow actually inlines, runs it, and reads the
 * exit code.
 *
 * The headline case moves a reusable's contract major and observes a caller
 * fail. The fixture consumer is deliberately one that does NOT already satisfy
 * the precondition — it holds the major the shipped template seeds today, and
 * the workflow it calls has moved past it — because Lisa is not a consumer of
 * its own workflows the way a host project is, and a check verified only
 * against this repository's own runs can report success having measured
 * nothing.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/workflow-contract-assertion
 */
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

/** The reusable whose inlined assertion these cases execute. */
const REUSABLE = ".github/workflows/gates.yml";

/** A shipped caller template that calls it — the fixture consumer's source. */
const CALLER = "all/create-only/.github/workflows/continuous-gates.yml";

/** The job every covered reusable carries. */
const JOB_ID = "workflow_contract";

/** The input the caller seeds and the workflow compares. */
const INPUT_NAME = "expected_workflow_contract_major";

/** Minimal shape of the two workflow files these cases read. */
type Workflow = {
  jobs?: Record<
    string,
    {
      uses?: string;
      with?: Record<string, unknown>;
      steps?: { env?: Record<string, string>; run?: string }[];
    }
  >;
};

/**
 * Parse a workflow file from this repository.
 *
 * @param relative - repo-relative path to the workflow.
 * @returns The parsed document.
 */
function workflow(relative: string): Workflow {
  return yaml.load(readFileSync(path.resolve(relative), "utf8")) as Workflow;
}

/** The contract step the reusable ships, as it will run on a consumer. */
const step = (() => {
  const job = workflow(REUSABLE).jobs?.[JOB_ID];
  const found = (job?.steps ?? []).find(
    candidate => candidate.env?.DECLARED_MAJOR !== undefined
  );
  if (found?.run === undefined || found.env?.DECLARED_MAJOR === undefined) {
    throw new Error(`${REUSABLE} carries no ${JOB_ID} assertion step`);
  }
  return { declared: found.env.DECLARED_MAJOR, run: found.run };
})();

/** What a NEW consumer is handed today, read from the shipped template. */
const seeded = (() => {
  const jobs = Object.values(workflow(CALLER).jobs ?? {});
  const caller = jobs.find(job =>
    (job.uses ?? "").includes("/.github/workflows/gates.yml@")
  );
  const value = caller?.with?.[INPUT_NAME];
  if (value === undefined) throw new Error(`${CALLER} seeds no ${INPUT_NAME}`);
  return String(value);
})();

/**
 * Execute the assertion exactly as a consumer's runner would.
 *
 * @param declared - the major the reusable declares on `@main` right now.
 * @param expected - the major the calling repository was seeded with.
 * @returns The exit code and combined output.
 */
function assertContract(
  declared: string,
  expected: string
): { code: number; output: string } {
  try {
    const stdout = boundedExecFileSync({
      label: "workflow-contract-assertion",
      command: "/bin/sh",
      args: ["-c", step.run],
      env: {
        DECLARED_MAJOR: declared,
        EXPECTED_MAJOR: expected,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        WORKFLOW_FILE: "gates.yml",
      },
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.exitCode === "number" ? failure.exitCode : -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("the reusable moves past the caller's contract major", () => {
  it("fails, naming the major it expected and the one it found", () => {
    // The fixture consumer holds what the shipped template seeds today. The
    // workflow it calls has since incremented — the state a `@main` consumer
    // reaches with no pull request in their own repository.
    const moved = String(Number(step.declared) + 1);
    const result = assertContract(moved, seeded);

    expect(result.code).toBe(1);
    expect(result.output).toContain(`declares contract major ${moved}`);
    expect(result.output).toContain(`seeded against major ${seeded}`);
  });

  it("fails the same way when the caller is AHEAD of the workflow", () => {
    // A revert upstream is drift too, and the caller cannot tell which
    // direction it is standing in until the run says so.
    const behind = String(Number(seeded) + 1);
    const result = assertContract(seeded, behind);

    expect(result.code).toBe(1);
    expect(result.output).toContain(`seeded against major ${behind}`);
  });
});

describe("the reusable moves within the caller's contract major", () => {
  it("does not fail, because a compatible change is the point of @main", () => {
    const result = assertContract(step.declared, seeded);

    expect(result.code).toBe(0);
    expect(result.output).toContain(
      `contract major ${step.declared} agreed: gates.yml has not declared a break`
    );
  });

  it("agrees with the major the shipped caller template seeds", () => {
    // If these two ever disagree, a consumer taking the template today would
    // be red on arrival — the detector reporting a break Lisa itself shipped.
    expect(seeded).toBe(step.declared);
  });
});

describe("a caller that declares nothing", () => {
  it.each([
    ["passes no value at all", ""],
    ["passes a non-numeric value", "one"],
    ["passes a version rather than a major", "1.0.0"],
    ["passes a shell-shaped value", "$(touch /tmp/lisa-3698); 1"],
  ])("says NOT DETERMINED out loud and does not fail: %s", (_case, value) => {
    const result = assertContract(step.declared, value);

    // Not failed: caller workflows ship create-only and are never overwritten,
    // so every consumer seeded before this shipped passes nothing while the
    // workflow is live in all of them on their next run. Failing closed here
    // would redden the fleet over a file Lisa cannot update on their behalf.
    expect(result.code).toBe(0);
    // Not silent either. Silence IS the defect.
    expect(result.output).toContain("NOT DETERMINED");
    expect(result.output).toContain("this check is measuring nothing");
    expect(result.output).toContain(
      `Add 'expected_workflow_contract_major: ${step.declared}'`
    );
    // The caller-supplied value is reported, never executed.
    expect(result.output).toContain(
      `expected_workflow_contract_major='${value}'`
    );
  });
});

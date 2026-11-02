/**
 * The one question both the seed guard and `lisa doctor` ask of an evidence
 * workflow: does it wake when the reviewer reports through a check run, and may
 * its token read that run? (CodySwannGT/lisa#4553)
 *
 * The frozen pre-fix seed is the population the doctor check exists to find;
 * the shapes around it pin each spelling a host's edited copy may use, in both
 * directions, so a reader that answered "yes" or "no" to everything fails here.
 * @module tests/unit/core/third-party-evidence-seed
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isCurrentEvidenceSeed,
  readEvidenceSeed,
} from "../../../src/core/third-party-evidence-seed.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** The seed exactly as Lisa shipped it before this fix. */
const PRE_FIX_SEED = fs.readFileSync(
  path.join(
    ROOT,
    "tests/fixtures/third-party-review-evidence-seed/pre-4553.yml"
  ),
  "utf8"
);

/** A job that runs the prover, under whatever permissions a case declares. */
const PROVER_JOB = `jobs:
  evidence:
    runs-on: ubuntu-latest
    steps:
      - run: node scripts/check-third-party-review-evidence.mjs --sha="$SHA"
`;

/**
 * A workflow assembled from a trigger block and a permissions block.
 * @param on - The `on:` block, indented under its key
 * @param permissions - The `permissions:` block, or empty for none
 * @param jobs - The `jobs:` block
 * @returns Workflow source
 */
function workflow(on: string, permissions: string, jobs = PROVER_JOB): string {
  return `name: evidence\n${on}\n${permissions}\n${jobs}`;
}

const STATUS_ONLY = "on:\n  status:";
const CHECKS_READ = "permissions:\n  contents: read\n  checks: read";

describe("readEvidenceSeed", () => {
  it("finds every gap in the seed Lisa shipped before the fix", () => {
    const reading = readEvidenceSeed(PRE_FIX_SEED);

    expect(reading).toEqual({
      wakesOnCheckRun: false,
      readsChecks: false,
      readsStatusesAndPullRequests: true,
      readsRunIdentity: false,
      keysConcurrencyPerRun: false,
      checksOutEventHead: true,
      declaresPermissions: true,
    });
    expect(isCurrentEvidenceSeed(reading)).toBe(false);
  });

  it.each([
    ["a completed filter", "on:\n  check_run:\n    types: [completed]"],
    ["a scalar completed filter", "on:\n  check_run:\n    types: completed"],
    ["no activity filter", "on:\n  check_run:"],
    ["a list of events", "on: [status, check_run]"],
    ["a single event", "on: check_run"],
  ])("wakes on a check run declared with %s", (_name, on) => {
    expect(readEvidenceSeed(workflow(on, CHECKS_READ)).wakesOnCheckRun).toBe(
      true
    );
  });

  it.each([
    ["status only", STATUS_ONLY],
    [
      "a filter that leaves completed out",
      "on:\n  check_run:\n    types: [created]",
    ],
    [
      "check suites rather than runs",
      "on:\n  check_suite:\n    types: [completed]",
    ],
  ])("does not wake on a check run with %s", (_name, on) => {
    expect(readEvidenceSeed(workflow(on, CHECKS_READ)).wakesOnCheckRun).toBe(
      false
    );
  });

  it.each([
    ["checks: read", CHECKS_READ],
    ["checks: write", "permissions:\n  checks: write"],
    ["read-all", "permissions: read-all"],
    ["write-all", "permissions: write-all"],
  ])("lets the token read check runs under %s", (_name, permissions) => {
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, permissions)).readsChecks
    ).toBe(true);
  });

  it.each([
    ["no checks scope", "permissions:\n  contents: read\n  statuses: read"],
    ["checks: none", "permissions:\n  checks: none"],
    ["an empty grant", "permissions: {}"],
    ["no permissions block at all", ""],
  ])(
    "does not let the token read check runs under %s",
    (_name, permissions) => {
      expect(
        readEvidenceSeed(workflow(STATUS_ONLY, permissions)).readsChecks
      ).toBe(false);
    }
  );

  it("judges the prover's job by its own permissions when it declares them", () => {
    const overridden = `jobs:
  evidence:
    permissions:
      contents: read
    steps:
      - run: node scripts/check-third-party-review-evidence.mjs
`;
    const granted = `jobs:
  evidence:
    permissions:
      checks: read
    steps:
      - run: node scripts/check-third-party-review-evidence.mjs
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, overridden))
        .readsChecks
    ).toBe(false);
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, "", granted)).readsChecks
    ).toBe(true);
  });

  it("ignores a job that does not run the prover", () => {
    const jobs = `jobs:
  unrelated:
    permissions:
      contents: read
    steps:
      - run: echo hello
  evidence:
    steps:
      - run: node scripts/check-third-party-review-evidence.mjs
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, jobs)).readsChecks
    ).toBe(true);
  });

  it("holds every job to the grant when none names the prover", () => {
    const jobs = `jobs:
  renamed:
    permissions:
      contents: read
    steps:
      - run: node scripts/some-other-name.mjs
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, jobs)).readsChecks
    ).toBe(false);
  });

  it("refuses a workflow with no jobs rather than calling its token sufficient", () => {
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, "jobs: {}"))
        .readsChecks
    ).toBe(false);
  });

  it.each([
    ["unparseable YAML", "on:\n  status:\n  - [unbalanced\n"],
    ["a scalar document", "just a string"],
  ])("throws on %s instead of guessing", (_name, source) => {
    expect(() => readEvidenceSeed(source)).toThrow();
  });

  it.each([
    [
      "through env",
      "env:\n          SHA: ${{ github.event.check_run.head_sha }}\n          NAME: ${{ github.event.check_run.name }}\n        ",
    ],
    ["inline in the script", ""],
  ])("reads the run's commit and name wired %s", (_name, env) => {
    const inline = env === "";
    const jobs = `jobs:
  evidence:
    steps:
      - ${env}run: node scripts/check-third-party-review-evidence.mjs${inline ? ' --sha="${{ github.event.check_run.head_sha }}" --context="${{ github.event.check_run.name }}"' : ""}
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, jobs))
        .readsRunIdentity
    ).toBe(true);
  });

  it("does not credit a copy that reads only the run's commit", () => {
    const jobs = `jobs:
  evidence:
    steps:
      - env:
          SHA: \${{ github.event.check_run.head_sha }}
        run: node scripts/check-third-party-review-evidence.mjs
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, jobs))
        .readsRunIdentity
    ).toBe(false);
  });

  it.each([
    ["the check run's head", "${{ github.event.check_run.head_sha }}", true],
    ["a status's commit", "${{ github.event.sha || inputs.sha }}", true],
    ["only the manual input", "${{ inputs.sha }}", false],
    [
      "the repository's default branch",
      "${{ github.event.repository.default_branch }}",
      false,
    ],
  ])("judges a checkout of %s", (_name, ref, expected) => {
    const jobs = `jobs:
  evidence:
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${ref}
      - run: node scripts/check-third-party-review-evidence.mjs
`;

    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ, jobs))
        .checksOutEventHead
    ).toBe(expected);
  });

  it("reads the run's commit and name from a workflow-level env too", () => {
    const text = `name: evidence
on:
  status:
${CHECKS_READ}
env:
  SHA: \${{ github.event.check_run.head_sha }}
  NAME: \${{ github.event.check_run.name }}
${PROVER_JOB}`;

    expect(readEvidenceSeed(text).readsRunIdentity).toBe(true);
  });

  it.each([
    ["no concurrency at all", "", true],
    [
      "queued runs that never cancel",
      "concurrency:\n  group: evidence-${{ github.event.sha }}\n",
      true,
    ],
    [
      "cancelling runs keyed on the check run",
      "concurrency:\n  group: evidence-${{ github.event.check_run.head_sha }}-${{ github.event.check_run.name }}\n  cancel-in-progress: true\n",
      true,
    ],
    [
      "cancelling runs keyed on a status's commit alone",
      "concurrency:\n  group: evidence-${{ github.event.sha || inputs.sha }}\n  cancel-in-progress: true\n",
      false,
    ],
  ])("judges the concurrency of %s", (_name, concurrency, expected) => {
    expect(
      readEvidenceSeed(
        `${STATUS_ONLY}\n${CHECKS_READ}\n${concurrency}${PROVER_JOB}`
      ).keysConcurrencyPerRun
    ).toBe(expected);
  });

  it("requires the token to read statuses and pull requests as well", () => {
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ))
        .readsStatusesAndPullRequests
    ).toBe(false);
    expect(
      readEvidenceSeed(
        workflow(
          STATUS_ONLY,
          "permissions:\n  checks: read\n  statuses: read\n  pull-requests: read"
        )
      ).readsStatusesAndPullRequests
    ).toBe(true);
  });

  it("says whether any permissions block governs the prover's job", () => {
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, "")).declaresPermissions
    ).toBe(false);
    expect(
      readEvidenceSeed(workflow(STATUS_ONLY, CHECKS_READ)).declaresPermissions
    ).toBe(true);
  });
});

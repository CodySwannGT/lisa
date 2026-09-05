/**
 * The publish workflows must refuse a tag, version or package manager that is
 * shell syntax rather than an identifier (#3717).
 *
 * `publish-to-npm.yml` interpolated `${{ inputs.tag }}` into `git checkout`,
 * `${{ inputs.version }}` into `npm version`, and `${{ inputs.package_manager }}`
 * into command position. Actions substitutes before the shell parses, so each
 * was shell source text on the publish path of a public package.
 *
 * Both copies are covered because they reach consumers by DIFFERENT routes:
 * `.github/` is not in the npm `files` allowlist, so the root workflow is taken
 * at `@main` and lands at merge; `npm-package/` IS in the allowlist, so the
 * create-only copy ships with the package and seeds once at project creation.
 * A fix to the second does not reach any repository that already exists.
 *
 * As in `release-version-injection`, the step body is EXECUTED rather than
 * grepped, and a rejection control proves the harness delivers a payload a
 * vulnerable line would act on.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/publish-npm-injection
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/** The two copies, and the delivery route each one takes. */
const WORKFLOWS: readonly (readonly [string, string])[] = [
  [".github/workflows/publish-to-npm.yml", "consumed at @main, lands at merge"],
  [
    "npm-package/create-only/.github/workflows/publish-to-npm.yml",
    "ships with the package, seeds at project creation only",
  ],
];

/** The step that fails closed before any value reaches a command. */
const VALIDATE_INPUTS = "Validate inputs";

/** A well-formed set of inputs, used as the baseline every case varies from. */
const GOOD = {
  RELEASE_TAG: "v1.2.3",
  RELEASE_VERSION: "1.2.3",
  RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
  PACKAGE_MANAGER: "bun",
} as const;

/** Values that are shell syntax rather than an identifier. */
const PAYLOADS: readonly string[] = [
  "1.2.3; touch pwned",
  "1.2.3$(touch pwned)",
  "1.2.3`touch pwned`",
  "1.2.3 | touch pwned",
];

/** The shape of the parsed workflow this test reads. */
interface Workflow {
  readonly jobs: Readonly<
    Record<
      string,
      {
        readonly steps?: readonly {
          readonly name?: string;
          readonly run?: string;
        }[];
      }
    >
  >;
}

/**
 * Read one step's shipped `run:` body out of a workflow file.
 * @param workflowPath - Repository-relative workflow path
 * @param stepName - The step's `name:`
 * @returns The step's script, exactly as it ships
 */
function stepBody(workflowPath: string, stepName: string): string {
  const file = path.join(process.cwd(), workflowPath);
  const workflow = loadYaml(fs.readFileSync(file, "utf-8")) as Workflow;
  for (const job of Object.values(workflow.jobs)) {
    const step = job.steps?.find(s => s.name === stepName);
    if (step?.run !== undefined) return step.run;
  }
  throw new Error(`step not found in ${workflowPath}: ${stepName}`);
}

/**
 * Run a script in a disposable sandbox and report what it left behind.
 *
 * The sandbox is removed before returning — the scratch-leak guard fails any
 * fixture that outlives its test — so nothing may be inspected afterwards.
 * @param script - Shell script to execute
 * @param env - Environment for the run
 * @returns Exit status, and whether a payload's side effect fired
 */
function runStep(
  script: string,
  env: Readonly<Record<string, string>>
): { readonly status: number; readonly executed: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-publish-injection-"));
  try {
    const scriptPath = path.join(dir, "step.sh");
    fs.writeFileSync(scriptPath, script);
    const outcome = boundedSpawnSync({
      command: "bash",
      args: [scriptPath],
      cwd: dir,
      label: "publish-to-npm step body",
      env: {
        ...process.env,
        ...env,
        GITHUB_OUTPUT: path.join(dir, "github_output"),
        GITHUB_STEP_SUMMARY: path.join(dir, "step_summary"),
      },
    });
    return {
      status: outcome.status ?? -1,
      executed: fs.existsSync(path.join(dir, "pwned")),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.each(WORKFLOWS)(
  "publish-to-npm injection gates: %s (%s)",
  workflowPath => {
    const validate = (): string => stepBody(workflowPath, VALIDATE_INPUTS);

    it("accepts a well-formed tag, version and package manager", () => {
      expect(runStep(validate(), GOOD).status).toBe(0);
    });

    it.each(PAYLOADS)("refuses tag %j", payload => {
      const result = runStep(validate(), { ...GOOD, RELEASE_TAG: payload });

      expect(result.status).not.toBe(0);
      expect(result.executed).toBe(false);
    });

    it.each(PAYLOADS)("refuses version %j", payload => {
      const result = runStep(validate(), { ...GOOD, RELEASE_VERSION: payload });

      expect(result.status).not.toBe(0);
      expect(result.executed).toBe(false);
    });

    it("refuses a package manager outside the allowlist", () => {
      const result = runStep(validate(), {
        ...GOOD,
        PACKAGE_MANAGER: "npm; touch pwned",
      });

      expect(result.status).not.toBe(0);
      expect(result.executed).toBe(false);
    });

    it("interpolates nothing into any run body", () => {
      const file = path.join(process.cwd(), workflowPath);
      const workflow = loadYaml(fs.readFileSync(file, "utf-8")) as Workflow;
      const offenders: string[] = [];
      for (const job of Object.values(workflow.jobs)) {
        for (const step of job.steps ?? []) {
          if (typeof step.run === "string" && step.run.includes("${{")) {
            offenders.push(step.name ?? "(unnamed)");
          }
        }
      }

      expect(offenders).toEqual([]);
    });
  }
);

describe("rejection control", () => {
  it("proves the payload would act on a vulnerable line", () => {
    // What the pre-fix `Wait for tag` step became once Actions substituted a
    // hostile tag into it. This is the defect, reproduced.
    const result = runStep("git checkout 1.2.3; touch pwned || true", {});

    expect(result.executed).toBe(true);
  });
});

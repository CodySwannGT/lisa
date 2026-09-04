/**
 * A version string must reach the release command as an ARGUMENT, never as
 * shell source (#3717).
 *
 * `release.yml` interpolated `${{ steps.version.outputs.version }}` directly
 * into `npx standard-version --release-as ...` in a job holding
 * `contents: write`. A `${{ }}` expression is substituted by Actions BEFORE the
 * shell parses the script, so the value was source text: a version carrying
 * shell metacharacters became part of the command. Under the `custom` release
 * strategy that value is `inputs.custom_version` passed through untouched.
 *
 * Three things about this test are deliberate.
 *
 * First, it EXECUTES the shipped `run:` bodies rather than grepping them. The
 * ticket's own warning is that "a normal release still succeeds" is true today,
 * against the defect — so an acceptance case proves nothing on its own.
 *
 * Second, it carries a rejection control. `PRE_FIX_RELEASE_AS` is the line that
 * shipped before this change, with GitHub's substitution simulated the way
 * Actions performs it. It is asserted to EXECUTE the payload. Without it,
 * "the payload does not execute" would also be satisfied by a harness that
 * silently failed to deliver the payload at all.
 *
 * Third, it covers BOTH halves of the remedy independently: the semver gate in
 * `Determine Version` (validation) and the `env:` passing in `Generate
 * Changelog` (no interpolation into source). Either alone leaves a hole —
 * validation still lets a value flow into source text, and env-passing alone
 * accepts a malformed version.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/release-version-injection
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const WORKFLOW = path.join(process.cwd(), ".github/workflows/release.yml");

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

/** The pre-fix line, kept verbatim as the rejection control. */
const PRE_FIX_RELEASE_AS =
  "npx standard-version --release-as ${{ steps.version.outputs.version }} --skip.tag";

/**
 * Payloads that are shell syntax rather than versions. Each would run
 * `touch pwned` if the value were ever treated as source rather than argument.
 */
const INJECTION_PAYLOADS: readonly string[] = [
  "1.2.3; touch pwned",
  "1.2.3 && touch pwned",
  "1.2.3$(touch pwned)",
  "1.2.3`touch pwned`",
  '1.2.3" ; touch pwned ; echo "',
  "1.2.3 | touch pwned",
];

/** Everything a run leaves behind, collected before its sandbox is removed. */
interface StepOutcome {
  readonly status: number;
  readonly outputs: string;
  /** Whether the payload's side effect fired — the injection actually ran. */
  readonly executed: boolean;
  /** One entry per argv word the stubbed `npx` received. */
  readonly npxArgv: readonly string[];
}

/** A non-prod environment, which keeps the step off the npm-registry path. */
const ENVIRONMENT = "dev";

/** The release strategy that passes `inputs.custom_version` through untouched. */
const CUSTOM_STRATEGY = "custom";

/** The job that computes and publishes the version. */
const VERSION_JOB = "version";

/** The step that validates the version before publishing it as an output. */
const DETERMINE_VERSION = "Determine Version";

/** The step that passes the version to `standard-version`. */
const GENERATE_CHANGELOG = "Generate Changelog";

/**
 * Read one step's shipped `run:` body out of the real workflow.
 * @param jobName - Job key in `jobs:`
 * @param stepName - The step's `name:`
 * @returns The step's script, exactly as it ships
 */
function stepBody(jobName: string, stepName: string): string {
  const workflow = loadYaml(fs.readFileSync(WORKFLOW, "utf-8")) as Workflow;
  const step = workflow.jobs[jobName]?.steps?.find(s => s.name === stepName);
  if (step?.run === undefined)
    throw new Error(`step not found in ${WORKFLOW}: ${jobName} / ${stepName}`);
  return step.run;
}

/**
 * Run a script in a disposable sandbox and collect its observable effects.
 *
 * The sandbox is removed before returning — the suite's scratch-leak guard
 * fails any fixture that outlives the test that made it, so nothing may be
 * inspected after this returns.
 * @param script - Shell script to execute
 * @param env - Extra environment for the run
 * @returns What the run produced
 */
function runStep(
  script: string,
  env: Readonly<Record<string, string>>
): StepOutcome {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-release-injection-"));
  try {
    // A no-op logger, so the step's `source ./release-logger.sh` resolves.
    fs.writeFileSync(
      path.join(dir, "release-logger.sh"),
      "log_release_event() { :; }\n"
    );
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    // Records argv one word per line, so the test can assert the payload
    // arrived as a SINGLE argument rather than as words the shell had split.
    fs.writeFileSync(
      path.join(bin, "npx"),
      '#!/bin/bash\nfor a in "$@"; do printf "%s\\n" "$a" >> "$NPX_ARGV_LOG"; done\n',
      { mode: 0o755 }
    );

    const scriptPath = path.join(dir, "step.sh");
    fs.writeFileSync(scriptPath, script);
    const outputPath = path.join(dir, "github_output");
    fs.writeFileSync(outputPath, "");
    const argvLog = path.join(dir, "npx_argv");

    const outcome = boundedSpawnSync({
      command: "bash",
      args: [scriptPath],
      cwd: dir,
      label: "release.yml step body",
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: path.join(dir, "step_summary"),
        NPX_ARGV_LOG: argvLog,
      },
    });

    return {
      status: outcome.status ?? -1,
      outputs: fs.readFileSync(outputPath, "utf-8"),
      executed: fs.existsSync(path.join(dir, "pwned")),
      npxArgv: fs.existsSync(argvLog)
        ? fs.readFileSync(argvLog, "utf-8").split("\n")
        : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("release.yml version handling (#3717)", () => {
  describe("Determine Version rejects anything that is not a plain semver", () => {
    it.each(INJECTION_PAYLOADS)("refuses custom_version %j", payload => {
      const result = runStep(stepBody(VERSION_JOB, DETERMINE_VERSION), {
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
        RELEASE_CUSTOM_VERSION: payload,
        RELEASE_ENVIRONMENT: ENVIRONMENT,
        RELEASE_PRERELEASE: "",
      });

      expect(result.status).not.toBe(0);
      expect(result.outputs).not.toContain("version=");
      expect(result.executed).toBe(false);
    });

    it("accepts a well-formed version and publishes it as an output", () => {
      const result = runStep(stepBody(VERSION_JOB, DETERMINE_VERSION), {
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
        RELEASE_CUSTOM_VERSION: "1.2.3",
        RELEASE_ENVIRONMENT: ENVIRONMENT,
        RELEASE_PRERELEASE: "",
      });

      expect(result.status).toBe(0);
      expect(result.outputs).toContain("version=1.2.3");
      expect(result.outputs).toContain("tag=v1.2.3");
    });

    it("accepts a prerelease version", () => {
      const result = runStep(stepBody(VERSION_JOB, DETERMINE_VERSION), {
        RELEASE_STRATEGY: CUSTOM_STRATEGY,
        RELEASE_CUSTOM_VERSION: "1.2.3-rc.1",
        RELEASE_ENVIRONMENT: ENVIRONMENT,
        RELEASE_PRERELEASE: "",
      });

      expect(result.status).toBe(0);
      expect(result.outputs).toContain("version=1.2.3-rc.1");
    });
  });

  describe("Generate Changelog passes the version as an argument, not as source", () => {
    it.each(INJECTION_PAYLOADS)(
      "does not execute %j if it reaches the step",
      payload => {
        const result = runStep(stepBody(VERSION_JOB, GENERATE_CHANGELOG), {
          RELEASE_STRATEGY: "standard-version",
          RELEASE_VERSION: payload,
          RELEASE_ENVIRONMENT: ENVIRONMENT,
          RELEASE_EMERGENCY: "false",
          RELEASE_APPROVER: "N/A",
          RELEASE_REPOSITORY: "owner/repo",
          RELEASE_REF_NAME: "main",
        });

        expect(result.executed).toBe(false);

        // The payload must arrive as exactly one argv entry, immediately after
        // `--release-as`. Had the shell parsed it, it would be split across
        // several entries or absent entirely.
        const at = result.npxArgv.indexOf("--release-as");
        expect(at).toBeGreaterThan(-1);
        expect(result.npxArgv[at + 1]).toBe(payload);
      }
    );
  });

  describe("rejection control: the pre-fix line did execute the payload", () => {
    it("proves the harness delivers a payload a vulnerable line would run", () => {
      // Simulate what Actions does: substitute the expression into the script
      // text before bash ever sees it. This is the defect, reproduced.
      //
      // The payload ends in `#` so the rest of the line is a comment. The
      // interpolation point here is MID-LINE — `--skip.tag` follows it — so a
      // payload of `1.2.3; touch pwned` yields `touch pwned --skip.tag`, and
      // whether the side effect fires then depends on how the platform's
      // `touch` treats a trailing token that looks like a long option. On BSD
      // (Darwin) it is a second filename and `pwned` is created; on the Linux
      // runner it is not, so this control passed locally and failed in CI —
      // proving different things in different places, which is close to
      // proving nothing.
      //
      // Commenting out the tail makes the control depend only on the
      // injection, which is what it exists to demonstrate. It is also what a
      // real attacker would write, for the same reason. The sibling control in
      // `publish-npm-injection.test.ts` never had this problem because its
      // interpolation point is at end-of-line, so nothing trails the payload.
      const substituted = PRE_FIX_RELEASE_AS.replace(
        "${{ steps.version.outputs.version }}",
        "1.2.3; touch pwned #"
      );

      expect(runStep(substituted, {}).executed).toBe(true);
    });
  });

  describe("no step that reaches a command line interpolates into its script", () => {
    it.each([
      [VERSION_JOB, DETERMINE_VERSION],
      [VERSION_JOB, GENERATE_CHANGELOG],
      [VERSION_JOB, "Push Changelog Changes"],
      [VERSION_JOB, "Refresh release branch tip"],
      ["github_release", "Create GitHub Release"],
    ])("%s / %s has no interpolation in its run body", (jobName, stepName) => {
      expect(stepBody(jobName, stepName)).not.toContain("${{");
    });
  });
});

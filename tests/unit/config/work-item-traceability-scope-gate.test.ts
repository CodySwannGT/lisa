import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The Work-Item Traceability gate runs as inline bash inside the reusable
 * `quality.yml`, deliberately NOT as a checked-in script: host projects carry a
 * create-only `ci.yml` and a copy-overwrite `scripts/lisa-work-item.mjs` that
 * updates only on `lisa apply`, so a gate that depended on a fresh host script
 * would not reach the `@main` fleet at all.
 *
 * That makes the step's `run:` body the actual unit under test. These tests
 * extract it from the workflow and execute it against stub `gh` binaries, which
 * is the only way to exercise the branch that matters: what the gate does when
 * the caller's token cannot read the PR. An assertion that only covered the
 * happy path could not tell a working guard from a deleted one.
 */

const WORKFLOWS = path.join(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows"
);

/** Both reusable workflows ship the same gate and must not drift apart. */
const WORKFLOW_FILES = ["quality.yml", "quality-rails.yml"] as const;

/**
 * Absolute interpreter path — resolving `bash` through PATH would pick up the
 * per-test stub directory these fixtures prepend.
 */
const BASH = "/bin/bash";

/** Shape of the parsed workflow, narrowed to what these tests read. */
interface Workflow {
  readonly jobs: Record<
    string,
    { readonly steps?: readonly { name?: string; run?: string }[] }
  >;
}

/**
 * Extract the traceability validation step's shell body.
 * @param file - Workflow file name under `.github/workflows`
 * @returns The step's `run:` script
 */
function validationScript(file: string): string {
  const parsed = load(
    readFileSync(path.join(WORKFLOWS, file), "utf8")
  ) as Workflow;
  const steps = parsed.jobs["work_item_traceability"]?.steps ?? [];
  const step = steps.find(candidate =>
    (candidate.name ?? "").includes("Validate Work-Item")
  );
  if (!step?.run) throw new Error(`validation step not found in ${file}`);
  return step.run;
}

/** What a fixture run reports back. */
interface StepOutcome {
  readonly status: number | null;
  readonly output: string;
}

/**
 * Collapse a spawn result into status plus combined output.
 * @param result - The spawn result
 * @returns Exit status and merged stdout/stderr
 */
function toResult(result: SpawnSyncReturns<string>): StepOutcome {
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** Per-test scratch state. */
interface Resources {
  dir: string;
}

const resources: Resources = { dir: "" };

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-wit-scope-"));
});

afterEach(async () => {
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Build a fake host project plus stub binaries, then run the extracted step.
 * @param options - Fixture knobs
 * @param options.workflow - Workflow file the step is extracted from
 * @param options.ghExitCode - Exit status the stub `gh` reports for every call
 * @param options.tracker - Value written to `.lisa.config.json`
 * @param options.env - Extra environment for the step
 * @returns The step's exit status and combined output
 */
function runStep(options: {
  workflow: string;
  ghExitCode: number;
  tracker: string;
  env?: Record<string, string>;
}): StepOutcome {
  const project = path.join(resources.dir, "project");
  const bin = path.join(resources.dir, "bin");
  const gh = path.join(bin, "gh");
  const script = path.join(resources.dir, "step.sh");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    GITHUB_REPOSITORY: "acme/widget",
    LISA_PR_NUMBER: "42",
    LISA_PR_BASE_SHA: "aaaa",
    LISA_PR_HEAD_SHA: "bbbb",
    JIRA_API_TOKEN: "",
    JIRA_LOGIN: "",
    LINEAR_API_KEY: "",
    ...options.env,
  };

  mkdirSync(path.join(project, "scripts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(project, ".lisa.config.json"),
    JSON.stringify({ tracker: options.tracker })
  );
  // Stands in for the host's checked-in validator. Reaching it at all means
  // every readiness precondition passed.
  writeFileSync(
    path.join(project, "scripts", "lisa-work-item.mjs"),
    'console.log("STUB_VALIDATOR_RAN");\n'
  );
  writeFileSync(gh, `#!/bin/sh\nexit ${options.ghExitCode}\n`);
  chmodSync(gh, 0o755);
  writeFileSync(script, validationScript(options.workflow));

  // `bash -e` mirrors the GitHub Actions default shell, so a bare failing
  // command aborts the step exactly as it would on a runner.
  return toResult(
    spawnSync(BASH, ["-e", script], { cwd: project, encoding: "utf8", env })
  );
}

describe.each(WORKFLOW_FILES)(
  "%s work_item_traceability token-scope readiness",
  workflow => {
    it("fails, naming the scope and the fix, when the PR cannot be read", () => {
      const result = runStep({ workflow, ghExitCode: 1, tracker: "github" });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("pull-requests: read");
      expect(result.output).toContain(".github/workflows/ci.yml");
      // The gate must not have gone on to claim it verified anything.
      expect(result.output).not.toContain("STUB_VALIDATOR_RAN");
    });

    it("never reports success on a missing scope, whatever the tracker", () => {
      for (const tracker of ["github", "jira", "linear"]) {
        const result = runStep({
          workflow,
          ghExitCode: 1,
          tracker,
          // Credentials present, so the tracker-credential arms cannot mask
          // the scope gap by exiting early.
          env: {
            JIRA_API_TOKEN: "t",
            JIRA_LOGIN: "u",
            LINEAR_API_KEY: "k",
          },
        });

        expect(result.status, `tracker ${tracker}`).not.toBe(0);
        expect(result.output, `tracker ${tracker}`).toContain(
          "does not grant 'pull-requests: read'"
        );
      }
    });

    it("proceeds to the real validator once the scopes are present", () => {
      const result = runStep({ workflow, ghExitCode: 0, tracker: "github" });

      expect(result.output).toContain("STUB_VALIDATOR_RAN");
      expect(result.status).toBe(0);
    });

    it("skips cleanly when the host has no validator at all", () => {
      // A project not yet on the work-item template must stay green: there is
      // nothing to verify, which is different from being unable to verify.
      const project = path.join(resources.dir, "bare");
      mkdirSync(project, { recursive: true });
      const script = path.join(resources.dir, "bare-step.sh");
      writeFileSync(script, validationScript(workflow));

      const result = spawnSync(BASH, ["-e", script], {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, GITHUB_REPOSITORY: "acme/widget" },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("skipping");
    });
  }
);

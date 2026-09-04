/**
 * A release that does not succeed must FAIL the deploy, not skip it (#3467).
 *
 * dev, staging and main released into one shared `vX.Y.Z` tag namespace, so a
 * promote could try to release a tag another branch had already taken. The
 * release job failed — correctly — and then the deploy job was SKIPPED. GitHub
 * renders a skipped job as neutral and counts a skipped required check as
 * satisfied, so the branch looked healthy afterwards: release commit present,
 * versions matching, nothing anywhere prompting anyone to read CI history for
 * skipped Deploy jobs. A downstream repository ran eight days that way.
 *
 * Two things about this test are deliberate.
 *
 * First, it asserts an OUTCOME, not a substring. The defect was a job outcome,
 * and a test that only greps the YAML would pass against a workflow that skips
 * everything. `jobRuns` evaluates the shipped `if:` text under a scenario,
 * including GitHub's implicit `success()`.
 *
 * Second, it carries rejection controls: the exact expressions that shipped
 * before this change are hardcoded below and asserted to SKIP under the same
 * failed-release scenario. Without them, "the deploy runs when the release
 * succeeds" would be satisfied by the broken workflow too.
 *
 * Lisa does not consume the stack templates' deploy workflows, so no run of
 * this repository's own CI can stand in for any of this.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/integration/deploy-outcome-guard
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

import {
  jobRuns,
  type JobResult,
  type RunScenario,
} from "./deploy-outcome-guard-helper.js";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../..");

/** The environment every scenario deploys to. */
const ENVIRONMENT = "staging";

/** The guard step's name, identical in every deploy workflow. */
const GUARD_STEP = "🚨 Confirm the release shipped";

/** The shell the guard runs under, by absolute path — as the runner invokes it. */
const SHELL = "/bin/bash";

/** Shape of the parts of a workflow file this test reads. */
interface WorkflowDoc {
  readonly jobs?: Readonly<
    Record<
      string,
      {
        readonly if?: unknown;
        readonly steps?: readonly {
          readonly name?: string;
          readonly run?: string;
        }[];
      }
    >
  >;
}

/**
 * Read one job out of a workflow file.
 * @param file - Repo-relative workflow path
 * @param jobId - The job key
 * @returns The job's `if:` text and its steps
 */
function readJob(
  file: string,
  jobId: string
): { readonly condition: string; readonly guard: string } {
  const doc = loadYaml(
    fs.readFileSync(path.join(ROOT, file), "utf8")
  ) as WorkflowDoc;
  const job = doc.jobs?.[jobId];
  if (!job) {
    throw new Error(`${file} has no job '${jobId}'`);
  }
  const guard = (job.steps ?? []).find(step => step.name === GUARD_STEP);
  return {
    condition: typeof job.if === "string" ? job.if : String(job.if ?? ""),
    guard: guard?.run ?? "",
  };
}

/**
 * The expo template's deploy scenario.
 * @param release - What the release job reported
 * @param overrides - Cancellation and EAS-setup variations
 * @param overrides.cancelled - Whether an operator cancelled the run
 * @param overrides.eas - The value of `check_eas_setup`'s `has_eas_setup`
 * @returns The scenario
 */
function expoScenario(
  release: JobResult,
  overrides: { cancelled?: boolean; eas?: string } = {}
): RunScenario {
  return {
    needs: {
      determine_environment: {
        result: "success",
        outputs: { environment: ENVIRONMENT },
      },
      check_eas_setup: {
        result: "success",
        outputs: { has_eas_setup: overrides.eas ?? "true" },
      },
      release: { result: release },
      check_app_config_changes: {
        result: "success",
        outputs: { app_config_changed: "false" },
      },
    },
    github: {},
    cancelled: overrides.cancelled ?? false,
  };
}

/**
 * The rails template's deploy scenario.
 * @param release - What the release job reported
 * @param overrides - Cancellation and head-commit-message variations
 * @param overrides.cancelled - Whether an operator cancelled the run
 * @param overrides.message - The pushed head commit's message
 * @returns The scenario
 */
function railsScenario(
  release: JobResult,
  overrides: { cancelled?: boolean; message?: string } = {}
): RunScenario {
  return {
    needs: { release: { result: release } },
    github: {
      "github.event_name": "push",
      "github.ref_name": ENVIRONMENT,
      "github.event.head_commit.message":
        overrides.message ?? "feat: a change worth shipping",
    },
    cancelled: overrides.cancelled ?? false,
  };
}

/**
 * This repository's own deploy scenario.
 * @param release - What the release job reported
 * @param overrides - Cancellation variations
 * @param overrides.cancelled - Whether an operator cancelled the run
 * @returns The scenario
 */
function lisaScenario(
  release: JobResult,
  overrides: { cancelled?: boolean } = {}
): RunScenario {
  return {
    needs: {
      determine_environment: {
        result: "success",
        outputs: { environment: ENVIRONMENT },
      },
      release: { result: release },
    },
    github: {},
    cancelled: overrides.cancelled ?? false,
  };
}

/** Every Lisa deploy workflow whose deploy-side job hangs off a release job. */
const GUARDED = [
  {
    label: "expo",
    file: "expo/create-only/.github/workflows/deploy.yml",
    job: "deploy",
    scenario: expoScenario,
  },
  {
    label: "rails",
    file: "rails/create-only/.github/workflows/deploy.yml",
    job: "deploy_rails",
    scenario: railsScenario,
  },
  {
    label: "lisa",
    file: ".github/workflows/deploy.yml",
    job: "deploy_outcome",
    scenario: lisaScenario,
  },
] as const;

/**
 * The expo `if:` exactly as it shipped before this change, kept as a rejection
 * control. `always()` suppressed the implicit `success()`, and then the third
 * clause skipped the job anyway the moment the release stopped succeeding.
 */
const HISTORICAL_EXPO = `always() &&
needs.check_eas_setup.outputs.has_eas_setup == 'true' &&
needs.release.result == 'success'`;

/**
 * The rails `if:` exactly as it shipped before this change. It never mentioned
 * the release at all — GitHub's implicit `success()` did the skipping.
 */
const HISTORICAL_RAILS =
  "${{ github.event_name != 'push' || " +
  "!startsWith(github.event.head_commit.message, 'chore(release):') }}";

/**
 * Run one guard script the way the runner would.
 * @param script - The step's `run` body
 * @param release - The value of `needs.release.result`
 * @returns Exit status, stdout, and what reached the step summary
 */
function runGuard(
  script: string,
  release: JobResult
): {
  readonly status: number;
  readonly stdout: string;
  readonly summary: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-deploy-outcome-"));
  const summaryFile = path.join(dir, "summary.md");
  const outcome = boundedSpawnSync({
    label: "deploy outcome guard",
    command: SHELL,
    args: ["-c", script],
    env: {
      ...process.env,
      RELEASE_RESULT: release,
      DEPLOY_ENVIRONMENT: ENVIRONMENT,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  const summary = fs.existsSync(summaryFile)
    ? fs.readFileSync(summaryFile, "utf8")
    : "";
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: outcome.status ?? -1, stdout: outcome.stdout, summary };
}

describe("a release that did not succeed fails the deploy", () => {
  it.each(GUARDED)("$label runs when the release FAILED", entry => {
    const { condition } = readJob(entry.file, entry.job);
    expect(jobRuns(condition, entry.scenario("failure"))).toBe(true);
  });

  it.each(GUARDED)("$label runs when the release was SKIPPED", entry => {
    // A pre-deploy gate failing skips the release. That is the same silent
    // gap one level up, so it must reach the guard too.
    const { condition } = readJob(entry.file, entry.job);
    expect(jobRuns(condition, entry.scenario("skipped"))).toBe(true);
  });

  it.each(GUARDED)("$label still runs on a successful release", entry => {
    const { condition } = readJob(entry.file, entry.job);
    expect(jobRuns(condition, entry.scenario("success"))).toBe(true);
  });

  it.each(GUARDED)("$label reports no verdict on a cancelled run", entry => {
    const { condition } = readJob(entry.file, entry.job);
    expect(
      jobRuns(condition, entry.scenario("failure", { cancelled: true }))
    ).toBe(false);
  });
});

describe("rejection control: the expressions this replaces DID skip", () => {
  it("expo's previous condition skipped the deploy on a failed release", () => {
    expect(jobRuns(HISTORICAL_EXPO, expoScenario("failure"))).toBe(false);
  });

  it("expo's previous condition ran on a successful release", () => {
    // Without this the control could pass for the wrong reason — an expression
    // that never runs at all would also "skip on failure".
    expect(jobRuns(HISTORICAL_EXPO, expoScenario("success"))).toBe(true);
  });

  it("rails' previous condition skipped the deploy on a failed release", () => {
    expect(jobRuns(HISTORICAL_RAILS, railsScenario("failure"))).toBe(false);
  });

  it("rails' previous condition ran on a successful release", () => {
    expect(jobRuns(HISTORICAL_RAILS, railsScenario("success"))).toBe(true);
  });
});

describe("skips that are genuinely 'not applicable' are preserved", () => {
  it("expo skips the deploy when EAS is not set up at all", () => {
    expect(
      jobRuns(
        readJob(GUARDED[0].file, "deploy").condition,
        expoScenario("success", { eas: "false" })
      )
    ).toBe(false);
  });

  it("rails skips the deploy for the release commit coming back round", () => {
    const { condition } = readJob(GUARDED[1].file, "deploy_rails");
    const scenario = railsScenario("success", {
      message: "chore(release): 1.2.3 [skip ci]",
    });
    expect(jobRuns(condition, scenario)).toBe(false);
  });
});

describe("the guard step itself", () => {
  it("is byte-identical in every deploy workflow", () => {
    const bodies = GUARDED.map(entry => readJob(entry.file, entry.job).guard);
    expect(bodies.filter(body => body !== "")).toHaveLength(GUARDED.length);
    expect(new Set(bodies).size).toBe(1);
  });

  it.each(["failure", "skipped", "cancelled"] as const)(
    "exits non-zero when the release reported %s",
    release => {
      const { guard } = readJob(GUARDED[0].file, GUARDED[0].job);
      expect(runGuard(guard, release).status).toBe(1);
    }
  );

  it("exits zero when the release succeeded", () => {
    const { guard } = readJob(GUARDED[0].file, GUARDED[0].job);
    expect(runGuard(guard, "success").status).toBe(0);
  });

  it("annotates the run with what did not happen, in plain words", () => {
    const { guard } = readJob(GUARDED[0].file, GUARDED[0].job);
    const outcome = runGuard(guard, "failure");
    expect(outcome.stdout).toContain(
      "::error title=Nothing new was deployed to staging::"
    );
    expect(outcome.stdout).toContain("the previous version is still running");
  });

  it("tells a non-technical operator which environment and what to do", () => {
    const { guard } = readJob(GUARDED[0].file, GUARDED[0].job);
    const { summary } = runGuard(guard, "failure");
    expect(summary).toContain("Nothing new was deployed to staging");
    expect(summary).toContain("it reported `failure`");
    expect(summary).toContain("**What to do next**");
    expect(summary).toContain("read the step marked in red");
    expect(summary).toContain("raise `version` in `package.json`");
    expect(summary).toContain("send this run's link to whoever looks after");
  });
});

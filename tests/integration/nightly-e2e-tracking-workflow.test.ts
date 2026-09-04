/**
 * RED wiring contract for the combined nightly-E2E tracker.
 */
import yaml from "js-yaml";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const REUSABLE_REL = ".github/workflows/nightly-e2e-tracking.yml";
const CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-tracking.yml";
const POLICY_TEMPLATE_REL = "expo/create-only/.github/nightly-e2e-policy.json";
const TRACKER_REL =
  "typescript/copy-overwrite/scripts/reconcile-nightly-e2e-tracking.mjs";
const HEALTH_CALLER_REL =
  "expo/create-only/.github/workflows/nightly-e2e-health.yml";

/** Exact provider jobs in the combined reusable workflow. */
const PROVIDER_JOBS = Object.freeze({
  github: {
    uses: "./.github/workflows/create-github-issue-on-failure.yml",
    inputs: [] as readonly string[],
    secrets: ["PAT"],
  },
  sentry: {
    uses: "./.github/workflows/create-sentry-issue-on-failure.yml",
    inputs: ["SENTRY_ORG", "SENTRY_PROJECT"],
    secrets: ["SENTRY_AUTH_TOKEN"],
  },
  jira: {
    uses: "./.github/workflows/create-jira-issue-on-failure.yml",
    inputs: ["JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_PROJECT_KEY"],
    secrets: ["JIRA_API_TOKEN"],
  },
  linear: {
    uses: "./.github/workflows/create-linear-issue-on-failure.yml",
    inputs: ["team_key"],
    secrets: ["LINEAR_API_KEY"],
  },
});

/** Partial workflow shape used by the wiring assertions. */
interface Workflow {
  readonly on?: Record<string, unknown>;
  readonly true?: Record<string, unknown>;
  readonly permissions?: Record<string, string>;
  readonly concurrency?: {
    readonly group?: string;
    readonly "cancel-in-progress"?: boolean;
  };
  readonly jobs: Record<
    string,
    {
      readonly if?: string;
      readonly uses?: string;
      readonly with?: Record<string, unknown>;
      readonly secrets?: Record<string, unknown>;
      readonly outputs?: Record<string, string>;
      readonly steps?: readonly {
        readonly uses?: string;
        readonly run?: string;
        readonly with?: Record<string, unknown>;
      }[];
    }
  >;
}

/**
 * Reads a repository-relative UTF-8 file.
 *
 * @param relative - Repository-relative path
 * @returns File contents
 */
function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * Parses one workflow under the YAML 1.1-compatible test loader.
 *
 * @param relative - Repository-relative workflow path
 * @returns Parsed workflow
 */
function workflow(relative: string): Workflow {
  return yaml.load(read(relative)) as Workflow;
}

/**
 * Returns the workflow trigger map despite YAML 1.1 `on` coercion.
 *
 * @param value - Parsed workflow
 * @returns Trigger map
 */
function triggers(value: Workflow): Record<string, unknown> {
  return value.on ?? value.true ?? {};
}

describe("combined tracking workflow authority", () => {
  it("ships a reusable and an installable caller", () => {
    expect(read(REUSABLE_REL)).toContain("workflow_call");
    expect(read(CALLER_REL)).toContain("workflow_run");
    expect(read(TRACKER_REL)).toContain("lisa_nightly_e2e_condition");
    expect(JSON.parse(read(POLICY_TEMPLATE_REL))).toBeDefined();
  });

  it("fires only after either shipped nightly suite completes", () => {
    const on = triggers(workflow(CALLER_REL));
    const workflowRun = on.workflow_run as {
      workflows?: readonly string[];
      types?: readonly string[];
    };

    expect(workflowRun.workflows).toEqual([
      "🎭 Playwright Web E2E",
      "📱 Maestro Native E2E",
    ]);
    expect(workflowRun.types).toEqual(["completed"]);
    expect(on).not.toHaveProperty("pull_request");
    expect(on).not.toHaveProperty("schedule");
  });

  it("rejects non-default-branch and foreign-repository workflow runs", () => {
    const caller = workflow(CALLER_REL);
    const job = Object.values(caller.jobs).find(value => value.uses);
    expect(job?.if).toContain(
      "github.event.workflow_run.head_branch == " +
        "github.event.repository.default_branch"
    );
    expect(job?.if).toContain(
      "github.event.workflow_run.head_repository.full_name == " +
        "github.repository"
    );
  });

  it("queues writes and checks out the repository default branch", () => {
    const caller = workflow(CALLER_REL);
    expect(caller.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(caller.concurrency?.group).toContain("github.repository");

    const reusable = workflow(REUSABLE_REL);
    const checkout = Object.values(reusable.jobs)
      .flatMap(job => job.steps ?? [])
      .find(step => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toContain("repository.default_branch");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("reads config and one shared policy instead of caller constants", () => {
    const reusable = read(REUSABLE_REL);
    const caller = read(CALLER_REL);
    const health = read(HEALTH_CALLER_REL);
    const policy = JSON.parse(read(POLICY_TEMPLATE_REL)) as {
      readonly freshness_hours: number;
      readonly bypass_max_hours: number;
      readonly suites: readonly { readonly label: string }[];
    };
    expect(reusable).toContain(".lisa.config.json");
    expect(reusable).toContain(".github/nightly-e2e-policy.json");
    expect(caller).not.toMatch(/freshness_hours|bypass_max_hours/);
    expect(caller).not.toContain('"workflow":');
    expect(health).toContain(".github/nightly-e2e-policy.json");
    expect(policy.suites.map(suite => suite.label)).toEqual([
      "🎭 Playwright Web E2E",
      "📱 Maestro Native E2E",
    ]);
    for (const key of ["freshness_hours", "bypass_max_hours"] as const) {
      expect(reusable).toContain(`policy.${key}`);
      expect(health).toContain(`.${key}`);
      expect(policy[key]).toBeGreaterThan(0);
    }
  });

  it("binds each selected provider to its exact reusable protocol", () => {
    const reusable = workflow(REUSABLE_REL);
    const commonInputs = [
      "tracking_action",
      "tracking_marker",
      "tracking_title",
      "tracking_body",
      "tracking_id",
      "tracking_findings",
    ];

    for (const [destination, contract] of Object.entries(PROVIDER_JOBS)) {
      const job = reusable.jobs[destination];
      expect(job?.uses).toBe(contract.uses);
      expect(job?.if).toContain(
        `needs.plan.outputs.destination == '${destination}'`
      );
      for (const input of commonInputs) {
        expect(job?.with?.[input]).toContain(`needs.plan.outputs.${input}`);
      }
      expect(
        Object.keys(job?.with ?? {}).sort((left, right) =>
          left.localeCompare(right)
        )
      ).toEqual(
        ["workflow_name", ...commonInputs, ...contract.inputs].sort(
          (left, right) => left.localeCompare(right)
        )
      );
      expect(
        Object.keys(job?.secrets ?? {}).sort((left, right) =>
          left.localeCompare(right)
        )
      ).toEqual(contract.secrets);
      for (const secret of contract.secrets) {
        expect(job?.secrets?.[secret]).toContain(`secrets.${secret}`);
      }
    }
  });

  it("executes dispatch builder before reusable job selection", () => {
    const reusable = workflow(REUSABLE_REL);
    const plan = reusable.jobs.plan;
    const run = (plan?.steps ?? []).map(step => step.run ?? "").join("\n");
    expect(run).toContain(TRACKER_REL.split("/").at(-1));
    expect(run).toContain("--plan");
    for (const output of [
      "destination",
      "tracking_action",
      "tracking_marker",
      "tracking_title",
      "tracking_body",
      "tracking_id",
    ]) {
      expect(plan?.outputs).toHaveProperty(output);
    }
  });

  it("keeps write authority outside both suite workflows", () => {
    for (const relative of [
      "expo/create-only/.github/workflows/playwright-e2e.yml",
      "expo/create-only/.github/workflows/maestro-e2e.yml",
    ]) {
      const suite = workflow(relative);
      expect(suite.permissions).not.toHaveProperty("issues", "write");
    }
    expect(read(CALLER_REL)).toContain("secrets: inherit");
  });

  it("tracks the reusable at `@main`", () => {
    // This accepted a tag or a raw SHA, and the caller carried a SHA. That is
    // the worse of the two: a history rewrite makes the commit unreachable,
    // the workflow cannot load, zero jobs are created, and the check reads as
    // ABSENT rather than red.
    const caller = workflow(CALLER_REL);
    const job = Object.values(caller.jobs).find(value => value.uses);
    const uses = job?.uses ?? "";
    expect(uses).toContain(
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-tracking.yml@"
    );
    expect(uses.split("@")[1]).toBe("main");
  });
});

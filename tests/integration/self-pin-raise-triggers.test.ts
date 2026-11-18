/**
 * When the self-pin raise runs (CodySwannGT/lisa#4951).
 *
 * deploy.yml calls self-pin-raise.yml once a release is on npm — after a
 * successful publish, or after `reconcile_release` proves a failed-looking
 * publish landed — and never from a run off main. The raise workflow also
 * runs hourly with no version, which is what re-proves a raise the push job
 * refused because main moved, whether or not the commit that moved main
 * started a deploy run of its own.
 * @module tests/integration/self-pin-raise-triggers
 */
import { describe, expect, it } from "vitest";

import {
  CALLER_JOB,
  type DeployJob,
  deployJob,
  guardPasses,
  PREPARE_JOB,
  RAISE_WORKFLOW,
  raiseJob,
  workflow,
} from "./support/self-pin-raise-jobs.js";

/** Lisa's own repository, the only one that may raise its self-pin. */
const LISA = "CodySwannGT/lisa";

/** main's full ref. */
const MAIN = "refs/heads/main";

/** A ref other than main, from which a dispatch could ask for `main`. */
const OFF_MAIN = "refs/heads/staging";

describe("deploy.yml calls the raise only when a release is on npm (#4951)", () => {
  /**
   * Whether deploy.yml calls the raise for one combination of outcomes.
   * @param overrides - The outcomes that differ from a clean main release.
   * @param overrides.environment - The deploy environment.
   * @param overrides.ref - The ref the run is on.
   * @param overrides.release - The release job's result.
   * @param overrides.version - The version the release cut.
   * @param overrides.publish - The publish job's result.
   * @param overrides.reconciled - reconcile_release's verdict.
   * @returns Whether the guard passes.
   */
  function prepares(
    overrides: {
      environment?: string;
      ref?: string;
      release?: string;
      version?: string;
      publish?: string;
      reconciled?: string;
    } = {}
  ): boolean {
    const outcome = {
      environment: "main",
      ref: "refs/heads/main",
      release: "success",
      version: "7.0.0",
      publish: "success",
      reconciled: "",
      ...overrides,
    };
    return guardPasses(deployJob(CALLER_JOB).if ?? "", {
      github: { ref: outcome.ref },
      needs: {
        determine_environment: {
          outputs: { environment: outcome.environment },
        },
        release: {
          result: outcome.release,
          outputs: { version: outcome.version },
        },
        publish_npm: { result: outcome.publish },
        reconcile_release: { outputs: { verdict: outcome.reconciled } },
      },
    });
  }

  it("waits on every job whose outcome it reads", () => {
    expect(deployJob(CALLER_JOB).needs).toEqual(
      expect.arrayContaining([
        "determine_environment",
        "release",
        "publish_npm",
        "reconcile_release",
      ])
    );
  });

  it("prepares after a successful publish on main", () => {
    expect(prepares()).toBe(true);
  });

  it("does not prepare off main, even after a successful publish", () => {
    expect(prepares({ environment: "staging" })).toBe(false);
    expect(prepares({ environment: "dev" })).toBe(false);
  });

  it("does not prepare from a run off main that asked for the main environment", () => {
    expect(prepares({ ref: OFF_MAIN })).toBe(false);
    expect(prepares({ ref: "refs/heads/dev" })).toBe(false);
    expect(
      prepares({
        ref: OFF_MAIN,
        publish: "failure",
        reconciled: "published",
      })
    ).toBe(false);
  });

  it("does not prepare when the publish failed and nothing proved it landed", () => {
    expect(prepares({ publish: "failure" })).toBe(false);
    expect(prepares({ publish: "cancelled" })).toBe(false);
    expect(prepares({ publish: "skipped" })).toBe(false);
    expect(prepares({ publish: "failure", reconciled: "missing" })).toBe(false);
    expect(prepares({ publish: "failure", reconciled: "unprovable" })).toBe(
      false
    );
  });

  it("prepares when reconcile_release proved a failed-looking publish landed", () => {
    expect(prepares({ publish: "failure", reconciled: "published" })).toBe(
      true
    );
    expect(prepares({ publish: "cancelled", reconciled: "published" })).toBe(
      true
    );
  });

  it("does not prepare off main or without a release, even when reconciled", () => {
    expect(
      prepares({
        environment: "staging",
        publish: "failure",
        reconciled: "published",
      })
    ).toBe(false);
    expect(prepares({ release: "failure" })).toBe(false);
    expect(prepares({ version: "" })).toBe(false);
  });

  it("holds the release prerequisites on the reconciled path too", () => {
    const reconciled = { publish: "failure", reconciled: "published" };

    expect(prepares({ ...reconciled })).toBe(true);
    expect(prepares({ ...reconciled, release: "failure" })).toBe(false);
    expect(prepares({ ...reconciled, release: "cancelled" })).toBe(false);
    expect(prepares({ ...reconciled, version: "" })).toBe(false);
    expect(prepares({ ...reconciled, environment: "dev" })).toBe(false);
    expect(prepares({ ...reconciled, ref: "refs/heads/dev" })).toBe(false);
  });

  it("lets reconcile_release hand its verdict on", () => {
    const reconcile = deployJob("reconcile_release") as DeployJob & {
      readonly outputs?: Record<string, string>;
    };

    expect(reconcile.outputs?.verdict).toBe(
      "${{ steps.landed.outputs.verdict }}"
    );
  });
});

describe("the raise workflow runs after a release and every hour (#4951)", () => {
  it("is called with the published version and only the deploy key", () => {
    const caller = deployJob(CALLER_JOB);

    expect(caller.uses).toBe(`./${RAISE_WORKFLOW}`);
    expect(caller.with?.version).toBe("${{ needs.release.outputs.version }}");
    expect(caller.secrets).toEqual({ DEPLOY_KEY: "${{ secrets.DEPLOY_KEY }}" });
  });

  it("accepts a version and the deploy key when called", () => {
    const call = workflow(RAISE_WORKFLOW).on?.workflow_call as {
      inputs?: Record<string, { required?: boolean; default?: string }>;
      secrets?: Record<string, { required?: boolean }>;
    };

    expect(call.inputs?.version?.required).toBe(false);
    expect(call.inputs?.version?.default).toBe("");
    expect(call.secrets?.DEPLOY_KEY?.required).toBe(true);
  });

  it("re-runs on a schedule, so a refused raise needs no later push to retry", () => {
    const triggers = workflow(RAISE_WORKFLOW).on ?? {};
    const schedule = triggers.schedule as readonly { cron: string }[];

    expect(schedule).toHaveLength(1);
    // Minute field fixed, every other field `*`: once an hour, every hour.
    expect(schedule[0]?.cron).toMatch(/^\d{1,2} \* \* \* \*$/);
    expect(triggers).toHaveProperty("workflow_dispatch");
  });

  it("prepares only on Lisa's own main, whatever triggered it", () => {
    const guard = raiseJob(PREPARE_JOB).if ?? "";
    const on = (repository: string, ref: string): boolean =>
      guardPasses(guard, { github: { repository, ref } });

    expect(on(LISA, MAIN)).toBe(true);
    expect(on(LISA, OFF_MAIN)).toBe(false);
    expect(on(LISA, "refs/tags/v7.0.0")).toBe(false);
    // A host repository calling the reusable workflow from its own main.
    expect(on("an-org/a-host", MAIN)).toBe(false);
  });

  it("lets only one push run at a time", () => {
    const { concurrency } = raiseJob("push_self_pin_raise") as DeployJob;

    expect(concurrency).toEqual({
      group: "self-pin-raise-push",
      "cancel-in-progress": false,
    });
  });
});

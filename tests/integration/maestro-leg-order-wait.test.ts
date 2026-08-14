/**
 * `serialize_platform_legs` — the executable half. The job graph is pinned in
 * `maestro-leg-order.test.ts`; this file runs the `leg_order` job's REAL poll
 * loop, taken verbatim out of the workflow YAML, against a fake Actions jobs
 * API.
 *
 * `needs` cannot hold an expression, so no edge can say "depend on `ios` only
 * when an input is set". The edge is therefore `android → leg_order`, and THIS
 * is the code that decides how long that edge holds. Asserting the edge alone
 * would prove nothing about ordering; a poll loop that returned immediately
 * would satisfy it perfectly.
 *
 * Four things are proved by running it:
 *
 *   • it does NOT return while the iOS job is still running (the ordering);
 *   • it DOES return on an iOS job that failed, was skipped, timed out, or was
 *     cancelled — ordering, never gating, so no flaky iOS flow can delete the
 *     Android suite from the night;
 *   • a poll that matches ZERO iOS jobs is an error, never a pass. That is the
 *     failure mode this job could most easily have had: a guard reporting
 *     success because it looked at nothing;
 *   • a refused API is a named error, not a silent revert to concurrency.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ANDROID_API_JOB,
  iosApiJob,
  runWaitStep,
  startFakeApi,
  startRefusingApi,
} from "./support/maestro-leg-order-harness";
import type { SimulatedWorkflow } from "../helpers/workflow-job-graph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REUSABLE_YML = path.join(
  path.resolve(__dirname, "..", ".."),
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

const LEG_ORDER = "leg_order";

/**
 * The wait step shells out to jq, which every ubuntu-latest runner ships — so
 * this block always runs in CI and only ever skips on a dev machine without it.
 */
const hasJq = spawnSync("/bin/sh", ["-c", "command -v jq"]).status === 0;

describe.skipIf(!hasJq)("maestro-native-e2e leg ordering — the wait", () => {
  let workflow: SimulatedWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as SimulatedWorkflow;
  });

  describe("bite control 1 — ordering holds", () => {
    it("does not return while the iOS job is still running", async () => {
      // The API reports iOS queued, then in_progress twice, before completing.
      // Returning on any of the first three would release Android while iOS
      // still holds the persona — which is the bug, restated.
      const api = await startFakeApi([
        [ANDROID_API_JOB, iosApiJob("queued", null)],
        [ANDROID_API_JOB, iosApiJob("in_progress", null)],
        [ANDROID_API_JOB, iosApiJob("in_progress", null)],
        [ANDROID_API_JOB, iosApiJob("completed", "success")],
      ]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        // Three "still running" lines then a release: it kept asking until the
        // answer changed, in its own words rather than a counter this test
        // invented. A loop that returned on the first poll would print none.
        const waited = result.stdout
          .split("\n")
          .filter(line => line.includes("still running"));
        expect(waited).toHaveLength(3);
        expect(result.stdout).toContain("Releasing the Android leg");
      } finally {
        await api.close();
      }
    });

    it("matches the API's caller-prefixed job name", async () => {
      // A reusable workflow's jobs are reported as `<caller job> / <job>`, so
      // an equality match would never fire and this job would wait out its
      // whole budget on a suite that had already finished.
      const api = await startFakeApi([[iosApiJob("completed", "success")]]);
      try {
        expect((await runWaitStep(workflow, LEG_ORDER, api)).status).toBe(0);
      } finally {
        await api.close();
      }
    });

    it("errors rather than passing when no iOS job is ever found", async () => {
      // The absent case is NOT the done case. Zero matches means the job has
      // not been created yet, or the name constant is stale — and neither of
      // those is "iOS finished". The discovery window is collapsed to zero here
      // so the bound is reached on the first poll instead of in five minutes.
      const api = await startFakeApi([[ANDROID_API_JOB]]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api, {
          PRE_SUITE_TIMEOUT_MINUTES: "0",
          DISCOVERY_SLACK_MINUTES: "0",
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(
          "never found the iOS leg"
        );
      } finally {
        await api.close();
      }
    });

    it("fails loudly when the jobs API refuses it", async () => {
      // The `actions: read` case. A 403 must not read as "iOS is done", and
      // must not read as "carry on quietly" either — the caller has to find out
      // its permissions block is short, and the error names the fix.
      const api = await startRefusingApi(403);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("actions: read");
      } finally {
        await api.close();
      }
    });
  });

  describe("bite control 3 — a failing iOS leg does not suppress Android", () => {
    it("releases Android on an iOS leg that FAILED", async () => {
      // Ordering, not gating. Waiting on a CONCLUSION instead of a terminal
      // STATUS would let one flaky iOS flow delete the whole Android suite from
      // the night and report the narrower result under the same green check —
      // trading a contention bug for a coverage bug, which is the worse of the
      // two.
      const api = await startFakeApi([
        [ANDROID_API_JOB, iosApiJob("in_progress", null)],
        [ANDROID_API_JOB, iosApiJob("completed", "failure")],
      ]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Releasing the Android leg");
      } finally {
        await api.close();
      }
    });

    it.each(["skipped", "timed_out", "cancelled", "neutral"])(
      "releases Android on an iOS leg that concluded %s",
      async conclusion => {
        const api = await startFakeApi([
          [ANDROID_API_JOB, iosApiJob("completed", conclusion)],
        ]);
        try {
          expect((await runWaitStep(workflow, LEG_ORDER, api)).status).toBe(0);
        } finally {
          await api.close();
        }
      }
    );
  });
});

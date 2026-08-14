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
 * The contract, in two halves that must not be confused:
 *
 *   ORDERING — while the iOS job exists and is not `completed`, this must not
 *   return. That is the whole feature.
 *
 *   DEGRADATION — when it cannot tell what the iOS job is doing, it exits 0 and
 *   says the ordering was SKIPPED. It never exits non-zero, because row 26 of
 *   the nightly gate turns any non-success job into a `fail` verdict for the
 *   whole suite (docs/nightly-e2e-gate.md), which would block the merge gate on
 *   a night when both legs were green. Releasing costs one night of overlap —
 *   the behaviour every run had before this feature existed.
 *
 * The line between them is what these tests actually guard: exactly one message
 * may claim the iOS leg finished, and it is reachable only after counting at
 * least one matching job with `status == "completed"`. Every degraded path says
 * the opposite, in words.
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
  startFlakyApi,
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

/** The one message that asserts the iOS leg reached a terminal state. */
const FINISHED = "iOS leg finished";
/** Every degraded path says this instead, and never the above. */
const SKIPPED = "the ordering was skipped";

const hasJq = spawnSync("/bin/sh", ["-c", "command -v jq"]).status === 0;

// jq ships on every ubuntu-latest runner, so this block always runs in CI. A
// silent skip would delete every executable proof in this file and still report
// green — the exact shape of vacuous pass this suite exists to prevent — so on
// CI a missing jq is a failure, not a skip.
if (!hasJq && process.env.CI) {
  throw new Error(
    "jq is required for the leg-order wait tests and is missing on this CI runner. Refusing to skip the only executable proof that the ordering holds."
  );
}

describe.skipIf(!hasJq)("maestro-native-e2e leg ordering — the wait", () => {
  let workflow: SimulatedWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as SimulatedWorkflow;
  });

  describe("ordering — it does not return early", () => {
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
        const waited = result.stdout
          .split("\n")
          .filter(line => line.includes("still running"));
        expect(waited).toHaveLength(3);
        expect(result.stdout).toContain(FINISHED);
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
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(FINISHED);
      } finally {
        await api.close();
      }
    });

    it("rides out transient 5xx rather than treating one as a verdict", async () => {
      // ~270 requests across a 90-minute iOS suite. Before this, a single 502
      // released Android AND concluded the job `failure`, which row 26 turns
      // into a blocked merge gate on a night both legs were green.
      const api = await startFlakyApi(3, [
        ANDROID_API_JOB,
        iosApiJob("completed", "success"),
      ]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        // It waited for the real answer rather than releasing on the flake.
        expect(result.stdout).toContain(FINISHED);
        expect(result.stdout).not.toContain(SKIPPED);
      } finally {
        await api.close();
      }
    });

    it("gives up after MAX_TRANSIENT consecutive failures, without failing", async () => {
      const api = await startFlakyApi(50, [iosApiJob("completed", "success")]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api, {
          MAX_TRANSIENT: "3",
        });
        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).toContain(SKIPPED);
        expect(result.stdout).not.toContain(FINISHED);
      } finally {
        await api.close();
      }
    });
  });

  describe("degradation — it warns and releases, and never fails the job", () => {
    it("releases when no LEG_ORDER_TOKEN was passed", async () => {
      // The permission story lives in a forwarded secret, so an unwired caller
      // is the common case rather than an exotic one. It must not fail: that
      // would block the merge gate of every adopter who opted in before wiring
      // the secret.
      const api = await startFakeApi([[iosApiJob("in_progress", null)]]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api, {
          GH_TOKEN: "",
        });
        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).toContain("LEG_ORDER_TOKEN");
        expect(result.stdout).not.toContain(FINISHED);
      } finally {
        await api.close();
      }
    });

    it.each([401, 403, 404])(
      "releases immediately on HTTP %i instead of retrying a token problem",
      async status => {
        // A scope problem does not fix itself, so burning MAX_TRANSIENT polls
        // on it just delays the same outcome. The message must name the fix.
        const api = await startRefusingApi(status);
        try {
          const result = await runWaitStep(workflow, LEG_ORDER, api);
          expect(result.status).toBe(0);
          expect(result.stdout + result.stderr).toContain("actions: read");
          expect(result.stdout).not.toContain(FINISHED);
        } finally {
          await api.close();
        }
      }
    );

    it("releases, without claiming iOS finished, when no iOS job is found", async () => {
      // The absent case is NOT the done case. Zero matches means the job has
      // not been created yet, or the name constant is stale — neither of those
      // is "iOS finished". This used to exit 1; it now exits 0 for the row-26
      // reason, which makes the WORDING the entire guard: it must say the
      // ordering was skipped, never that the leg completed.
      const api = await startFakeApi([[ANDROID_API_JOB]]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api, {
          PRE_SUITE_TIMEOUT_MINUTES: "0",
          DISCOVERY_SLACK_MINUTES: "0",
        });
        expect(result.status).toBe(0);
        expect(result.stdout + result.stderr).toContain(SKIPPED);
        expect(result.stdout + result.stderr).toContain("IOS_JOB_NAME");
        expect(result.stdout).not.toContain(FINISHED);
      } finally {
        await api.close();
      }
    });

    it("treats a 200 carrying non-JSON as transient, not as an empty run", async () => {
      // An HTML error page behind a 200 must not read as "no jobs in this run",
      // which would burn the discovery window and skip the ordering.
      const api = await startFlakyApi(2, [iosApiJob("completed", "success")]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(FINISHED);
      } finally {
        await api.close();
      }
    });
  });

  describe("a failing iOS leg does not suppress Android", () => {
    it("releases Android on an iOS leg that FAILED", async () => {
      // Ordering, not gating. Waiting on a CONCLUSION instead of a terminal
      // STATUS would let one flaky iOS flow delete the whole Android suite from
      // the night and report the narrower result under the same green check.
      const api = await startFakeApi([
        [ANDROID_API_JOB, iosApiJob("in_progress", null)],
        [ANDROID_API_JOB, iosApiJob("completed", "failure")],
      ]);
      try {
        const result = await runWaitStep(workflow, LEG_ORDER, api);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain(FINISHED);
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
          const result = await runWaitStep(workflow, LEG_ORDER, api);
          expect(result.status).toBe(0);
          expect(result.stdout).toContain(FINISHED);
        } finally {
          await api.close();
        }
      }
    );
  });
});

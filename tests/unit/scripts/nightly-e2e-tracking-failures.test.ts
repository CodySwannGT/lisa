/**
 * RED fail-closed provider-action matrix for combined nightly tracking.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TRACKED_SUITE_LABELS,
  existingTracker,
  finding,
  loadTrackingModule,
  type TrackingDestination,
  type TrackingProviderAdapter,
} from "../../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const [PLAYWRIGHT, MAESTRO] = TRACKED_SUITE_LABELS;
const RED = [finding(PLAYWRIGHT, "fail"), finding(MAESTRO, "pass")];
const GREEN = [finding(PLAYWRIGHT, "pass"), finding(MAESTRO, "pass")];

/** Provider operations whose failure must end the current reconciliation. */
type FailingAction = "list" | "create" | "refresh" | "pin" | "unpin" | "close";

/**
 * Builds a valid selected-provider configuration.
 *
 * @param destination - Selected provider
 * @returns Project config fixture
 */
function config(destination: TrackingDestination): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination } },
    github: { org: "acme", repo: "widgets" },
    sentry: { org: "acme", project: "widgets" },
    jira: { project: "WID" },
    atlassian: { site: "acme.atlassian.net", cloudId: "cloud-1" },
    linear: { workspace: "acme", teamKey: "WID" },
  };
}

/**
 * Creates a provider which fails at one operation with hostile details.
 *
 * @param action - Operation which throws
 * @param calls - Ordered operation record
 * @returns Strict failing provider
 */
function failingAdapter(
  action: FailingAction,
  calls: string[]
): TrackingProviderAdapter {
  const fail = (): never => {
    const secret = "TRACKING_PROVIDER_SECRET_SENTINEL";
    throw new Error(`HTTP 503: ${secret}${"x".repeat(9000)}`);
  };
  const trackers =
    action === "create" ? [] : [existingTracker("existing", true)];
  return {
    async list() {
      calls.push("list");
      if (action === "list") fail();
      return trackers;
    },
    async create() {
      calls.push("create");
      if (action === "create") fail();
      return existingTracker("created", false);
    },
    async refresh(id) {
      calls.push("refresh");
      if (action === "refresh") fail();
      return existingTracker(id);
    },
    async close() {
      calls.push("close");
      if (action === "close") fail();
    },
    async pin() {
      calls.push("pin");
      if (action === "pin") fail();
    },
    async unpin() {
      calls.push("unpin");
      if (action === "unpin") fail();
    },
  };
}

/** Cartesian provider/action failure cases. */
const PROVIDER_FAILURES = (
  ["github", "sentry", "jira", "linear"] as const
).flatMap(destination =>
  (["list", "create", "refresh", "pin", "unpin", "close"] as const).map(
    action => ({ destination, action })
  )
);

describe("selected provider failures", () => {
  it.each(PROVIDER_FAILURES)(
    "$destination $action is bounded, classified and terminal",
    async ({ destination, action }) => {
      const module = await loadTrackingModule(REPO_ROOT);
      const calls: string[] = [];
      const findings = action === "close" || action === "unpin" ? GREEN : RED;
      let message = "";

      try {
        await module.reconcileCombinedTracking({
          config: config(destination),
          findings,
          adapters: { [destination]: failingAdapter(action, calls) },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      const expected = {
        list: ["list"],
        create: ["list", "create"],
        refresh: ["list", "refresh"],
        pin: ["list", "refresh", "pin"],
        unpin: ["list", "unpin"],
        close: ["list", "unpin", "close"],
      }[action];
      expect(calls).toEqual(expected);
      expect(message).toContain(destination);
      expect(message).toContain(action);
      expect(message).toContain("HTTP 503");
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).not.toContain("TRACKING_PROVIDER_SECRET_SENTINEL");
    }
  );
});

/**
 * RED state-machine contract for one tracker across both nightly suites.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CONDITION_MARKER,
  TRACKED_SUITE_LABELS,
  existingTracker,
  finding,
  loadTrackingModule,
  type ExistingConditionTracker,
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

/** Recorded fake provider operations. */
interface AdapterFixture {
  readonly adapter: TrackingProviderAdapter;
  readonly calls: readonly string[];
}

/**
 * Creates a strict provider fake around one mutable tracker set.
 *
 * @param seeded - Existing provider trackers
 * @param returnUnfiltered - Return hostile records outside marker authority
 * @returns Adapter and ordered call record
 */
function fakeAdapter(
  seeded: readonly ExistingConditionTracker[] = [],
  returnUnfiltered = false
): AdapterFixture {
  const calls: string[] = [];
  const trackers = [...seeded];
  const adapter: TrackingProviderAdapter = {
    async list(marker) {
      calls.push(`list:${marker}`);
      if (returnUnfiltered) return trackers;
      return trackers.filter(tracker => tracker.marker === marker);
    },
    async create(draft) {
      calls.push(`create:${draft.marker}`);
      const tracker = existingTracker("created", false);
      trackers.push(tracker);
      return tracker;
    },
    async refresh(id) {
      calls.push(`refresh:${id}`);
      return existingTracker(id);
    },
    async close(id) {
      calls.push(`close:${id}`);
    },
    async pin(id) {
      calls.push(`pin:${id}`);
    },
    async unpin(id) {
      calls.push(`unpin:${id}`);
    },
  };
  return { adapter, calls };
}

/**
 * Public config for one destination.
 *
 * @param destination - Provider under test
 * @returns Minimal valid config
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

describe("combined nightly condition planning", () => {
  it("opens one tracker for the first complete red suite", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const plan = module.planCombinedTracking(RED, []);

    expect(plan).toMatchObject({
      action: "create",
      marker: CONDITION_MARKER,
      trackerId: null,
      pin: true,
    });
    expect(plan.body).toContain(RED[0]?.runUrl);
    expect(plan.body).toContain(GREEN[1]?.label);
  });

  it("refreshes the same tracker on a second red", async () => {
    const module = await loadTrackingModule(REPO_ROOT);

    expect(module.planCombinedTracking(RED, [existingTracker()])).toMatchObject(
      {
        action: "refresh",
        trackerId: "tracker-1",
        marker: CONDITION_MARKER,
        pin: true,
      }
    );
  });

  it("keeps the tracker open while either suite is red", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const inverse = [finding(PLAYWRIGHT, "pass"), finding(MAESTRO, "fail")];

    expect(
      module.planCombinedTracking(inverse, [existingTracker()]).action
    ).toBe("refresh");
  });

  it("closes and unpins only when both decisive suites are green", async () => {
    const module = await loadTrackingModule(REPO_ROOT);

    expect(
      module.planCombinedTracking(GREEN, [existingTracker()])
    ).toMatchObject({
      action: "close",
      trackerId: "tracker-1",
      pin: false,
    });
  });

  it.each([
    { state: "unknown" as const, complete: true },
    { state: "pass" as const, complete: false },
    { state: "fail" as const, complete: false },
  ])("leaves state untouched for incomplete evidence %#", async partial => {
    const module = await loadTrackingModule(REPO_ROOT);
    const findings = [
      { ...finding(PLAYWRIGHT, "pass"), ...partial },
      GREEN[1]!,
    ];

    expect(
      module.planCombinedTracking(findings, [existingTracker()]).action
    ).toBe("none");
  });

  it("accepts the exact two suite identities in either order", async () => {
    const module = await loadTrackingModule(REPO_ROOT);

    expect(module.planCombinedTracking([...RED].reverse(), [])).toMatchObject({
      action: "create",
      marker: CONDITION_MARKER,
    });
  });

  it.each([
    [finding(PLAYWRIGHT, "fail")],
    [...RED, finding("Unexpected nightly", "pass")],
    [finding(PLAYWRIGHT, "fail"), finding(PLAYWRIGHT, "pass")],
    [finding("Playwright", "fail"), finding(MAESTRO, "pass")],
  ])("rejects an incomplete or ambiguous suite identity set %#", async rows => {
    const module = await loadTrackingModule(REPO_ROOT);

    expect(() => module.planCombinedTracking(rows, [])).toThrow(
      /exactly.*Playwright Web E2E.*Maestro Native E2E/i
    );
  });
});

describe("provider-neutral reconciliation", () => {
  it.each(["github", "sentry", "jira", "linear"] as const)(
    "%s uses the same create-refresh-close state machine",
    async destination => {
      const module = await loadTrackingModule(REPO_ROOT);
      const fixture = fakeAdapter();
      const adapters = { [destination]: fixture.adapter };

      const created = await module.reconcileCombinedTracking({
        config: config(destination),
        findings: RED,
        adapters,
      });
      expect(created).toMatchObject({ destination, action: "create" });
      expect(fixture.calls).toEqual([
        `list:${CONDITION_MARKER}`,
        `create:${CONDITION_MARKER}`,
        "pin:created",
      ]);

      await module.reconcileCombinedTracking({
        config: config(destination),
        findings: RED,
        adapters,
      });
      await module.reconcileCombinedTracking({
        config: config(destination),
        findings: GREEN,
        adapters,
      });
      expect(fixture.calls.slice(3)).toEqual([
        `list:${CONDITION_MARKER}`,
        "refresh:created",
        "pin:created",
        `list:${CONDITION_MARKER}`,
        "unpin:created",
        "close:created",
      ]);
    }
  );

  it("none is green and never resolves or invokes an adapter", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const adapter = fakeAdapter().adapter;
    const list = vi.spyOn(adapter, "list");

    await expect(
      module.reconcileCombinedTracking({
        config: config("none"),
        findings: RED,
        adapters: { github: adapter },
      })
    ).resolves.toEqual({
      destination: "none",
      action: "skipped",
      trackerId: null,
      reason: "tracking_disabled",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("fails closed when the requested adapter is absent", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const github = fakeAdapter().adapter;
    const githubList = vi.spyOn(github, "list");

    await expect(
      module.reconcileCombinedTracking({
        config: config("linear"),
        findings: RED,
        adapters: { github },
      })
    ).rejects.toThrow(/linear.*unavailable/i);
    expect(githubList).not.toHaveBeenCalled();
  });

  it.each([
    ["red", RED],
    ["green", GREEN],
  ] as const)(
    "refuses duplicate matching trackers before a %s write",
    async (_state, findings) => {
      const module = await loadTrackingModule(REPO_ROOT);
      const fixture = fakeAdapter([
        existingTracker("duplicate-a"),
        existingTracker("duplicate-b"),
      ]);

      await expect(
        module.reconcileCombinedTracking({
          config: config("github"),
          findings,
          adapters: { github: fixture.adapter },
        })
      ).rejects.toThrow(/multiple|duplicate|exactly one/i);
      expect(fixture.calls).toEqual([`list:${CONDITION_MARKER}`]);
    }
  );

  it("refuses an adapter's wrong-marker record before any write", async () => {
    const module = await loadTrackingModule(REPO_ROOT);
    const fixture = fakeAdapter(
      [{ id: "foreign", marker: "foreign-condition", pinned: true }],
      true
    );

    await expect(
      module.reconcileCombinedTracking({
        config: config("github"),
        findings: RED,
        adapters: { github: fixture.adapter },
      })
    ).rejects.toThrow(/marker|authority|unexpected/i);
    expect(fixture.calls).toEqual([`list:${CONDITION_MARKER}`]);
  });
});

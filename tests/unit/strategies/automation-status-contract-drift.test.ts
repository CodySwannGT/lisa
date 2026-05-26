/**
 * Regression coverage for automation-status contract drift detection.
 *
 * Issue #800 adds the shared comparator that future runtime adapters use to
 * match expected Lisa automations to observed scheduler entries and classify
 * name, cadence, command, and queue-argument drift without mutating jobs.
 * @module tests/unit/strategies/automation-status-contract-drift
 */
import { describe, expect, it } from "vitest";

import {
  compareAutomationContract,
  compareAutomationFleet,
  findObservedAutomationMatch,
} from "../../../plugins/src/base/scripts/automation-status-contract-drift.mjs";

describe("automation-status contract drift (#800)", () => {
  const EXPECTED_AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
  const EXPECTED_CADENCE = "every 10 minutes";
  const EXPECTED_RRULE = "FREQ=MINUTELY;INTERVAL=10";
  const EXPECTED_COMMAND = "/lisa:intake github intake_mode=build";
  const HOURLY_CADENCE = "every 60 minutes";
  const HOURLY_RRULE = "FREQ=HOURLY;INTERVAL=1";

  const expected = {
    automationId: EXPECTED_AUTOMATION_ID,
    expectedCadence: EXPECTED_CADENCE,
    expectedRRule: EXPECTED_RRULE,
    expectedCommand: EXPECTED_COMMAND,
  };

  it("reports HEALTHY when the live automation matches the expected contract", () => {
    expect(
      compareAutomationContract({
        expected,
        observedAutomation: {
          automationId: EXPECTED_AUTOMATION_ID,
          observedCadence: EXPECTED_CADENCE,
          observedRRule: EXPECTED_RRULE,
          observedCommand: EXPECTED_COMMAND,
        },
      })
    ).toEqual(
      expect.objectContaining({
        status: "HEALTHY",
        summary: "expected automation exists and matches the contract",
        driftKinds: [],
      })
    );
  });

  it("detects cadence and queue-argument drift on an exact-name match", () => {
    const comparison = compareAutomationContract({
      expected,
      observedAutomation: {
        automationId: expected.automationId,
        observedCadence: "every 30 minutes",
        observedRRule: "FREQ=MINUTELY;INTERVAL=30",
        observedCommand: "/lisa:intake github intake_mode=prd",
      },
    });

    expect(comparison.status).toBe("DRIFTED");
    expect(comparison.driftKinds).toEqual(["cadence", "queue_arguments"]);
    expect(comparison.summary).toBe(
      "cadence and queue arguments no longer match setup"
    );
    expect(comparison.observed).toContain("every 30 minutes");
    expect(comparison.observed).toContain("intake_mode=prd");
  });

  it("matches a renamed automation by contract shape and reports name drift", () => {
    const observedAutomations = [
      {
        automationId: "lisa-auto-codyswanngt-lisa-intake-build",
        observedCadence: EXPECTED_CADENCE,
        observedRRule: EXPECTED_RRULE,
        observedCommand: EXPECTED_COMMAND,
      },
    ];

    expect(findObservedAutomationMatch(expected, observedAutomations)).toEqual(
      observedAutomations[0]
    );

    const comparison = compareAutomationContract({
      expected,
      observedAutomations,
    });

    expect(comparison.status).toBe("DRIFTED");
    expect(comparison.driftKinds).toEqual(["name"]);
    expect(comparison.summary).toBe("name no longer matches setup");
  });

  it("treats reordered key=value queue args as equivalent", () => {
    const comparison = compareAutomationContract({
      expected: {
        automationId: "lisa-auto-acme-repair",
        expectedCadence: HOURLY_CADENCE,
        expectedRRule: HOURLY_RRULE,
        expectedCommand:
          "/lisa:repair-intake github intake_mode=both assignee=codyswanngt",
      },
      observedAutomation: {
        automationId: "lisa-auto-acme-repair",
        observedCadence: HOURLY_CADENCE,
        observedRRule: HOURLY_RRULE,
        observedCommand:
          "/lisa:repair-intake github assignee=codyswanngt intake_mode=both",
      },
    });

    expect(comparison.status).toBe("HEALTHY");
    expect(comparison.driftKinds).toEqual([]);
  });

  it("detects command drift separately from queue-argument drift", () => {
    const comparison = compareAutomationContract({
      expected,
      observedAutomation: {
        automationId: expected.automationId,
        observedCadence: EXPECTED_CADENCE,
        observedRRule: EXPECTED_RRULE,
        observedCommand: "/lisa:repair-intake github intake_mode=build",
      },
    });

    expect(comparison.status).toBe("DRIFTED");
    expect(comparison.driftKinds).toEqual(["command"]);
    expect(comparison.summary).toBe("command no longer matches setup");
  });

  it("reports MISSING when no observed automation matches", () => {
    expect(
      compareAutomationContract({
        expected,
        observedAutomations: [],
      })
    ).toEqual(
      expect.objectContaining({
        status: "MISSING",
        summary: "expected automation is missing",
        observedAutomation: null,
      })
    );
  });

  it("does not let one observed intake job satisfy multiple expected contracts", () => {
    const prdExpected = {
      automationId: "lisa-auto-codyswanngt-lisa-intake-prd",
      expectedCadence: HOURLY_CADENCE,
      expectedRRule: HOURLY_RRULE,
      expectedCommand: "/lisa:intake github intake_mode=prd",
    };
    const buildExpected = {
      automationId: EXPECTED_AUTOMATION_ID,
      expectedCadence: EXPECTED_CADENCE,
      expectedRRule: EXPECTED_RRULE,
      expectedCommand: EXPECTED_COMMAND,
    };

    const comparisons = compareAutomationFleet({
      expectedAutomations: [prdExpected, buildExpected],
      observedAutomations: [
        {
          automationId: EXPECTED_AUTOMATION_ID,
          observedCadence: EXPECTED_CADENCE,
          observedRRule: EXPECTED_RRULE,
          observedCommand: EXPECTED_COMMAND,
        },
      ],
    });

    expect(comparisons).toHaveLength(2);
    expect(comparisons[0]).toEqual(
      expect.objectContaining({
        status: "MISSING",
        observedAutomation: null,
      })
    );
    expect(comparisons[1]).toEqual(
      expect.objectContaining({
        status: "HEALTHY",
        driftKinds: [],
      })
    );
  });
});

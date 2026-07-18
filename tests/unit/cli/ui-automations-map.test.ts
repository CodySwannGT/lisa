/**
 * Pure mapping coverage for harness automation observations (#1544).
 * @module tests/unit/cli/ui-automations-map
 */
import { describe, expect, it } from "vitest";

import { mapHarnessAutomations } from "../../../src/cli/ui-automations.js";

const PROJECT_PREFIX = "lisa-auto-codyswanngt-lisa-";
const MATCHING_ID = `${PROJECT_PREFIX}intake-tickets`;
const UNRELATED_ID = "lisa-auto-other-repo-intake-tickets";
const TEN_MINUTE_CADENCE = "every 10 minutes";
const HOURLY_CADENCE = "every 60 minutes";

describe("mapHarnessAutomations", () => {
  it("keeps only prefix-matching automations and their real cadence", () => {
    expect(
      mapHarnessAutomations({
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        observations: [
          {
            automationId: MATCHING_ID,
            observedCadence: TEN_MINUTE_CADENCE,
            status: "ACTIVE",
            lastRunAt: "2026-05-26T11:55:00Z",
          },
          {
            automationId: UNRELATED_ID,
            observedCadence: TEN_MINUTE_CADENCE,
            status: "ACTIVE",
          },
          {
            automationId: `${PROJECT_PREFIX}intake-prd`,
            observedCadence: HOURLY_CADENCE,
            status: "PAUSED",
          },
        ],
      })
    ).toEqual({
      state: "value",
      value: {
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        automations: [
          {
            id: `${PROJECT_PREFIX}intake-prd`,
            cadence: HOURLY_CADENCE,
            runtime: "codex",
            status: "PAUSED",
            lastRunAt: null,
          },
          {
            id: MATCHING_ID,
            cadence: TEN_MINUTE_CADENCE,
            runtime: "codex",
            status: "ACTIVE",
            lastRunAt: "2026-05-26T11:55:00Z",
          },
        ],
      },
    });
  });

  it("returns an empty value when the scheduler is readable but has no matches", () => {
    expect(
      mapHarnessAutomations({
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        observations: [
          {
            automationId: UNRELATED_ID,
            observedCadence: TEN_MINUTE_CADENCE,
          },
        ],
      })
    ).toEqual({
      state: "value",
      value: {
        prefix: PROJECT_PREFIX,
        runtime: "codex",
        automations: [],
      },
    });
  });

  it("omits cadence rather than inventing one when the scheduler left it blank", () => {
    const mapped = mapHarnessAutomations({
      prefix: PROJECT_PREFIX,
      runtime: "claude",
      observations: [{ automationId: MATCHING_ID, status: "ACTIVE" }],
    });

    expect(mapped.state).toBe("value");
    if (mapped.state !== "value") {
      return;
    }
    expect(mapped.value.automations).toEqual([
      {
        id: MATCHING_ID,
        cadence: null,
        runtime: "claude",
        status: "ACTIVE",
        lastRunAt: null,
      },
    ]);
  });
});

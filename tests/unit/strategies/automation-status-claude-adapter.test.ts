/**
 * Regression coverage for the Claude automation-status runtime adapter.
 *
 * Issue #802 adds the Claude `/schedule` normalization layer so automation
 * status can classify healthy, stale, failing, missing, and unsupported Lisa
 * routines without assuming Codex-only metadata fields.
 * @module tests/unit/strategies/automation-status-claude-adapter
 */
import { describe, expect, it } from "vitest";

import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import {
  deriveClaudeObservedCommand,
  inspectClaudeAutomationFleet,
} from "../../../plugins/src/base/scripts/automation-status-claude-adapter.mjs";

const REPO_CONFIG = {
  tracker: "github",
  github: {
    org: "CodySwannGT",
    repo: "lisa",
  },
};
const REPAIR_AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-repair";
const BUILD_AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const PRD_AUTOMATION_ID = "lisa-auto-codyswanngt-lisa-intake-prd";
const REPAIR_SCHEDULE_COMMAND =
  '/schedule "every 60 minutes" /lisa:repair-intake CodySwannGT/lisa intake_mode=both build_queue=CodySwannGT/lisa';
const BUILD_SCHEDULE_COMMAND =
  '/schedule "every 10 minutes" /lisa:intake CodySwannGT/lisa intake_mode=build';
const PRD_SCHEDULE_COMMAND =
  '/schedule "every 60 minutes" /lisa:intake CodySwannGT/lisa intake_mode=prd';
const CLAUDE_RUNTIME_LABEL = "Claude /schedule";
const ACTIVE_STATUS = "ACTIVE";
const DETECTED_TYPES = ["typescript"];
const FIXTURE_NOW = "2026-05-26T12:00:00Z";
const RECENT_RUN_AT = "2026-05-26T11:55:00Z";
const HOURLY_SCHEDULE = "hourly";
const TEN_MINUTE_SCHEDULE = "every 10 minutes";

describe("automation-status Claude adapter (#802)", () => {
  it("maps structured Claude schedule metadata into shared health states", async () => {
    const expectedFleet = resolveExpectedAutomationFleet({
      config: REPO_CONFIG,
      detectedTypes: DETECTED_TYPES,
      autoStartPrds: true,
    });

    const report = await inspectClaudeAutomationFleet({
      expectedFleet,
      scheduleListing: {
        routines: [
          {
            name: REPAIR_AUTOMATION_ID,
            schedule: HOURLY_SCHEDULE,
            command: REPAIR_SCHEDULE_COMMAND,
            status: ACTIVE_STATUS,
            lastRunAt: "2026-05-26T11:10:00Z",
            lastResult: "Completed successfully.",
          },
          {
            name: PRD_AUTOMATION_ID,
            schedule: "FREQ=HOURLY;INTERVAL=1",
            command: PRD_SCHEDULE_COMMAND,
            status: ACTIVE_STATUS,
            lastRunAt: "2026-05-26T06:00:00Z",
            lastResult: "No ready PRDs.",
          },
          {
            name: BUILD_AUTOMATION_ID,
            cadence: TEN_MINUTE_SCHEDULE,
            command: BUILD_SCHEDULE_COMMAND,
            status: "FAILED",
            lastRunAt: RECENT_RUN_AT,
            lastResult: "Failed: GitHub auth expired.",
          },
          {
            name: "lisa-auto-unrelated-other-repo-intake-tickets",
            cadence: TEN_MINUTE_SCHEDULE,
            command:
              '/schedule "every 10 minutes" /lisa:intake CodySwannGT/lisa intake_mode=build',
            status: ACTIVE_STATUS,
          },
        ],
      },
      now: FIXTURE_NOW,
    });

    expect(report.runtime).toContain(CLAUDE_RUNTIME_LABEL);
    expect(report.observedAutomations).toHaveLength(3);

    const items = report.groups.flatMap(group => group.items);

    expect(items).toContainEqual(
      expect.objectContaining({
        id: REPAIR_AUTOMATION_ID,
        status: "HEALTHY",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-intake-prd",
        status: "STALE",
        summary: "last recorded run is stale for the expected cadence",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: BUILD_AUTOMATION_ID,
        status: "FAILING",
        summary: "scheduler entry is failed",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-exploratory-prds",
        status: "MISSING",
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "lisa-auto-codyswanngt-lisa-exploratory-bugs",
        status: "UNSUPPORTED",
      })
    );
  });

  it("parses human-readable /schedule listings and marks unavailable run fields explicitly", async () => {
    const expectedFleet = resolveExpectedAutomationFleet({
      config: REPO_CONFIG,
      detectedTypes: DETECTED_TYPES,
    });

    const report = await inspectClaudeAutomationFleet({
      expectedFleet,
      scheduleListing: `
Name: ${REPAIR_AUTOMATION_ID}
Schedule: every 60 minutes
Command: ${REPAIR_SCHEDULE_COMMAND}
Status: ACTIVE

Name: ${BUILD_AUTOMATION_ID}
Schedule: every 10 minutes
Command: ${BUILD_SCHEDULE_COMMAND}
Status: ACTIVE
Last result: No recent failures reported.
      `.trim(),
      now: FIXTURE_NOW,
    });

    const repairItem = report.groups
      .flatMap(group => group.items)
      .find(item => item.id === REPAIR_AUTOMATION_ID);

    expect(repairItem?.status).toBe("HEALTHY");
    expect(repairItem?.observed).toContain(
      "Last-run metadata unavailable from Claude /schedule."
    );
    expect(repairItem?.observed).toContain(
      "Failure metadata unavailable from Claude /schedule."
    );
  });

  it("normalizes quoted /schedule cadences when text listings omit cadence fields", async () => {
    const expectedFleet = resolveExpectedAutomationFleet({
      config: REPO_CONFIG,
      detectedTypes: DETECTED_TYPES,
      autoStartPrds: true,
    });

    const report = await inspectClaudeAutomationFleet({
      expectedFleet,
      scheduleListing: `
ID: lisa-auto-codyswanngt-lisa-exploratory-prds
/schedule "once a day" /lisa:project-ideation prd_ready=false
Status: ACTIVE

ID: ${BUILD_AUTOMATION_ID}
/schedule "hourly" /lisa:intake CodySwannGT/lisa intake_mode=build
Status: ACTIVE
      `.trim(),
      now: FIXTURE_NOW,
    });

    expect(report.observedAutomations).toContainEqual(
      expect.objectContaining({
        automationId: "lisa-auto-codyswanngt-lisa-exploratory-prds",
        observedCadence: "once a day",
        observedRRule: "FREQ=DAILY;INTERVAL=1",
      })
    );
    expect(report.observedAutomations).toContainEqual(
      expect.objectContaining({
        automationId: BUILD_AUTOMATION_ID,
        observedCadence: "every 60 minutes",
        observedRRule: "FREQ=HOURLY;INTERVAL=1",
      })
    );
  });

  it("does not classify negated error or exception summaries as failures (#885)", async () => {
    const expectedFleet = resolveExpectedAutomationFleet({
      config: REPO_CONFIG,
      detectedTypes: DETECTED_TYPES,
    });

    const report = await inspectClaudeAutomationFleet({
      expectedFleet,
      scheduleListing: {
        routines: [
          {
            name: BUILD_AUTOMATION_ID,
            schedule: TEN_MINUTE_SCHEDULE,
            command: BUILD_SCHEDULE_COMMAND,
            status: ACTIVE_STATUS,
            lastRunAt: RECENT_RUN_AT,
            lastResult: "completed with no errors",
          },
          {
            name: PRD_AUTOMATION_ID,
            schedule: HOURLY_SCHEDULE,
            command: PRD_SCHEDULE_COMMAND,
            status: ACTIVE_STATUS,
            lastRunAt: RECENT_RUN_AT,
            lastResult: "ran without exceptions",
          },
          {
            name: REPAIR_AUTOMATION_ID,
            schedule: HOURLY_SCHEDULE,
            command: REPAIR_SCHEDULE_COMMAND,
            status: ACTIVE_STATUS,
            lastRunAt: RECENT_RUN_AT,
            lastResult: "encountered an exception",
          },
        ],
      },
      now: FIXTURE_NOW,
    });

    const itemsById = new Map(
      report.groups
        .flatMap(group => group.items)
        .map(item => [item.id, item.status])
    );

    expect(itemsById.get(BUILD_AUTOMATION_ID)).toBe("HEALTHY");
    expect(itemsById.get(PRD_AUTOMATION_ID)).toBe("HEALTHY");
    expect(itemsById.get(REPAIR_AUTOMATION_ID)).toBe("FAILING");
  });

  it("derives normalized Lisa slash commands from Claude schedule entries", () => {
    expect(deriveClaudeObservedCommand(BUILD_SCHEDULE_COMMAND)).toBe(
      "/lisa:intake CodySwannGT/lisa intake_mode=build"
    );

    expect(
      deriveClaudeObservedCommand(`Command: ${REPAIR_SCHEDULE_COMMAND}`)
    ).toBe(
      "/lisa:repair-intake CodySwannGT/lisa intake_mode=both build_queue=CodySwannGT/lisa"
    );

    expect(
      deriveClaudeObservedCommand("/lisa:project-ideation prd_ready=true")
    ).toBe("/lisa:project-ideation prd_ready=true");
  });

  it("inspects structured schedule metadata read-only", async () => {
    const scheduleListing = Object.freeze({
      routines: Object.freeze([
        Object.freeze({
          name: REPAIR_AUTOMATION_ID,
          schedule: "hourly",
          command: REPAIR_SCHEDULE_COMMAND,
          status: "ACTIVE",
        }),
      ]),
    });

    await expect(
      inspectClaudeAutomationFleet({
        expectedFleet: resolveExpectedAutomationFleet({
          config: REPO_CONFIG,
          detectedTypes: DETECTED_TYPES,
        }),
        scheduleListing,
        now: FIXTURE_NOW,
      })
    ).resolves.toBeDefined();

    expect(scheduleListing.routines[0].status).toBe("ACTIVE");
    expect(scheduleListing.routines).toHaveLength(1);
  });
});

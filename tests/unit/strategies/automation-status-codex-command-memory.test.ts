/**
 * Regression coverage for Codex automation command and memory normalization.
 *
 * @module tests/unit/strategies/automation-status-codex-command-memory
 */
import { describe, expect, it } from "vitest";

import { compareAutomationContract } from "../../../plugins/src/base/scripts/automation-status-contract-drift.mjs";
import {
  deriveCodexObservedCommand,
  parseCodexAutomationMemory,
} from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";

const BUILD_COMMAND = "/lisa:intake github intake_mode=build";
const BUILD_PROMPT =
  "Run one cron-safe Lisa build-intake cycle. Use the Lisa intake skill with arguments `github intake_mode=build`.";
const BUILD_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const BUILD_RRULE = "FREQ=MINUTELY;INTERVAL=10";
const RECENT_RUN_AT = "2026-05-26T12:00:00Z";

describe("automation-status Codex command and memory normalization", () => {
  it("derives normalized Lisa slash commands from Codex automation prompts", () => {
    expect(deriveCodexObservedCommand(BUILD_PROMPT)).toBe(BUILD_COMMAND);
    expect(
      deriveCodexObservedCommand(
        "Run ideation. Use the Lisa project-ideation skill with arguments `prd_ready=true`."
      )
    ).toBe("/lisa:project-ideation prd_ready=true");
    expect(
      deriveCodexObservedCommand(
        "Run QA. Use the `$lisa-exploratory-qa` skill with arguments `ready=true`."
      )
    ).toBe("/lisa:exploratory-qa ready=true");
  });

  it("canonicalizes Codex $lisa-* aliases to Lisa slash-colon commands (#880)", () => {
    const observedCommand = deriveCodexObservedCommand(
      "Run one cycle. Use the `$lisa-intake` skill with arguments `github intake_mode=build`."
    );

    expect(observedCommand).toBe(BUILD_COMMAND);
    expect(
      compareAutomationContract({
        expected: {
          automationId: BUILD_ID,
          expectedCadence: "every 10 minutes",
          expectedRRule: BUILD_RRULE,
          expectedCommand: BUILD_COMMAND,
        },
        observedAutomation: {
          automationId: BUILD_ID,
          observedCadence: "every 10 minutes",
          observedRRule: BUILD_RRULE,
          observedCommand,
        },
      }).status
    ).toBe("HEALTHY");
  });

  it("does not classify negated error or exception summaries as failures (#885)", () => {
    expect(
      parseCodexAutomationMemory(
        `${RECENT_RUN_AT}\n\n- completed with no errors\n`
      ).lastRunFailed
    ).toBe(false);
    expect(
      parseCodexAutomationMemory(
        `${RECENT_RUN_AT}\n\n- ran without exceptions\n`
      ).lastRunFailed
    ).toBe(false);
    expect(
      parseCodexAutomationMemory(
        `${RECENT_RUN_AT}\n\n- encountered an exception\n`
      ).lastRunFailed
    ).toBe(true);
  });

  it("uses the newest append-only memory run for timestamps and failure state (#881)", () => {
    const memory = [
      "# Lisa Build Intake Automation Memory",
      "- 2025-01-01T00:00:00Z: Completed successfully with no errors.",
      `- ${RECENT_RUN_AT}: Latest run failed because GitHub auth crashed.`,
      "",
    ].join("\n");

    expect(parseCodexAutomationMemory(memory)).toEqual({
      lastRunAt: RECENT_RUN_AT,
      lastRunSummary: `${RECENT_RUN_AT}: Latest run failed because GitHub auth crashed.`,
      lastRunFailed: true,
    });
  });
});

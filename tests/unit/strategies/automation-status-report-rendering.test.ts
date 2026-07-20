/**
 * Regression coverage for the shared automation-status report renderer.
 *
 * Issue #798 adds the grouped fleet output contract before the runtime adapter
 * work lands. This suite proves the renderer computes the verdict ladder,
 * keeps observed facts separate from remediation text, and renders expected
 * cadence/command details for each automation row.
 * @module tests/unit/strategies/automation-status-report-rendering
 */
import { describe, expect, it } from "vitest";

import {
  computeAutomationFleetVerdict,
  countAutomationHealthStatuses,
  renderAutomationStatusReport,
} from "../../../plugins/src/base/scripts/automation-status-report.mjs";

const EXPLORATORY_QA_UNSUPPORTED =
  "The current repo does not expose the exploratory-qa skill surface.";
const EXPLORATORY_AUTOMATIONS_GROUP = "Exploratory automations";
const CORE_GROUP_TITLE = "Core automations";
const PRD_ITEM_ID = "intake-prd";
const PRESENT_AND_CURRENT = "present and current";
const OUTCOME_CHANGE_PROVED = "change-proved";
const OUTCOME_NOTHING_NEEDED = "nothing-needed";

describe("automation-status report rendering (#798)", () => {
  it("renders grouped fleet sections with expected contract and remediation lines", () => {
    const report = renderAutomationStatusReport({
      runtime: "Codex automations",
      generatedAt: "2026-05-26T02:15:00.000Z",
      groups: [
        {
          id: "1",
          title: "Core queue automations",
          items: [
            {
              id: PRD_ITEM_ID,
              status: "HEALTHY",
              summary: "expected automation exists and matches the contract",
              expectedCadence: "every 60 minutes",
              expectedCommand: "/lisa:intake github intake_mode=prd",
              observed:
                "Last run completed 12 minutes ago with the configured command.",
            },
            {
              id: "intake-tickets",
              status: "DRIFTED",
              summary: "cadence and queue arguments no longer match setup",
              expectedCadence: "every 10 minutes",
              expectedCommand: "/lisa:intake github intake_mode=build",
              observed:
                "Live automation runs every 30 minutes with stale queue arguments.",
              remediation:
                "Re-run `/lisa:setup-automations` or update the scheduler entry to the expected command and cadence.",
            },
          ],
        },
        {
          id: "2",
          title: EXPLORATORY_AUTOMATIONS_GROUP,
          items: [
            {
              id: "exploratory-bugs",
              status: "UNSUPPORTED",
              summary: "exploratory-qa is not installed for this stack",
              expectedCadence: "every 6 hours",
              expectedCommand: "/lisa:product-walkthrough /",
              observed: EXPLORATORY_QA_UNSUPPORTED,
            },
          ],
        },
      ],
    });

    expect(report.verdict).toBe("ATTENTION_NEEDED");
    expect(report.counts).toEqual({
      HEALTHY: 1,
      MISSING: 0,
      UNSUPPORTED: 1,
      DRIFTED: 1,
      STALE: 0,
      FAILING: 0,
    });
    expect(report.text).toContain("Overall verdict: ATTENTION_NEEDED");
    expect(report.text).toContain(
      "Counts: 1 HEALTHY, 0 MISSING, 1 UNSUPPORTED, 1 DRIFTED, 0 STALE, 0 FAILING"
    );
    expect(report.text).toContain("Runtime inspected: Codex automations");
    expect(report.text).toContain("1. Core queue automations");
    expect(report.text).toContain(
      "- DRIFTED intake-tickets: cadence and queue arguments no longer match setup"
    );
    expect(report.text).toContain(
      "Expected: every 10 minutes -> /lisa:intake github intake_mode=build"
    );
    expect(report.text).toContain(
      "Observed: Live automation runs every 30 minutes with stale queue arguments."
    );
    expect(report.text).toContain(
      "Remediation: Re-run `/lisa:setup-automations` or update the scheduler entry to the expected command and cadence."
    );
  });

  it("returns HEALTHY when every expected automation is healthy", () => {
    expect(
      computeAutomationFleetVerdict([
        {
          id: "1",
          title: "Core queue automations",
          items: [
            {
              id: "intake-repair",
              status: "HEALTHY",
              summary: PRESENT_AND_CURRENT,
            },
          ],
        },
      ])
    ).toBe("HEALTHY");
  });

  it("returns PARTIAL_SUPPORT when only unsupported entries keep the fleet from full coverage", () => {
    expect(
      computeAutomationFleetVerdict([
        {
          id: "2",
          title: EXPLORATORY_AUTOMATIONS_GROUP,
          items: [
            {
              id: "exploratory-bugs",
              status: "UNSUPPORTED",
              summary: "stack does not support exploratory-qa",
            },
          ],
        },
      ])
    ).toBe("PARTIAL_SUPPORT");
  });

  it("counts health states across all groups", () => {
    expect(
      countAutomationHealthStatuses([
        {
          id: "1",
          title: "Queue automations",
          items: [
            { id: "one", status: "HEALTHY", summary: "ok" },
            { id: "two", status: "MISSING", summary: "missing" },
          ],
        },
        {
          id: "2",
          title: "Exploratory automations",
          items: [
            { id: "three", status: "STALE", summary: "stale" },
            { id: "four", status: "FAILING", summary: "failing" },
          ],
        },
      ])
    ).toEqual({
      HEALTHY: 1,
      MISSING: 1,
      UNSUPPORTED: 0,
      DRIFTED: 0,
      STALE: 1,
      FAILING: 1,
    });
  });

  it("renders the runbook, last outcome, and bounded history between Observed and Remediation (#1799)", () => {
    const report = renderAutomationStatusReport({
      runtime: "Codex automations",
      groups: [
        {
          id: "1",
          title: CORE_GROUP_TITLE,
          items: [
            {
              id: PRD_ITEM_ID,
              status: "HEALTHY",
              summary: "latest recorded run is within cadence",
              observed: "Scheduler status: ACTIVE",
              runbook: ".lisa/automations/intake-prd.runbook.md",
              lastOutcome: {
                ts: "2026-05-26T11:55:00Z",
                outcome: OUTCOME_CHANGE_PROVED,
                summary: "Shipped one build ticket.",
              },
              outcomeHistory: [
                OUTCOME_CHANGE_PROVED,
                "candidate-proposed",
                OUTCOME_NOTHING_NEEDED,
                OUTCOME_CHANGE_PROVED,
                OUTCOME_NOTHING_NEEDED,
              ],
              olderRecordCount: 7,
              remediation: "None needed.",
            },
          ],
        },
      ],
    });

    const lines = report.text.split("\n");
    const observedIndex = lines.findIndex(line =>
      line.includes("Observed: Scheduler status: ACTIVE")
    );
    const runbookIndex = lines.findIndex(line =>
      line.includes("Runbook: .lisa/automations/intake-prd.runbook.md")
    );
    const remediationIndex = lines.findIndex(line =>
      line.includes("Remediation: None needed.")
    );

    expect(observedIndex).toBeLessThan(runbookIndex);
    expect(runbookIndex).toBeLessThan(remediationIndex);
    expect(report.text).toContain(
      "  Last run: change-proved — Shipped one build ticket. (2026-05-26T11:55:00Z)"
    );
    expect(report.text).toContain(
      "  History: change-proved, candidate-proposed, nothing-needed, change-proved, nothing-needed (newest first); … and 7 older records"
    );
  });

  it("states absent runbook and empty history explicitly, never blank (#1799)", () => {
    const report = renderAutomationStatusReport({
      groups: [
        {
          id: "1",
          title: CORE_GROUP_TITLE,
          items: [
            {
              id: PRD_ITEM_ID,
              status: "HEALTHY",
              summary: PRESENT_AND_CURRENT,
              runbook: "not scaffolded — run /lisa:setup-automations",
            },
          ],
        },
      ],
    });

    expect(report.text).toContain(
      "  Runbook: not scaffolded — run /lisa:setup-automations"
    );
    expect(report.text).toContain("  Last run: no recorded runs yet");
    // With no outcomeHistory the History line is omitted rather than blank.
    expect(report.text).not.toContain("  History:");
  });

  it("omits the older-records clause when history is not trimmed (#1799)", () => {
    const report = renderAutomationStatusReport({
      groups: [
        {
          id: "1",
          title: CORE_GROUP_TITLE,
          items: [
            {
              id: "monitor",
              status: "HEALTHY",
              summary: PRESENT_AND_CURRENT,
              runbook: ".lisa/automations/monitor.runbook.md",
              outcomeHistory: [OUTCOME_NOTHING_NEEDED, OUTCOME_NOTHING_NEEDED],
              olderRecordCount: 0,
            },
          ],
        },
      ],
    });

    expect(report.text).toContain(
      "  History: nothing-needed, nothing-needed (newest first)"
    );
    expect(report.text).not.toContain("older records");
  });

  it("renders empty groups as intentional unsupported buckets", () => {
    const report = renderAutomationStatusReport({
      groups: [{ id: "4", title: EXPLORATORY_AUTOMATIONS_GROUP, items: [] }],
    });

    expect(report.verdict).toBe("HEALTHY");
    expect(report.text).toContain(`4. ${EXPLORATORY_AUTOMATIONS_GROUP}`);
    expect(report.text).toContain(
      "- UNSUPPORTED empty-group: no automations expected in this group"
    );
  });
});

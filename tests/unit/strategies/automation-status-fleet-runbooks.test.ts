/**
 * Regression coverage for the #1796 additions to expected-fleet resolution.
 *
 * RBC-2 collapses three drifting fleet lists onto the shared resolver: `monitor`
 * joins the core group unconditionally, the opt-in `learnings-audit` gardener is
 * resolved from a flag (UNSUPPORTED, not MISSING, when a project has not opted
 * in), and every entry — expected or unsupported — carries the repo-relative
 * `runbookPath` that `/lisa:setup-automations` scaffolds and the status surface
 * later renders.
 * @module tests/unit/strategies/automation-status-fleet-runbooks
 */
import { describe, expect, it } from "vitest";

import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";

const GITHUB = "github";
const LEARNINGS_AUDIT_ID = "learnings-audit";
const EXPLORATORY_BUGS_ID = "exploratory-bugs";
const WEEKLY_CADENCE = "once a week";
const WEEKLY_RRULE = "FREQ=WEEKLY;INTERVAL=1";
const OPT_IN_GROUP = "opt-in";

/**
 * Expected repo-relative runbook path for a loop id.
 * @param id - Loop id (the automation-name suffix)
 * @returns The repo-relative runbook path
 */
const runbook = (id: string): string => `.lisa/automations/${id}.runbook.md`;

describe("expected fleet runbook paths and opt-in gardener (#1796)", () => {
  it("exposes a repo-relative runbook path for every registered loop", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB,
        source: GITHUB,
        github: { org: "Acme", repo: "mobile-app" },
      },
      detectedTypes: ["expo"],
      learningsAudit: true,
    });

    expect(fleet.expected.map(entry => [entry.id, entry.runbookPath])).toEqual(
      [
        "intake-repair",
        "intake-prd",
        "intake-tickets",
        "monitor",
        "exploratory-prds",
        EXPLORATORY_BUGS_ID,
        LEARNINGS_AUDIT_ID,
      ].map(id => [id, runbook(id)])
    );
  });

  it("resolves monitor unconditionally into the core group", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: { tracker: GITHUB, github: { org: "Acme", repo: "frontend" } },
    });

    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: "monitor",
        automationId: "lisa-auto-acme-frontend-monitor",
        expectedCadence: "once a day",
        expectedRRule: "FREQ=DAILY;INTERVAL=1",
        expectedCommand: "/lisa:monitor",
        group: "core",
      })
    );
  });

  it("registers the weekly gardener only when learnings-audit is requested", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB,
        source: GITHUB,
        github: { org: "Acme", repo: "frontend" },
      },
      learningsAudit: "true",
    });

    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: LEARNINGS_AUDIT_ID,
        automationId: "lisa-auto-acme-frontend-learnings-audit",
        expectedCadence: WEEKLY_CADENCE,
        expectedRRule: WEEKLY_RRULE,
        expectedCommand: "/lisa:learnings:audit",
        group: OPT_IN_GROUP,
        runbookPath: runbook(LEARNINGS_AUDIT_ID),
      })
    );
    expect(fleet.unsupported.map(entry => entry.id)).toEqual([
      EXPLORATORY_BUGS_ID,
    ]);
  });

  it("reports an un-opted-in gardener as unsupported, never missing", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB,
        source: GITHUB,
        github: { org: "Acme", repo: "mobile-app" },
      },
      detectedTypes: ["expo"],
    });

    expect(fleet.expected.map(entry => entry.id)).not.toContain(
      LEARNINGS_AUDIT_ID
    );
    expect(fleet.unsupported).toEqual([
      expect.objectContaining({
        id: LEARNINGS_AUDIT_ID,
        group: OPT_IN_GROUP,
        expectedCadence: WEEKLY_CADENCE,
        expectedRRule: WEEKLY_RRULE,
        reason: expect.stringMatching(/opt-in/i),
        runbookPath: runbook(LEARNINGS_AUDIT_ID),
      }),
    ]);
  });
});

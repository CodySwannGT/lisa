/**
 * Regression coverage for automation-status expected fleet resolution.
 *
 * Issue #799 adds the shared resolver that turns the setup-automations
 * contract into concrete expected automation entries for the current repo:
 * naming, queue arguments, auto-start flags, and unsupported exploratory jobs.
 * @module tests/unit/strategies/automation-status-expected-fleet
 */
import { describe, expect, it } from "vitest";

import {
  resolveAutomationProjectIdentity,
  resolveExpectedAutomationFleet,
} from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";

const GITHUB_TRACKER = "github";
const INTAKE_PRD_COMMAND = "/lisa:intake CodySwannGT/lisa intake_mode=prd";
const INTAKE_PRD_ID = "intake-prd";
const INTAKE_REPAIR_ID = "intake-repair";
const INTAKE_TICKETS_ID = "intake-tickets";
const MONITOR_ID = "monitor";
const EXPLORATORY_BUGS_ID = "exploratory-bugs";
const EXPLORATORY_PRDS_ID = "exploratory-prds";
const LEARNINGS_AUDIT_ID = "learnings-audit";
const WEEKLY_CADENCE = "once a week";
const WEEKLY_RRULE = "FREQ=WEEKLY;INTERVAL=1";
const OPT_IN_GROUP = "opt-in";

/**
 * Expected repo-relative runbook path for a loop id.
 * @param id - Loop id (the automation-name suffix)
 * @returns The repo-relative runbook path
 */
const runbook = (id: string): string => `.lisa/automations/${id}.runbook.md`;

describe("automation-status expected fleet (#799)", () => {
  it("resolves the self-host GitHub Lisa fleet and flags unsupported exploratory-bugs", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB_TRACKER,
        github: {
          org: "CodySwannGT",
          repo: "lisa",
        },
      },
      detectedTypes: ["typescript", "npm-package"],
    });

    expect(fleet.project).toBe("codyswanngt-lisa");
    expect(fleet.automationPrefix).toBe("lisa-auto-codyswanngt-lisa-");
    expect(fleet.expected).toEqual([
      expect.objectContaining({
        id: INTAKE_REPAIR_ID,
        automationId: "lisa-auto-codyswanngt-lisa-intake-repair",
        expectedCadence: "every 60 minutes",
        expectedRRule: "FREQ=HOURLY;INTERVAL=1",
        expectedCommand:
          "/lisa:repair-intake CodySwannGT/lisa intake_mode=both build_queue=CodySwannGT/lisa",
      }),
      expect.objectContaining({
        id: INTAKE_PRD_ID,
        expectedCommand: INTAKE_PRD_COMMAND,
      }),
      expect.objectContaining({
        id: INTAKE_TICKETS_ID,
        expectedCadence: "every 10 minutes",
        expectedRRule: "FREQ=MINUTELY;INTERVAL=10",
        expectedCommand: "/lisa:intake CodySwannGT/lisa intake_mode=build",
      }),
      expect.objectContaining({
        id: MONITOR_ID,
        automationId: "lisa-auto-codyswanngt-lisa-monitor",
        expectedCadence: "once a day",
        expectedRRule: "FREQ=DAILY;INTERVAL=1",
        expectedCommand: "/lisa:monitor",
        group: "core",
        runbookPath: runbook(MONITOR_ID),
      }),
      expect.objectContaining({
        id: EXPLORATORY_PRDS_ID,
        expectedCommand: "/lisa:project-ideation prd_ready=false",
      }),
    ]);
    expect(fleet.unsupported).toEqual([
      expect.objectContaining({
        id: EXPLORATORY_BUGS_ID,
        group: "exploratory",
        reason: expect.stringContaining(
          "This project ships no exploratory-qa command"
        ),
        runbookPath: runbook(EXPLORATORY_BUGS_ID),
      }),
      expect.objectContaining({
        id: LEARNINGS_AUDIT_ID,
        automationId: "lisa-auto-codyswanngt-lisa-learnings-audit",
        expectedCadence: WEEKLY_CADENCE,
        expectedRRule: WEEKLY_RRULE,
        group: OPT_IN_GROUP,
        runbookPath: runbook(LEARNINGS_AUDIT_ID),
      }),
    ]);
  });

  it("bakes the umbrella build queue without redirecting PRD intake or identity naming", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "github",
        source: "github",
        github: {
          org: "Acme",
          repo: "frontend",
          queueRepo: "Program/backlog",
        },
      },
    });

    expect(fleet.project).toBe("acme-frontend");
    expect(fleet.expected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: INTAKE_PRD_ID,
          expectedCommand: "/lisa:intake Acme/frontend intake_mode=prd",
        }),
        expect.objectContaining({
          id: INTAKE_TICKETS_ID,
          expectedCommand: "/lisa:intake Program/backlog intake_mode=build",
        }),
        expect.objectContaining({
          id: INTAKE_REPAIR_ID,
          expectedCommand:
            "/lisa:repair-intake Acme/frontend intake_mode=both build_queue=Program/backlog",
        }),
      ])
    );
  });

  it("bakes the identity build queue for mixed Notion and GitHub automation fleets", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "github",
        source: "notion",
        notion: { prdDatabaseId: "db-123" },
        github: { org: "Acme", repo: "frontend" },
      },
    });

    expect(fleet.expected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: INTAKE_TICKETS_ID,
          expectedCommand: "/lisa:intake Acme/frontend intake_mode=build",
        }),
        expect.objectContaining({
          id: INTAKE_REPAIR_ID,
          expectedCommand:
            "/lisa:repair-intake Acme/frontend intake_mode=build",
        }),
      ])
    );
  });

  it("does not apply the build-only queueRepo to a GitHub PRD source with a JIRA tracker", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "jira",
        source: "github",
        jira: { project: "ENG" },
        github: {
          org: "Acme",
          repo: "product",
          queueRepo: "not/a/valid/build/repo",
        },
      },
    });

    expect(fleet.expected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: INTAKE_PRD_ID,
          expectedCommand: "/lisa:intake Acme/product intake_mode=prd",
        }),
        expect.objectContaining({
          id: INTAKE_TICKETS_ID,
          expectedCommand: "/lisa:intake ENG",
        }),
      ])
    );
  });

  it("emits the stack-specific exploratory command and auto-start flags when supported", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB_TRACKER,
        source: GITHUB_TRACKER,
        github: {
          org: "Acme",
          repo: "mobile-app",
        },
      },
      detectedTypes: ["expo", "typescript"],
      autoStartPrds: true,
      autoStartTickets: "true",
    });

    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: "exploratory-bugs",
        expectedCadence: "once a day",
        expectedCommand: "/lisa-expo:exploratory-qa ready=true",
      })
    );
    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: "exploratory-prds",
        expectedCommand: "/lisa:project-ideation prd_ready=true",
      })
    );
    expect(fleet.unsupported.map(entry => entry.id)).toEqual([
      LEARNINGS_AUDIT_ID,
    ]);
  });

  it("covers the build repair queue for mixed PRD source and JIRA tracker repos", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "jira",
        source: "notion",
        jira: { project: "SE" },
        notion: { prdDatabaseId: "db-123" },
        github: { org: "GeminiSportsAI", repo: "frontend-v2" },
      },
    });

    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: INTAKE_REPAIR_ID,
        automationId: "lisa-auto-geminisportsai-frontend-v2-intake-repair",
        expectedCommand: "/lisa:repair-intake SE intake_mode=build",
      })
    );
  });

  it("does not duplicate intake_mode=build when the GitHub build queue already carries it", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: GITHUB_TRACKER,
        source: "notion",
        github: { org: "CodySwannGT", repo: "lisa" },
        notion: { prdDatabaseId: "db-123" },
      },
    });

    expect(fleet.expected).toContainEqual(
      expect.objectContaining({
        id: INTAKE_REPAIR_ID,
        expectedCommand:
          "/lisa:repair-intake CodySwannGT/lisa intake_mode=build",
      })
    );
  });

  it("falls back to the GitHub remote when config does not carry the repo identity", () => {
    expect(
      resolveAutomationProjectIdentity({
        config: { tracker: GITHUB_TRACKER },
        gitRemoteUrl: "git@github.com:CodySwannGT/lisa.git",
      })
    ).toEqual({
      owner: "CodySwannGT",
      repo: "lisa",
      project: "codyswanngt-lisa",
      automationPrefix: "lisa-auto-codyswanngt-lisa-",
    });
  });
});

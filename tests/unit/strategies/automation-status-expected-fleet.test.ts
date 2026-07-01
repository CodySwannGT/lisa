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

describe("automation-status expected fleet (#799)", () => {
  it("resolves the self-host GitHub Lisa fleet and flags unsupported exploratory-bugs", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "github",
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
        id: "intake-repair",
        automationId: "lisa-auto-codyswanngt-lisa-intake-repair",
        expectedCadence: "every 60 minutes",
        expectedRRule: "FREQ=HOURLY;INTERVAL=1",
        expectedCommand: "/lisa:repair-intake github intake_mode=both",
      }),
      expect.objectContaining({
        id: "intake-prd",
        expectedCommand: "/lisa:intake github intake_mode=prd",
      }),
      expect.objectContaining({
        id: "intake-tickets",
        expectedCadence: "every 10 minutes",
        expectedRRule: "FREQ=MINUTELY;INTERVAL=10",
        expectedCommand: "/lisa:intake github intake_mode=build",
      }),
      expect.objectContaining({
        id: "exploratory-prds",
        expectedCommand: "/lisa:project-ideation prd_ready=false",
      }),
    ]);
    expect(fleet.unsupported).toEqual([
      expect.objectContaining({
        id: "exploratory-bugs",
        automationId: "lisa-auto-codyswanngt-lisa-exploratory-bugs",
        reason:
          "This repository does not ship an exploratory-qa command surface.",
      }),
    ]);
  });

  it("emits the stack-specific exploratory command and auto-start flags when supported", () => {
    const fleet = resolveExpectedAutomationFleet({
      config: {
        tracker: "github",
        source: "github",
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
    expect(fleet.unsupported).toEqual([]);
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
        id: "intake-repair",
        automationId: "lisa-auto-geminisportsai-frontend-v2-intake-repair",
        expectedCommand: "/lisa:repair-intake SE intake_mode=build",
      })
    );
  });

  it("falls back to the GitHub remote when config does not carry the repo identity", () => {
    expect(
      resolveAutomationProjectIdentity({
        config: { tracker: "github" },
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

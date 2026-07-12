/**
 * Fixture-backed smoke coverage plus exact automation-status artifact parity.
 *
 * Issue #803 extends the earlier scaffold and adapter coverage with committed
 * fleet fixtures that exercise degraded operator output, plus strict proof that
 * the generated `plugins/lisa` assets stay byte-for-byte aligned with the
 * `plugins/src/base` source assets for the read-only automation-status surface.
 * @module tests/unit/strategies/automation-status-fixture-smoke-and-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderAutomationStatusReport } from "../../../plugins/src/base/scripts/automation-status-report.mjs";

/**
 *
 */
type AutomationStatus =
  | "HEALTHY"
  | "MISSING"
  | "UNSUPPORTED"
  | "DRIFTED"
  | "STALE"
  | "FAILING";

/**
 *
 */
type AutomationItem = {
  readonly id: string;
  readonly status: AutomationStatus;
  readonly summary: string;
  readonly expectedCadence?: string;
  readonly expectedCommand?: string;
  readonly observed?: string;
  readonly remediation?: string;
};

/**
 *
 */
type AutomationGroup = {
  readonly id: string;
  readonly title: string;
  readonly items: readonly AutomationItem[];
};

/**
 *
 */
type AutomationFixture = {
  readonly runtime?: string;
  readonly generatedAt?: string;
  readonly groups: readonly AutomationGroup[];
};

const BASE_PLUGIN_ROOT = path.resolve("plugins/src/base");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa");
const AUTOMATION_STATUS_FIXTURES = path.resolve(
  "tests/fixtures/automation-status"
);

const readUtf8 = (filePath: string): string => readFileSync(filePath, "utf8");

const readFixture = (name: string): AutomationFixture =>
  JSON.parse(
    readUtf8(path.join(AUTOMATION_STATUS_FIXTURES, `${name}.json`))
  ) as AutomationFixture;

describe("automation-status fixture smoke coverage (#803)", () => {
  it("renders a degraded Codex fleet fixture as ATTENTION_NEEDED with exact remediation", () => {
    const report = renderAutomationStatusReport(
      readFixture("attention-needed-codex")
    );

    expect(report.verdict).toBe("ATTENTION_NEEDED");
    expect(report.counts).toEqual({
      HEALTHY: 1,
      MISSING: 1,
      UNSUPPORTED: 1,
      DRIFTED: 0,
      STALE: 1,
      FAILING: 1,
    });
    expect(report.text).toContain("Overall verdict: ATTENTION_NEEDED");
    expect(report.text).toContain(
      "Counts: 1 HEALTHY, 1 MISSING, 1 UNSUPPORTED, 0 DRIFTED, 1 STALE, 1 FAILING"
    );
    expect(report.text).toContain(
      "Runtime inspected: Codex automations (backing-store metadata)"
    );
    expect(report.text).toContain(
      "- STALE lisa-auto-codyswanngt-lisa-intake-prd: last recorded run is stale for the expected cadence"
    );
    expect(report.text).toContain(
      "Expected: every 10 minutes -> /lisa:intake github intake_mode=build"
    );
    expect(report.text).toContain(
      "Observed: lisa-auto-codyswanngt-lisa-intake-tickets runs every 10 minutes -> /lisa:intake github intake_mode=build Scheduler status: ACTIVE Last run: 2026-05-26T11:55:00Z Latest summary: Latest run failed because GitHub auth was unavailable."
    );
    expect(report.text).toContain(
      "Remediation: Inspect the latest automation run output and fix the failing job before re-running setup."
    );
    expect(report.text).toContain(
      "- MISSING lisa-auto-codyswanngt-lisa-exploratory-prds: expected automation is missing"
    );
  });

  it("renders unsupported-only coverage as PARTIAL_SUPPORT rather than failure", () => {
    const report = renderAutomationStatusReport(
      readFixture("partial-support-codex")
    );

    expect(report.verdict).toBe("PARTIAL_SUPPORT");
    expect(report.counts).toEqual({
      HEALTHY: 0,
      MISSING: 0,
      UNSUPPORTED: 1,
      DRIFTED: 0,
      STALE: 0,
      FAILING: 0,
    });
    expect(report.text).toContain("Overall verdict: PARTIAL_SUPPORT");
    expect(report.text).toContain(
      "- UNSUPPORTED lisa-auto-codyswanngt-mobile-exploratory-bugs: This repository does not ship an exploratory-qa command surface."
    );
  });
});

describe("automation-status source/generated parity (#803)", () => {
  it("keeps the distributed automation-status command in lockstep with the source asset", () => {
    expect(
      readUtf8(
        path.join(GENERATED_PLUGIN_ROOT, "commands", "automation-status.md")
      )
    ).toBe(
      readUtf8(path.join(BASE_PLUGIN_ROOT, "commands", "automation-status.md"))
    );
  });

  it("keeps the distributed automation-status skill in lockstep with the source asset", () => {
    const sourceSkill = readUtf8(
      path.join(
        BASE_PLUGIN_ROOT,
        "skills",
        "lisa-automation-status",
        "SKILL.md"
      )
    );

    expect(
      readUtf8(
        path.join(
          GENERATED_PLUGIN_ROOT,
          "skills",
          "lisa-automation-status",
          "SKILL.md"
        )
      )
    ).toBe(sourceSkill);
    expect(sourceSkill).toMatch(/read-only/i);
    expect(sourceSkill).toMatch(
      /It does not create, update, resume, rerun, pause, or delete automations\./
    );
  });

  it("keeps the distributed automation-status scripts in lockstep with the source assets", () => {
    const scriptNames = [
      "automation-status-report.mjs",
      "automation-status-expected-fleet.mjs",
      "automation-status-contract-drift.mjs",
      "automation-status-codex-adapter.mjs",
    ];

    for (const scriptName of scriptNames) {
      expect(
        readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", scriptName))
      ).toBe(readUtf8(path.join(BASE_PLUGIN_ROOT, "scripts", scriptName)));
    }
  });
});

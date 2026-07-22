/**
 * Regression coverage for the `opt-in` fleet group in both runtime adapters.
 *
 * Both adapters used to bin expected entries into a hardcoded
 * `Map([["core"],["exploratory"]])` and push with `?.`, so any entry in a group
 * the map did not know about was silently dropped — the opt-in `learnings-audit`
 * gardener vanished from the report whether or not the project had opted in.
 * These tests pin the rendered opt-in group per runtime and the loud failure
 * that now replaces the silent drop.
 * @module tests/unit/strategies/automation-status-opt-in-group
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assignToAutomationGroup,
  createAutomationGroupBins,
  inferLearningsAuditRegistration,
  resolveExpectedAutomationFleet,
} from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import { inspectClaudeAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-claude-adapter.mjs";
import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";

const GARDENER_ID = "lisa-auto-codyswanngt-lisa-learnings-audit";
const GARDENER_COMMAND = "/lisa:learnings:audit";
const WEEKLY_RRULE = "FREQ=WEEKLY;INTERVAL=1";
const OPT_IN_TITLE = "Opt-in automations";
const LAST_RUN_AT = "2026-05-25T09:00:00Z";
const NOW = "2026-05-26T12:00:00Z";
const REPO_CONFIG = {
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
};

/**
 * Resolve a fleet for the shared test repo.
 * @param learningsAudit - Whether the project opted into the gardener
 * @returns The resolved expected fleet
 */
const fleetFor = (
  learningsAudit: boolean
): ReturnType<typeof resolveExpectedAutomationFleet> =>
  resolveExpectedAutomationFleet({
    config: REPO_CONFIG,
    detectedTypes: ["typescript"],
    learningsAudit,
  });

/** The slice of an adapter report these tests read. */
type AdapterReport = {
  readonly groups: readonly {
    readonly title: string;
    readonly items: readonly { readonly id: string }[];
  }[];
};

/**
 * The single rendered group carrying opt-in loops.
 * @param report - An adapter report
 * @returns The opt-in group
 */
const optInGroup = (report: AdapterReport): AdapterReport["groups"][number] => {
  const group = report.groups.find(entry => entry.title === OPT_IN_TITLE);
  if (!group) {
    throw new Error(
      `No "${OPT_IN_TITLE}" group in report: ${report.groups.map(g => g.title).join(", ")}`
    );
  }
  return group;
};

describe("opt-in fleet group is rendered, never dropped (#1796)", () => {
  it("Claude: an opted-in, registered gardener is compared like any other loop", async () => {
    const report = await inspectClaudeAutomationFleet({
      expectedFleet: fleetFor(true),
      scheduleListing: {
        routines: [
          {
            name: GARDENER_ID,
            schedule: WEEKLY_RRULE,
            command: `/schedule "once a week" ${GARDENER_COMMAND}`,
            status: "ACTIVE",
            lastRunAt: LAST_RUN_AT,
            lastResult: "Proposed nothing this week.",
          },
        ],
      },
      now: NOW,
    });

    expect(optInGroup(report).items).toContainEqual(
      expect.objectContaining({
        id: GARDENER_ID,
        status: "HEALTHY",
        expectedCadence: "once a week",
        expectedCommand: GARDENER_COMMAND,
      })
    );
  });

  it("Claude: an opted-in gardener missing from the scheduler reports MISSING", async () => {
    const report = await inspectClaudeAutomationFleet({
      expectedFleet: fleetFor(true),
      scheduleListing: { routines: [] },
      now: NOW,
    });

    expect(optInGroup(report).items).toContainEqual(
      expect.objectContaining({ id: GARDENER_ID, status: "MISSING" })
    );
  });

  it("Claude: an un-opted-in gardener reports UNSUPPORTED with the enabling command", async () => {
    const report = await inspectClaudeAutomationFleet({
      expectedFleet: fleetFor(false),
      scheduleListing: { routines: [] },
      now: NOW,
    });

    expect(optInGroup(report).items).toContainEqual(
      expect.objectContaining({
        id: GARDENER_ID,
        status: "UNSUPPORTED",
        summary: expect.stringContaining(
          "/lisa:setup-automations learnings-audit=true"
        ),
      })
    );
  });

  it("infers opt-in from the observed registration, not from config", () => {
    expect(
      inferLearningsAuditRegistration({
        automationPrefix: "lisa-auto-codyswanngt-lisa-",
        observedAutomationIds: [GARDENER_ID],
      })
    ).toBe(true);
    expect(
      inferLearningsAuditRegistration({
        automationPrefix: "lisa-auto-codyswanngt-lisa-",
        observedAutomationIds: ["lisa-auto-codyswanngt-lisa-monitor"],
      })
    ).toBe(false);
  });

  it("fails loudly on an unknown group instead of dropping the entry", () => {
    expect(() =>
      assignToAutomationGroup(createAutomationGroupBins(), "brand-new-group", {
        id: "lisa-auto-acme-app-something",
      })
    ).toThrow(/brand-new-group/);
  });
});

describe("Codex adapter renders the opt-in group (#1796)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  it("reads no-argument registrations back as HEALTHY, not DRIFTED", async () => {
    const fleet = fleetFor(true);
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-no-arg-")
    );
    tempDirs.push(automationsDir);

    // monitor and the gardener are the two no-argument loops: their prompts
    // carry the literal command with no "with arguments" clause at all.
    for (const entry of fleet.expected) {
      await writeCodexAutomation(automationsDir, {
        automationId: entry.automationId,
        rrule: entry.expectedRRule,
        prompt: `Run one cycle for this project.\n${entry.expectedCommand}`,
        lastRunAt: LAST_RUN_AT,
      });
    }

    const report = await inspectCodexAutomationFleet({
      expectedFleet: fleet,
      automationsDir,
      now: NOW,
    });

    const items = report.groups.flatMap(group => group.items);
    for (const id of ["monitor", "learnings-audit"]) {
      const entry = fleet.expected.find(candidate => candidate.id === id);
      expect(items).toContainEqual(
        expect.objectContaining({
          id: entry?.automationId,
          status: "HEALTHY",
        })
      );
    }
  });

  it("still reports DRIFTED when a no-argument loop runs the wrong command", async () => {
    const fleet = fleetFor(true);
    const monitor = fleet.expected.find(entry => entry.id === "monitor");
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-drift-")
    );
    tempDirs.push(automationsDir);

    await writeCodexAutomation(automationsDir, {
      automationId: monitor?.automationId ?? "",
      rrule: monitor?.expectedRRule ?? "",
      prompt: "Run one cycle for this project.\n/lisa:queue-status",
      lastRunAt: LAST_RUN_AT,
    });

    const report = await inspectCodexAutomationFleet({
      expectedFleet: fleet,
      automationsDir,
      now: NOW,
    });

    expect(report.groups.flatMap(group => group.items)).toContainEqual(
      expect.objectContaining({
        id: monitor?.automationId,
        status: "DRIFTED",
      })
    );
  });

  it("shows a registered gardener and an un-opted-in one in the same group", async () => {
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-codex-opt-in-")
    );
    tempDirs.push(automationsDir);

    await writeCodexAutomation(automationsDir, {
      automationId: GARDENER_ID,
      rrule: WEEKLY_RRULE,
      prompt: `Run one Lisa learnings-audit cycle.\n${GARDENER_COMMAND}`,
      lastRunAt: LAST_RUN_AT,
    });

    const optedIn = await inspectCodexAutomationFleet({
      expectedFleet: fleetFor(true),
      automationsDir,
      now: NOW,
    });

    expect(optInGroup(optedIn).items.map(item => item.id)).toEqual([
      GARDENER_ID,
    ]);

    const optedOut = await inspectCodexAutomationFleet({
      expectedFleet: fleetFor(false),
      automationsDir,
      now: NOW,
    });

    expect(optInGroup(optedOut).items).toContainEqual(
      expect.objectContaining({
        id: GARDENER_ID,
        status: "UNSUPPORTED",
        summary: expect.stringContaining(
          "/lisa:setup-automations learnings-audit=true"
        ),
      })
    );
  });
});

/** One Codex automation fixture's backing-store fields. */
type CodexAutomationFixture = {
  /** Full automation name, e.g. `lisa-auto-acme-app-monitor`. */
  readonly automationId: string;
  /** Recurrence rule as Codex stores it. */
  readonly rrule: string;
  /** Registration prompt; newlines are escaped into the single-line TOML. */
  readonly prompt: string;
  /** Timestamp of the latest recorded run. */
  readonly lastRunAt: string;
};

/**
 * Write one Codex automation fixture (backing-store TOML + memory file).
 * @param automationsDir - Fixture root standing in for `~/.codex/automations`
 * @param input - The automation's backing-store fields
 * @returns Nothing
 */
async function writeCodexAutomation(
  automationsDir: string,
  input: CodexAutomationFixture
): Promise<void> {
  const automationDir = path.join(automationsDir, input.automationId);
  await fs.mkdir(automationDir, { recursive: true });
  await fs.writeFile(
    path.join(automationDir, "automation.toml"),
    [
      "version = 1",
      `id = "${input.automationId}"`,
      'kind = "cron"',
      `name = "${input.automationId}"`,
      // Codex stores prompts as single-line TOML: line breaks are escaped.
      `prompt = "${input.prompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
      'status = "ACTIVE"',
      `rrule = "${input.rrule}"`,
      'execution_environment = "local"',
      // A real, non-bare Git work tree — an invalid cwd alone reports FAILING.
      `cwds = ["${process.cwd()}"]`,
      "",
    ].join("\n")
  );
  await fs.writeFile(
    path.join(automationDir, "memory.md"),
    `${input.lastRunAt}\n\n- Completed the cycle cleanly.\n`
  );
}

/**
 * Regression coverage for the run-history overlay both automation-status
 * adapters attach (#1799).
 *
 * Each registered loop's row now carries its checked-in runbook line, its last
 * recorded run outcome, and a bounded newest-first history read from the RBC-3
 * substrate. Three or more trailing `recovery-required` runs flip the loop to
 * FAILING even when the scheduler entry looks healthy, and the whole surface
 * stays strictly read-only.
 * @module tests/unit/strategies/automation-status-run-history
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import { inspectClaudeAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-claude-adapter.mjs";
import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";
import { computeAutomationFleetVerdict } from "../../../plugins/src/base/scripts/automation-status-report.mjs";
import {
  resolveAutomationRunDisplay,
  resolveRecoveryEscalation,
} from "../../../plugins/src/base/scripts/automation-status-run-history.mjs";
import {
  runRecordLine,
  scaffoldRunbook,
  writeRunRecordsFile,
} from "./automation-run-history-helpers.js";

const REPO_CONFIG = {
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
};
const DETECTED_TYPES = ["typescript"];
const NOW = "2026-05-26T12:00:00Z";
const PRD_LOOP = "intake-prd";
const TICKETS_LOOP = "intake-tickets";
const PRD_ID = "lisa-auto-codyswanngt-lisa-intake-prd";
const TICKETS_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const PRD_RUNBOOK = ".lisa/automations/intake-prd.runbook.md";
const NOT_SCAFFOLDED = "not scaffolded — run /lisa:setup-automations";
const NOTHING = "nothing-needed";
const CANDIDATE = "candidate-proposed";
const CHANGE = "change-proved";
const APPROVAL = "approval-requested";
const RECOVERY = "recovery-required";
const POLICY = "policy-obsolete";
const CRASH_SUMMARY = "Build agent crashed on startup.";
const RUNS_DIR_PARTS = [".lisa", "automations", "runs"] as const;

/** The slice of an adapter report these assertions read. */
type ReportItem = {
  readonly id: string;
  readonly status:
    | "HEALTHY"
    | "MISSING"
    | "UNSUPPORTED"
    | "DRIFTED"
    | "STALE"
    | "FAILING";
  readonly summary: string;
  readonly runbook?: string;
  readonly lastOutcome?: {
    readonly ts: string;
    readonly outcome: string;
    readonly summary: string;
  };
  readonly outcomeHistory?: readonly string[];
  readonly olderRecordCount?: number;
  readonly remediation?: string;
};
/** The slice of an adapter report carrying grouped items. */
type Report = {
  readonly groups: readonly {
    readonly id: string;
    readonly title: string;
    readonly items: readonly ReportItem[];
  }[];
};

/**
 * Flatten every rendered item across a report's groups.
 * @param report - An adapter report.
 * @returns Every item, group order preserved.
 */
const allItems = (report: Report): readonly ReportItem[] =>
  report.groups.flatMap(group => group.items);

/**
 * Seed one loop with seven valid records plus a corrupt line, and another with a
 * clean run followed by three trailing recovery-required runs.
 * @param projectRoot - Fixture project root.
 * @returns Nothing.
 */
const seedRunRecords = async (projectRoot: string): Promise<void> => {
  await scaffoldRunbook(projectRoot, PRD_LOOP);
  await writeRunRecordsFile(projectRoot, PRD_LOOP, [
    runRecordLine({ loopId: PRD_LOOP, outcome: NOTHING, n: 1 }),
    runRecordLine({ loopId: PRD_LOOP, outcome: NOTHING, n: 2 }),
    runRecordLine({ loopId: PRD_LOOP, outcome: CANDIDATE, n: 3 }),
    runRecordLine({ loopId: PRD_LOOP, outcome: CHANGE, n: 4 }),
    "{ corrupt json line",
    runRecordLine({ loopId: PRD_LOOP, outcome: POLICY, n: 5 }),
    runRecordLine({ loopId: PRD_LOOP, outcome: APPROVAL, n: 6 }),
    runRecordLine({ loopId: PRD_LOOP, outcome: CHANGE, n: 7 }),
  ]);
  await writeRunRecordsFile(projectRoot, TICKETS_LOOP, [
    runRecordLine({ loopId: TICKETS_LOOP, outcome: CHANGE, n: 1 }),
    runRecordLine({
      loopId: TICKETS_LOOP,
      outcome: RECOVERY,
      n: 2,
      summary: "GitHub auth expired mid-run.",
    }),
    runRecordLine({
      loopId: TICKETS_LOOP,
      outcome: RECOVERY,
      n: 3,
      summary: "Queue lock could not be acquired.",
    }),
    runRecordLine({
      loopId: TICKETS_LOOP,
      outcome: RECOVERY,
      n: 4,
      summary: CRASH_SUMMARY,
    }),
  ]);
};

/**
 * Assert the shared overlay/escalation expectations against a resolved report.
 * @param report - The adapter report to inspect.
 */
const expectOverlayAndEscalation = (report: Report): void => {
  const prd = allItems(report).find(item => item.id === PRD_ID);
  const tickets = allItems(report).find(item => item.id === TICKETS_ID);

  // Bounded history: newest five outcomes, two older stated, corrupt line skipped.
  expect(prd?.runbook).toBe(PRD_RUNBOOK);
  expect(prd?.outcomeHistory).toEqual([
    CHANGE,
    APPROVAL,
    POLICY,
    CHANGE,
    CANDIDATE,
  ]);
  expect(prd?.olderRecordCount).toBe(2);
  expect(prd?.lastOutcome).toEqual(
    expect.objectContaining({ outcome: CHANGE })
  );

  // Three trailing recoveries flip the loop and the fleet verdict; the citations
  // are numbered (newest first) so summaries carrying their own punctuation stay
  // legible.
  expect(tickets?.runbook).toBe(NOT_SCAFFOLDED);
  expect(tickets?.status).toBe("FAILING");
  expect(tickets?.summary).toContain("required recovery");
  expect(tickets?.remediation).toContain(
    `Repeated recovery-required runs — (1) ${CRASH_SUMMARY}`
  );
  expect(tickets?.remediation).toContain(
    "(2) Queue lock could not be acquired."
  );
  expect(tickets?.remediation).toContain("(3) GitHub auth expired mid-run.");
  expect(computeAutomationFleetVerdict(report.groups)).toBe("ATTENTION_NEEDED");
};

describe("automation-status run-history overlay (#1799)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true }))
    );
    tempDirs.length = 0;
  });

  /**
   * Create a fresh temp project root registered for cleanup.
   * @returns The project root path.
   */
  const makeProjectRoot = async (): Promise<string> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-run-history-"));
    tempDirs.push(dir);
    return dir;
  };

  it("Codex: overlays runbook, bounded history, and recovery escalation", async () => {
    const projectRoot = await makeProjectRoot();
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-run-history-codex-")
    );
    tempDirs.push(automationsDir);
    await seedRunRecords(projectRoot);

    const report = await inspectCodexAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
        autoStartPrds: true,
      }),
      automationsDir,
      projectRoot,
      now: NOW,
    });

    expectOverlayAndEscalation(report);
  });

  it("Claude: overlays runbook, bounded history, and recovery escalation over a healthy schedule", async () => {
    const projectRoot = await makeProjectRoot();
    await seedRunRecords(projectRoot);

    const report = await inspectClaudeAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
        autoStartPrds: true,
      }),
      // The tickets entry looks healthy on the scheduler; the run records win.
      scheduleListing: {
        routines: [
          {
            name: TICKETS_ID,
            cadence: "every 10 minutes",
            command:
              '/schedule "every 10 minutes" /lisa:intake CodySwannGT/lisa intake_mode=build',
            status: "ACTIVE",
            lastRunAt: "2026-05-26T11:55:00Z",
            lastResult: "Completed successfully.",
          },
        ],
      },
      projectRoot,
      now: NOW,
    });

    expectOverlayAndEscalation(report);
  });

  it("Codex: states absent records and never creates the runs directory (read-only)", async () => {
    const projectRoot = await makeProjectRoot();
    const automationsDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "lisa-run-history-empty-")
    );
    tempDirs.push(automationsDir);

    const report = await inspectCodexAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
      }),
      automationsDir,
      projectRoot,
      now: NOW,
    });

    const runsDirExists = await fs
      .stat(path.join(projectRoot, ...RUNS_DIR_PARTS))
      .then(() => true)
      .catch(() => false);
    expect(runsDirExists).toBe(false);

    const prd = allItems(report).find(item => item.id === PRD_ID);
    expect(prd?.lastOutcome).toBeUndefined();
    expect(prd?.outcomeHistory).toEqual([]);
    expect(prd?.runbook).toBe(NOT_SCAFFOLDED);
  });

  it("Claude: states absent records and never creates the runs directory (read-only)", async () => {
    const projectRoot = await makeProjectRoot();

    const report = await inspectClaudeAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
      }),
      scheduleListing: { routines: [] },
      projectRoot,
      now: NOW,
    });

    const runsDirExists = await fs
      .stat(path.join(projectRoot, ...RUNS_DIR_PARTS))
      .then(() => true)
      .catch(() => false);
    expect(runsDirExists).toBe(false);

    const prd = allItems(report).find(item => item.id === PRD_ID);
    expect(prd?.lastOutcome).toBeUndefined();
    expect(prd?.runbook).toBe(NOT_SCAFFOLDED);
  });

  it("does not escalate a recovery burst that is not all trailing (#1799)", async () => {
    const projectRoot = await makeProjectRoot();
    // Write order (oldest → newest): three recovery-required runs, but a later
    // NOTHING run breaks the streak, so only one recovery is trailing.
    await writeRunRecordsFile(projectRoot, TICKETS_LOOP, [
      runRecordLine({ loopId: TICKETS_LOOP, outcome: RECOVERY, n: 1 }),
      runRecordLine({ loopId: TICKETS_LOOP, outcome: RECOVERY, n: 2 }),
      runRecordLine({ loopId: TICKETS_LOOP, outcome: NOTHING, n: 3 }),
      runRecordLine({ loopId: TICKETS_LOOP, outcome: RECOVERY, n: 4 }),
    ]);

    // Only the trailing streak counts, so there is no escalation to drive FAILING.
    const display = await resolveAutomationRunDisplay({
      projectRoot,
      loopId: TICKETS_LOOP,
    });
    expect(display.recoveryRequiredStreak).toBe(1);
    expect(resolveRecoveryEscalation(display)).toBeNull();

    const report = await inspectClaudeAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
        autoStartPrds: true,
      }),
      scheduleListing: {
        routines: [
          {
            name: TICKETS_ID,
            cadence: "every 10 minutes",
            command:
              '/schedule "every 10 minutes" /lisa:intake CodySwannGT/lisa intake_mode=build',
            status: "ACTIVE",
            lastRunAt: "2026-05-26T11:55:00Z",
            lastResult: "Completed successfully.",
          },
        ],
      },
      projectRoot,
      now: NOW,
    });

    // Healthy scheduler entry + non-trailing recoveries ⇒ the loop stays HEALTHY;
    // the fleet verdict is not driven to ATTENTION_NEEDED by this loop.
    const tickets = allItems(report).find(item => item.id === TICKETS_ID);
    expect(tickets?.status).toBe("HEALTHY");
    expect(tickets?.lastOutcome?.outcome).toBe(RECOVERY);
  });
});

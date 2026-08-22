/**
 * Regression coverage for detecting registered-loop cycles that ran and
 * recorded nothing (#2638).
 *
 * The Automation Runbook Contract requires a run record from every cycle, but
 * the recorder is invoked only by prose inside each loop's `SKILL.md`. A cycle
 * that skips it leaves no row, and an absent row reads identically to a cycle
 * that never ran — including to the next cycle, which consults the ledger tail
 * to decide whether the lane was already worked and re-picks a rung a peer is
 * holding.
 *
 * The detector resolves that ambiguity against the scheduler's own last-run
 * time, a signal the loop cannot suppress by skipping a step.
 * @module tests/unit/strategies/automation-status-unrecorded-runs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectClaudeAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-claude-adapter.mjs";
import { inspectCodexAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-codex-adapter.mjs";
import { resolveExpectedAutomationFleet } from "../../../plugins/src/base/scripts/automation-status-expected-fleet.mjs";
import { resolveUnrecordedRunFinding } from "../../../plugins/src/base/scripts/automation-status-unrecorded-runs.mjs";

import {
  scaffoldRunbook,
  writeRunRecordsFile,
} from "./automation-run-history-helpers.js";
import { resolveGit } from "../../support/git-executable.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;
/** Absolute git path, so the fixture does not resolve a command off `PATH`. */
const GIT_BINARY = resolveGit();
const REPO_CONFIG = {
  tracker: "github",
  github: { org: "CodySwannGT", repo: "lisa" },
};
const DETECTED_TYPES = ["typescript"];
const NOW = "2026-05-26T12:00:00Z";
const TICKETS_LOOP = "intake-tickets";
const TICKETS_ID = "lisa-auto-codyswanngt-lisa-intake-tickets";
const SCHEDULER_LAST_RUN = "2026-05-26T11:55:00Z";
/** A ledger row five hours behind the last scheduled run. */
const STALE_RECORD_AT = "2026-05-26T06:55:00Z";
/** The same row as the recorder normalizes it on disk. */
const STALE_RECORD_STORED = "2026-05-26T06:55:00.000Z";
/** Fixture wall-clock used by both the detector and adapter assertions. */
const NOON = "2026-05-26T12:00:00Z";
/** The phrase an unrecorded-run finding must carry. */
const NO_OUTCOME = "recorded no outcome";

/** The slice of an adapter report these assertions read. */
type ReportItem = {
  readonly id: string;
  readonly status: string;
  readonly summary: string;
  readonly observed?: string;
  readonly remediation?: string;
};

/** The slice of an adapter report carrying grouped items. */
type Report = {
  readonly groups: readonly { readonly items: readonly ReportItem[] }[];
};

/**
 * Build one run-record line at an exact timestamp.
 *
 * The shared helper derives its own synthetic timestamps, but every assertion
 * here turns on the precise distance between a record and a scheduled run, so
 * the timestamp is the input rather than a side effect.
 * @param ts - ISO timestamp for the record.
 * @returns The serialized JSONL line.
 */
const recordAt = (ts: string): string =>
  JSON.stringify({
    ts,
    loop_id: TICKETS_LOOP,
    outcome: "change-proved",
    summary: "Cycle recorded an outcome.",
    runbook: `.lisa/automations/${TICKETS_LOOP}.runbook.md`,
    refs: [],
    run_id: `${TICKETS_LOOP}:${ts}`,
  });

/**
 * Resolve a Claude fleet report over a fixture whose ledger and scheduler
 * disagree by a chosen amount.
 * @param input - Fixture inputs.
 * @param input.projectRoot - Temp project root holding runbook and ledger.
 * @param input.newestRecordAt - Newest ledger row, or `null` to write none.
 * @param input.status - Scheduler entry status; defaults to `ACTIVE`.
 * @returns The `intake-tickets` item from the rendered report.
 */
const inspectTickets = async (input: {
  readonly projectRoot: string;
  readonly newestRecordAt: string | null;
  readonly status?: string;
}): Promise<ReportItem | undefined> => {
  await scaffoldRunbook(input.projectRoot, TICKETS_LOOP);
  if (input.newestRecordAt) {
    await writeRunRecordsFile(input.projectRoot, TICKETS_LOOP, [
      recordAt(input.newestRecordAt),
    ]);
  }

  const report = (await inspectClaudeAutomationFleet({
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
          status: input.status ?? "ACTIVE",
          lastRunAt: SCHEDULER_LAST_RUN,
          lastResult: "Completed successfully.",
        },
      ],
    },
    projectRoot: input.projectRoot,
    now: NOW,
  })) as Report;

  return report.groups
    .flatMap(group => group.items)
    .find(item => item.id === TICKETS_ID);
};

describe("unrecorded automation runs (#2638)", () => {
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
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-unrecorded-"));
    tempDirs.push(dir);
    return dir;
  };

  it("reports a scheduled run whose cycle appended no record", () => {
    // The production case: a 10-minute loop whose newest row predates the last
    // scheduled run by five hours.
    const finding = resolveUnrecordedRunFinding({
      schedulerLastRunAt: "2026-05-26T21:30:00Z",
      ledgerLastRecordAt: "2026-05-26T16:30:00Z",
      hasRunbook: true,
      cadenceMs: TEN_MINUTES_MS,
    });

    expect(finding?.missedCycles).toBe(30);
    expect(finding?.summary).toContain(NO_OUTCOME);
    expect(finding?.remediation).toContain("automation-runbook-contract");
  });

  it("stays silent when the cycle recorded its outcome", () => {
    expect(
      resolveUnrecordedRunFinding({
        schedulerLastRunAt: "2026-05-26T11:50:00Z",
        ledgerLastRecordAt: "2026-05-26T11:52:00Z",
        hasRunbook: true,
        cadenceMs: TEN_MINUTES_MS,
      })
    ).toBeNull();
  });

  it("tolerates a full cadence, so a slow-but-honest cycle is not accused", () => {
    // The scheduler may stamp `lastRunAt` at either end of a cycle, and a cycle
    // can legitimately run for minutes. Anything tighter than one cadence would
    // report a slow loop as a silent one — a false positive that would poison
    // the very lane-selection signal this detector protects.
    expect(
      resolveUnrecordedRunFinding({
        schedulerLastRunAt: NOON,
        ledgerLastRecordAt: "2026-05-26T11:51:00Z",
        hasRunbook: true,
        cadenceMs: TEN_MINUTES_MS,
      })
    ).toBeNull();

    expect(
      resolveUnrecordedRunFinding({
        schedulerLastRunAt: NOON,
        ledgerLastRecordAt: "2026-05-26T11:49:00Z",
        hasRunbook: true,
        cadenceMs: TEN_MINUTES_MS,
      })
    ).not.toBeNull();
  });

  it("distinguishes an unrecorded run from a loop that never ran", () => {
    // No scheduler run means nothing to have recorded. The two cases must not
    // collapse: that collapse is the defect.
    expect(
      resolveUnrecordedRunFinding({
        schedulerLastRunAt: null,
        ledgerLastRecordAt: null,
        hasRunbook: true,
        cadenceMs: TEN_MINUTES_MS,
      })
    ).toBeNull();

    const ranAndSaidNothing = resolveUnrecordedRunFinding({
      schedulerLastRunAt: SCHEDULER_LAST_RUN,
      ledgerLastRecordAt: null,
      hasRunbook: true,
      cadenceMs: TEN_MINUTES_MS,
    });
    expect(ranAndSaidNothing?.summary).toContain("no record at all");
  });

  it("degrades to silence on inputs it cannot trust", () => {
    const cases = [
      { ledgerLastRecordAt: "not-a-timestamp" },
      { schedulerLastRunAt: "not-a-timestamp" },
      { cadenceMs: null },
      { cadenceMs: 0 },
      { hasRunbook: false },
    ];

    for (const override of cases) {
      expect(
        resolveUnrecordedRunFinding({
          schedulerLastRunAt: "2026-05-26T21:30:00Z",
          ledgerLastRecordAt: "2026-05-26T16:30:00Z",
          hasRunbook: true,
          cadenceMs: TEN_MINUTES_MS,
          ...override,
        })
      ).toBeNull();
    }
  });

  it("Claude: flags the loop and shows both timestamps behind the verdict", async () => {
    const item = await inspectTickets({
      projectRoot: await makeProjectRoot(),
      newestRecordAt: STALE_RECORD_AT,
    });

    expect(item?.status).toBe("DRIFTED");
    expect(item?.summary).toContain(NO_OUTCOME);
    // A reader must be able to check the verdict rather than trust it.
    expect(item?.observed).toContain(`Last run: ${SCHEDULER_LAST_RUN}`);
    expect(item?.observed).toContain(
      `Newest run record: ${STALE_RECORD_STORED}`
    );
  });

  it("Claude: a loop that recorded its run stays healthy", async () => {
    const item = await inspectTickets({
      projectRoot: await makeProjectRoot(),
      newestRecordAt: "2026-05-26T11:56:00Z",
    });

    expect(item?.status).toBe("HEALTHY");
    expect(item?.summary).not.toContain(NO_OUTCOME);
  });

  it("Codex: flags the same silence from its own scheduler surface", async () => {
    // Parity, not duplication: Codex reads last-run time out of append-only
    // automation memory rather than a schedule listing, so a Claude-only
    // control would leave every Codex-scheduled loop undetectable.
    const projectRoot = await makeProjectRoot();
    const automationsDir = await makeProjectRoot();
    // Codex checks the automation's cwd before anything else, and that check
    // outranks this one — a loop pointed at a broken checkout is not silent,
    // it is not running. Give it a real work tree so the silence is the only
    // thing left to report.
    execFileSync(GIT_BINARY, ["init", "--quiet", projectRoot], {
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
      ),
    });
    await scaffoldRunbook(projectRoot, TICKETS_LOOP);
    await writeRunRecordsFile(projectRoot, TICKETS_LOOP, [
      recordAt(STALE_RECORD_AT),
    ]);

    const automationDir = path.join(automationsDir, TICKETS_ID);
    await fs.mkdir(automationDir, { recursive: true });
    await fs.writeFile(
      path.join(automationDir, "automation.toml"),
      [
        "version = 1",
        `id = "${TICKETS_ID}"`,
        'kind = "cron"',
        'prompt = "Use the Lisa intake skill with arguments `CodySwannGT/lisa intake_mode=build`."',
        'status = "ACTIVE"',
        'rrule = "FREQ=MINUTELY;INTERVAL=10"',
        `cwds = ["${projectRoot}"]`,
        "",
      ].join("\n")
    );
    await fs.writeFile(
      path.join(automationDir, "memory.md"),
      `- ${SCHEDULER_LAST_RUN}: Completed successfully.\n`
    );

    const report = (await inspectCodexAutomationFleet({
      expectedFleet: resolveExpectedAutomationFleet({
        config: REPO_CONFIG,
        detectedTypes: DETECTED_TYPES,
        autoStartPrds: true,
      }),
      automationsDir,
      projectRoot,
      now: NOW,
    })) as Report;

    const item = report.groups
      .flatMap(group => group.items)
      .find(entry => entry.id === TICKETS_ID);

    expect(item?.status).toBe("DRIFTED");
    expect(item?.summary).toContain(NO_OUTCOME);
  });

  it("Claude: a disabled scheduler entry keeps its own cause", async () => {
    // A disabled entry EXPLAINS the missing rows. Reporting the silence over
    // the cause would send an operator to fix the loop's recording step when
    // the loop is not running at all.
    const item = await inspectTickets({
      projectRoot: await makeProjectRoot(),
      newestRecordAt: STALE_RECORD_AT,
      status: "DISABLED",
    });

    expect(item?.status).toBe("FAILING");
    expect(item?.summary).toContain("disabled");
  });
});
